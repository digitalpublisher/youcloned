# Fix voice-05 (fixes.json): four requests at once reach Speechify one at a time, and a 429 "slow down" is retried.
# Runs against a fake Speechify, so no key and no sound. Usage: python3 -I tools/voice/test_speechify_voice.py

import importlib.util, io, threading, time, urllib.error, urllib.request, json, sys
from http.server import ThreadingHTTPServer
import os
TARGET = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "youcloned", "voice", "speechify-voice.py")
spec = importlib.util.spec_from_file_location("sv", TARGET); sv = importlib.util.module_from_spec(spec); spec.loader.exec_module(sv)
sv.setting = lambda n, d="": {"SPEECHIFY_API_KEY": "x"}.get(n, d or "leonard")
state = {'inflight': 0, 'peak': 0, 'calls': 0, 'lock': threading.Lock()}
class Up:
    def __init__(self): self.n = 0
    def read1(self, k):
        self.n += 1
        if self.n > 3:
            with state['lock']: state['inflight'] -= 1
            return b''
        time.sleep(0.1); return b'\0\0' * 10
def fake_urlopen(req, timeout=30):
    with state['lock']:
        state['calls'] += 1
        if state['calls'] == 1:
            raise urllib.error.HTTPError(req.full_url, 429, 'slow', {'Retry-After': '0.2'}, io.BytesIO())
        state['inflight'] += 1; state['peak'] = max(state['peak'], state['inflight'])
    return Up()
REAL = urllib.request.urlopen; sv.urllib.request.urlopen = fake_urlopen
srv = ThreadingHTTPServer(('127.0.0.1', 18895), sv.Handler); threading.Thread(target=srv.serve_forever, daemon=True).start()
codes = []
def hit():
    r = REAL(urllib.request.Request('http://127.0.0.1:18895/v1/audio/speech', data=json.dumps({'input': 'hi', 'response_format': 'pcm'}).encode()))
    codes.append((r.status, len(r.read())))
ts = [threading.Thread(target=hit) for _ in range(4)]; [t.start() for t in ts]; [t.join() for t in ts]
print('codes', codes, 'upstream calls', state['calls'], 'peak in flight', state['peak'])
assert all(c == (200, 60) for c in codes) and state['peak'] == 1 and state['calls'] == 5
print('PASS')
