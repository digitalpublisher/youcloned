# Small local connector that lets VoiceMode speak in a Speechify voice: it takes VoiceMode's request on 127.0.0.1:8895 and streams Speechify's audio back.
# Your Speechify key is read at run time from ~/.voicemode/speechify.env on a Mac, or from Windows Credential Manager on a PC
# (through pc_voice.py, which sits next to this file there). It never goes anywhere but Speechify.
import json
import os
import sys
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.sax.saxutils import escape

PORT = 8895
MODEL = "simba-3.2"
ENV = os.path.expanduser("~/.voicemode/speechify.env")
FREE_VOICES = ("am_michael", "af_sky", "alloy", "nova")


def setting(name, default=""):
    if name == "SPEECHIFY_API_KEY" and sys.platform == "win32":  # a PC keeps the key in Credential Manager, never in a file
        import pc_voice
        return pc_voice.read_key() or default
    try:
        for line in open(ENV):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    except OSError:
        pass
    return default


def speechify_stream(text, voice, speed, accept):
    pct = round((speed - 1) * 100)
    if pct:  # "+10%" means 1.1x speed
        text = '<speak><prosody rate="%+d%%">%s</prosody></speak>' % (pct, escape(text))
    body = json.dumps({"input": text, "voice_id": voice, "model": MODEL}).encode()
    req = urllib.request.Request("https://api.speechify.ai/v1/audio/stream", data=body, headers={
        "Authorization": "Bearer " + setting("SPEECHIFY_API_KEY"),
        "Content-Type": "application/json",
        "Accept": accept,
    })
    return urllib.request.urlopen(req, timeout=30)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.rstrip("/").endswith("/models"):
            return self._json({"object": "list", "data": [{"id": MODEL, "object": "model"}]})
        if self.path.rstrip("/").endswith("/voices"):
            return self._json({"voices": [setting("SPEECHIFY_VOICE", "leonard")]})
        self._json({"ok": True})

    def do_POST(self):
        if not self.path.endswith("/audio/speech"):
            return self._json({"error": "not found"}, 404)
        req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        text = (req.get("input") or "").strip()
        fmt = "pcm" if req.get("response_format") == "pcm" else "mp3"
        voice = req.get("voice") or ""
        if not voice or voice in FREE_VOICES or len(voice) > 30:
            voice = setting("SPEECHIFY_VOICE", "leonard")
        speed = float(req.get("speed") or setting("SPEECHIFY_SPEED", "1.0"))
        t0 = time.time()
        try:
            up = speechify_stream(text, voice, speed, "audio/pcm" if fmt == "pcm" else "audio/mpeg")
        except Exception as e:  # VoiceMode then falls back to the free voice
            print("[speechify] upstream error: %s" % e, flush=True)
            return self._json({"error": str(e)}, 502)
        self.send_response(200)
        self.send_header("Content-Type", "audio/pcm" if fmt == "pcm" else "audio/mpeg")
        self.end_headers()
        carry = b""
        try:
            while True:
                chunk = up.read1(4096)
                if not chunk:
                    break
                if fmt == "pcm":  # keep 16-bit samples whole across chunk edges
                    chunk, carry = carry + chunk, b""
                    if len(chunk) % 2:
                        chunk, carry = chunk[:-1], chunk[-1:]
                self.wfile.write(chunk)
                self.wfile.flush()
        except BrokenPipeError:
            pass
        print("[speechify] %s %s %d chars in %.2fs" % (voice, fmt, len(text), time.time() - t0), flush=True)

    def _json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    print("[speechify] listening on 127.0.0.1:%d" % PORT, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
