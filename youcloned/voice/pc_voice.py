# The Windows PC side of your clone's voice. The Mac files never use it. Each job is one word:
#   mcp              starts VoiceMode for the Claude app, with a voice-key line that works on a PC (see below)
#   services         runs hidden at login: keeps the listening engine (Whisper), the speaking voice (Kokoro),
#                    the optional Speechify connector and the two voice keys running
#   send next|stop   what a voice key does (Ctrl+Alt+N and Ctrl+Alt+S); handy for testing too
#   set NAME VALUE   saves one setting (no keys or passwords ever go in this file)
#   status           prints what the services helper is running
#   stop-services    stops the services helper and everything it started
#   save-key         saves your Speechify key in Windows Credential Manager. The key arrives on input, never on a
#                    command line, and is never printed or written to a file.
#   has-key / forget-key   checks for the Speechify key, or removes it
# Standard library only, so it runs on the Python that comes with VoiceMode.
import ctypes, json, os, socket, subprocess, sys, threading, time
from pathlib import Path

HOME = Path.home()
PHONE = HOME / '.youcloned-phone'
VOICEMODE_DIR = HOME / '.voicemode'
CONFIG = PHONE / 'pc-voice.json'
LOG = PHONE / 'services.log'
KEYS_LOG = PHONE / 'keys.log'

WHISPER_PORT, KOKORO_PORT, SPEECHIFY_PORT = 2022, 8880, 8895
CONTROL_PORT = 8896   # where VoiceMode listens for the voice keys while it talks or listens
STATUS_PORT = 8897    # the services helper answers here, which also stops a second copy from starting
CRED_NAME = 'youcloned-speechify'
CREATE_NO_WINDOW = 0x08000000


def windows():
    return sys.platform == 'win32'


def _dll(name):
    """A Windows system library. Tests swap this for fakes."""
    return ctypes.WinDLL(name, use_last_error=True)


def note(path, msg):
    PHONE.mkdir(parents=True, exist_ok=True)
    with open(path, 'a', encoding='utf-8') as f:
        f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + msg + '\n')


# ---------------------------------------------------------------- settings (never secrets)

def load_config():
    try:
        return json.loads(CONFIG.read_text(encoding='utf-8'))
    except Exception:
        return {}


def save_setting(name, value):
    if name not in ('whisper_exe', 'whisper_model', 'kokoro_dir', 'kokoro_python', 'ffmpeg_dir', 'speechify', 'keys'):
        raise SystemExit('Unknown setting: %s' % name)
    if name in ('speechify', 'keys'):
        value = value.lower() in ('on', 'true', '1', 'yes')
    cfg = load_config()
    cfg[name] = value
    PHONE.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG.with_name(CONFIG.name + '.tmp')
    tmp.write_text(json.dumps(cfg, indent=1), encoding='utf-8')
    os.replace(tmp, CONFIG)


# ---------------------------------------------------------------- Speechify key in Windows Credential Manager
# A "generic" credential named youcloned-speechify, kept on this PC only, stored as UTF-16 the way Windows and
# Python's keyring package store theirs. Same layout the Zoom seat uses (CREDENTIALW from wincred.h).
CRED_TYPE_GENERIC, CRED_PERSIST_LOCAL_MACHINE = 1, 2


class FILETIME(ctypes.Structure):
    _fields_ = [('dwLowDateTime', ctypes.c_uint32), ('dwHighDateTime', ctypes.c_uint32)]


class CREDENTIAL(ctypes.Structure):
    _fields_ = [('Flags', ctypes.c_uint32), ('Type', ctypes.c_uint32), ('TargetName', ctypes.c_wchar_p),
                ('Comment', ctypes.c_wchar_p), ('LastWritten', FILETIME), ('CredentialBlobSize', ctypes.c_uint32),
                ('CredentialBlob', ctypes.POINTER(ctypes.c_ubyte)), ('Persist', ctypes.c_uint32),
                ('AttributeCount', ctypes.c_uint32), ('Attributes', ctypes.c_void_p), ('TargetAlias', ctypes.c_wchar_p),
                ('UserName', ctypes.c_wchar_p)]


def _advapi32():
    a = _dll('advapi32')
    a.CredReadW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
    a.CredReadW.restype = ctypes.c_int
    a.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), ctypes.c_uint32]
    a.CredWriteW.restype = ctypes.c_int
    a.CredDeleteW.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32]
    a.CredDeleteW.restype = ctypes.c_int
    a.CredFree.argtypes = [ctypes.c_void_p]
    a.CredFree.restype = None
    return a


def _blob_text(raw):
    """UTF-16 the way Windows stores it; plain bytes if another tool saved it that way."""
    if len(raw) % 2 == 0 and raw[1:2] == b'\x00':
        return raw.decode('utf-16-le', 'ignore')
    return raw.decode('utf-8', 'ignore')


def read_key():
    """The Speechify key, or an empty string when none is saved."""
    a = _advapi32()
    found = ctypes.POINTER(CREDENTIAL)()
    if not a.CredReadW(CRED_NAME, CRED_TYPE_GENERIC, 0, ctypes.byref(found)):
        return ''
    try:
        c = found.contents
        return _blob_text(ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize)).strip()
    finally:
        a.CredFree(found)


def save_key(key):
    blob = key.encode('utf-16-le')
    buf = (ctypes.c_ubyte * len(blob)).from_buffer_copy(blob)
    c = CREDENTIAL(Type=CRED_TYPE_GENERIC, TargetName=CRED_NAME, CredentialBlobSize=len(blob),
                   CredentialBlob=ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)), Persist=CRED_PERSIST_LOCAL_MACHINE,
                   UserName='buyer')
    if not _advapi32().CredWriteW(ctypes.byref(c), 0):
        raise OSError('Windows Credential Manager refused the key (error %s)' % getattr(ctypes, 'get_last_error', int)())


def forget_key():
    _advapi32().CredDeleteW(CRED_NAME, CRED_TYPE_GENERIC, 0)


# ---------------------------------------------------------------- VoiceMode for the Claude app

def patch_control_channel(cs):
    """VoiceMode's voice-key line is a Unix socket file, which Python doesn't offer on Windows. Without this, every
    spoken turn on a PC would fail the moment the line switches on. This moves the same line to a network port that
    only this PC can reach (127.0.0.1). Commands, checks and limits stay VoiceMode's own."""
    def _bind(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):     # Windows: no other program can take the port over
            s.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', CONTROL_PORT))
            s.listen(8)
            s.settimeout(cs._POLL_TIMEOUT)
        except OSError:
            s.close()
            raise
        return s

    original = cs.ControlSocketListener._handle_connection

    def _handle(self, conn):
        # A web page can make your browser send text to a port on this PC. Real voice-key commands start with "{";
        # anything else (a browser's request line) is dropped before VoiceMode reads it.
        try:
            conn.settimeout(2.0)
            first = conn.recv(1, socket.MSG_PEEK)
        except OSError:
            first = b''
        if first != b'{':
            self._close_quietly(conn)
            return
        original(self, conn)

    cs.ControlSocketListener._bind = _bind
    cs.ControlSocketListener._unlink_socket = lambda self: None
    # VoiceMode's who-is-calling check reads Unix socket details a network port doesn't have (on Windows it already
    # gives up and allows). The 127.0.0.1 address is what keeps other computers out.
    cs._peer_uid = lambda conn: None
    cs.ControlSocketListener._handle_connection = _handle


def run_mcp():
    # The settings file keeps the voice-key line off, so any other VoiceMode on this PC stays safe.
    # This launcher has the PC-safe line, so it switches it on for itself only.
    os.environ['VOICEMODE_CONTROL_CHANNEL_ENABLED'] = 'true'
    from voice_mode import control_socket
    patch_control_channel(control_socket)
    from voice_mode.cli import voice_mode
    sys.argv = ['voicemode']
    voice_mode()


# ---------------------------------------------------------------- the voice keys

COMMANDS = {'next': {'command': 'skip_forward'}, 'stop': {'command': 'stop', 'hint': 'switch-to-text'}}


def chime(kind):
    """A short Windows sound: done for next, a different one for stop, the error sound when nothing is talking."""
    if not windows():
        return
    try:
        import winsound
        alias = {'next': 'SystemAsterisk', 'stop': 'SystemExclamation', 'none': 'SystemHand'}[kind]
        winsound.PlaySound(alias, winsound.SND_ALIAS | winsound.SND_ASYNC)
    except Exception:
        pass


def send(word, port=CONTROL_PORT):
    """Sends one voice-key command to VoiceMode. Returns True when a spoken conversation took it."""
    if word not in COMMANDS:
        raise SystemExit('Usage: pc_voice.py send next | stop')
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1.0) as c:
            c.sendall((json.dumps(COMMANDS[word]) + '\n').encode('utf-8'))
    except OSError:
        note(KEYS_LOG, '%s pressed, but no spoken conversation is running' % word)
        chime('none')
        return False
    note(KEYS_LOG, 'next: cut off or turn ended' if word == 'next' else 'stop: voice off, back to text')
    chime(word)
    return True


MOD_ALT, MOD_CONTROL, MOD_NOREPEAT = 0x0001, 0x0002, 0x4000
WM_HOTKEY, WM_QUIT = 0x0312, 0x0012
HOTKEYS = {1: ('next', 0x4E), 2: ('stop', 0x53)}   # 0x4E is N, 0x53 is S


class POINT(ctypes.Structure):
    _fields_ = [('x', ctypes.c_long), ('y', ctypes.c_long)]


class MSG(ctypes.Structure):
    _fields_ = [('hwnd', ctypes.c_void_p), ('message', ctypes.c_uint), ('wParam', ctypes.c_size_t),
                ('lParam', ctypes.c_ssize_t), ('time', ctypes.c_uint32), ('pt', POINT), ('lPrivate', ctypes.c_uint32)]


class Hotkeys(threading.Thread):
    """Ctrl+Alt+N and Ctrl+Alt+S, held by Windows for this helper (RegisterHotKey). Windows hands a key press to
    the thread that asked for it, so this thread asks, then waits for presses until it's told to quit."""

    def __init__(self):
        super().__init__(name='voice-keys', daemon=True)
        self.status = {'next': False, 'stop': False, 'error': ''}
        self.thread_id = None
        self.ready = threading.Event()

    def run(self):
        u = _dll('user32')
        self.thread_id = _dll('kernel32').GetCurrentThreadId()
        u.RegisterHotKey.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
        u.GetMessageW.argtypes = [ctypes.POINTER(MSG), ctypes.c_void_p, ctypes.c_uint, ctypes.c_uint]
        for hid, (word, vk) in HOTKEYS.items():
            if u.RegisterHotKey(None, hid, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, vk):
                self.status[word] = True
            else:
                self.status['error'] = 'Another program already uses Ctrl+Alt+%s' % chr(vk)
                note(LOG, self.status['error'])
        self.ready.set()
        msg = MSG()
        while u.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            if msg.message == WM_HOTKEY and msg.wParam in HOTKEYS:
                threading.Thread(target=send, args=(HOTKEYS[msg.wParam][0],), daemon=True).start()
        for hid in HOTKEYS:
            u.UnregisterHotKey(None, hid)
        self.status.update(next=False, stop=False)

    def quit(self):
        if self.thread_id:
            _dll('user32').PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0)


# ---------------------------------------------------------------- the services helper

def port_up(port, path='/', timeout=2.0):
    import urllib.request
    try:
        with urllib.request.urlopen('http://127.0.0.1:%d%s' % (port, path), timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def service_commands(cfg):
    """What each service runs, from the settings the setup saved. A service whose files aren't there is left out."""
    out = {}
    exe, model = cfg.get('whisper_exe'), cfg.get('whisper_model')
    if exe and model and os.path.isfile(exe) and os.path.isfile(model):
        args = [exe, '--host', '127.0.0.1', '--port', str(WHISPER_PORT), '--model', model,
                '--inference-path', '/v1/audio/transcriptions', '--threads', str(os.cpu_count() or 4)]
        if cfg.get('ffmpeg_dir'):
            args.append('--convert')
        out['whisper'] = {'args': args, 'cwd': os.path.dirname(exe), 'port': WHISPER_PORT, 'path': '/health', 'env': {}}
    kdir, kpy = cfg.get('kokoro_dir'), cfg.get('kokoro_python')
    if kdir and kpy and os.path.isfile(kpy):
        # The same settings as Kokoro's own start-cpu.ps1, kept on this PC only (127.0.0.1).
        env = {'PYTHONUTF8': '1', 'PROJECT_ROOT': kdir, 'USE_GPU': 'false', 'USE_ONNX': 'false',
               'PYTHONPATH': kdir + os.pathsep + os.path.join(kdir, 'api'), 'MODEL_DIR': 'src/models',
               'VOICES_DIR': 'src/voices/v1_0', 'WEB_PLAYER_PATH': os.path.join(kdir, 'web')}
        dll = r'C:\Program Files\eSpeak NG\libespeak-ng.dll'
        if os.path.isfile(dll):
            env['PHONEMIZER_ESPEAK_LIBRARY'] = dll
        out['kokoro'] = {'args': [kpy, '-m', 'uvicorn', 'api.src.main:app', '--host', '127.0.0.1', '--port', str(KOKORO_PORT)],
                         'cwd': kdir, 'port': KOKORO_PORT, 'path': '/v1/models', 'env': env}
    connector = PHONE / 'speechify-voice.py'
    if cfg.get('speechify') and connector.is_file():
        out['speechify'] = {'args': [sys.executable, str(connector)], 'cwd': str(PHONE), 'port': SPEECHIFY_PORT,
                            'path': '/v1/models', 'env': {}}
    return out


class Services:
    def __init__(self):
        self.procs, self.started, self.hotkeys = {}, {}, None
        self.stopping = threading.Event()

    def start(self, name, spec, cfg):
        env = dict(os.environ, **spec['env'])
        if cfg.get('ffmpeg_dir'):
            env['PATH'] = cfg['ffmpeg_dir'] + os.pathsep + env.get('PATH', '')
        log_dir = VOICEMODE_DIR / 'logs' / name
        log_dir.mkdir(parents=True, exist_ok=True)
        log = open(PHONE / 'speechify-voice.log' if name == 'speechify' else log_dir / (name + '.log'), 'a', encoding='utf-8')
        kw = {'creationflags': CREATE_NO_WINDOW} if windows() else {}
        self.procs[name] = subprocess.Popen(spec['args'], cwd=spec['cwd'], env=env, stdout=log, stderr=subprocess.STDOUT,
                                            stdin=subprocess.DEVNULL, **kw)
        self.started[name] = time.time()
        note(LOG, 'started %s' % name)

    def reconcile(self):
        """One pass: start what should run, restart what stopped, stop what was switched off."""
        cfg = load_config()
        wanted = service_commands(cfg)
        for name, p in list(self.procs.items()):
            if name not in wanted or p.poll() is not None:
                if p.poll() is None:
                    p.terminate()
                    note(LOG, 'stopped %s (switched off)' % name)
                else:
                    note(LOG, '%s exited with code %s' % (name, p.returncode))
                del self.procs[name]
        for name, spec in wanted.items():
            if name in self.procs:
                continue
            if time.time() - self.started.get(name, 0) < 10:   # a service that keeps failing restarts at most every 10 s
                continue
            if port_up(spec['port'], spec['path'], timeout=1.0):   # already running (left from before); leave it
                continue
            try:
                self.start(name, spec, cfg)
            except OSError as e:
                note(LOG, 'could not start %s: %s' % (name, e))
                self.started[name] = time.time()
        want_keys = cfg.get('keys', False) and windows()
        if want_keys and not (self.hotkeys and self.hotkeys.is_alive()):
            self.hotkeys = Hotkeys()
            self.hotkeys.start()
            self.hotkeys.ready.wait(5)
        elif not want_keys and self.hotkeys and self.hotkeys.is_alive():
            self.hotkeys.quit()
            self.hotkeys.join(5)
            self.hotkeys = None

    def status(self):
        keys = self.hotkeys.status if self.hotkeys and self.hotkeys.is_alive() else {'next': False, 'stop': False, 'error': ''}
        return {'running': sorted(n for n, p in self.procs.items() if p.poll() is None), 'keys': keys, 'pid': os.getpid()}

    def stop_all(self):
        self.stopping.set()
        for p in self.procs.values():
            if p.poll() is None:
                p.terminate()
        if self.hotkeys and self.hotkeys.is_alive():
            self.hotkeys.quit()


def status_server(services):
    """Answers on 127.0.0.1:8897 with what's running. Binding it first means only one helper ever runs."""
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class H(BaseHTTPRequestHandler):
        def _send(self, code, obj):
            b = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            self._send(200, services.status())

        def do_POST(self):
            # Stopping needs a header a web page can't add without asking first, so only programs on this PC can stop it.
            if self.path != '/stop' or self.headers.get('X-YouCloned') != 'stop':
                return self._send(403, {'error': 'refused'})
            self._send(200, {'ok': True})
            threading.Thread(target=services.stop_all, daemon=True).start()

        def log_message(self, *a):
            pass

    return ThreadingHTTPServer(('127.0.0.1', STATUS_PORT), H)


def run_services(poll=3.0):
    services = Services()
    try:
        server = status_server(services)
    except OSError:
        return 0   # another copy is already running
    threading.Thread(target=server.serve_forever, daemon=True).start()
    note(LOG, 'services helper started')
    while not services.stopping.is_set():
        try:
            services.reconcile()
        except Exception as e:   # one bad pass never takes the voice down
            note(LOG, 'check failed: %s' % e)
        services.stopping.wait(poll)
    server.shutdown()
    note(LOG, 'services helper stopped')
    return 0


def stop_services():
    import urllib.request
    req = urllib.request.Request('http://127.0.0.1:%d/stop' % STATUS_PORT, data=b'', method='POST',
                                 headers={'X-YouCloned': 'stop'})
    try:
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        return 1
    for _ in range(20):
        if not port_up(STATUS_PORT, timeout=0.5):
            return 0
        time.sleep(0.5)
    return 0


def main(argv):
    word = argv[1] if len(argv) > 1 else ''
    if word == 'mcp':
        return run_mcp()
    if word == 'services':
        return run_services()
    if word == 'stop-services':
        return stop_services()
    if word == 'send' and len(argv) > 2:
        return 0 if send(argv[2]) else 1
    if word == 'set' and len(argv) > 3:
        save_setting(argv[2], argv[3])
        return 0
    if word == 'status':
        import urllib.request
        try:
            print(urllib.request.urlopen('http://127.0.0.1:%d/' % STATUS_PORT, timeout=3).read().decode())
            return 0
        except Exception:
            print('{"running": [], "keys": {}, "error": "the services helper is not running"}')
            return 1
    if word == 'save-key':
        key = ''.join(sys.stdin.readline().split())
        if len(key) < 20:
            print("That doesn't look like a full key.")
            return 1
        try:
            save_key(key)
        except OSError as e:
            print(str(e))
            return 1
        print('saved')
        return 0
    if word == 'has-key':
        return 0 if read_key() else 1
    if word == 'forget-key':
        forget_key()
        return 0
    print(__doc__ or 'Usage: pc_voice.py mcp | services | send next|stop | set NAME VALUE | status | stop-services | save-key | has-key | forget-key')
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv) or 0)
