#!/usr/bin/env python3
"""YouCloned dashboard server. Serves the dashboard on this computer only.

GET  /            the dashboard
GET  /state.json  live numbers the YouCloned add-on writes (plan usage, words, name)
POST /do          {"text": "..."} queues a job; the add-on puts it into Claude's chat
POST /open        {"url": "https://..."} opens a BNSN, YouTube or OpenAI address in this computer's web browser
POST /talk        starts a voice conversation in the owner's YouCloned chat: through Jon's voice relay where
                  one runs, otherwise queued like /do so the add-on types it into the chat
"""
import json, os, subprocess, sys, time, urllib.parse, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.expanduser("~"), ".youcloned")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4600
RELAY = "http://127.0.0.1:8771/say"
TALK = "Talk was pressed in YouCloned. Start a voice conversation now: call converse with a short hello and listen (listen_duration_min 8, listen_duration_max 600, so a short pause never ends their turn)."
# The dashboard's links (the BNSN apps, Jon's video, the course, Codex) open only on these sites.
OPEN_SITES = ("bnsn.ai", "youtube.com", "youtu.be", "openai.com")


def can_open(url):
    try:
        u = urllib.parse.urlparse(url)
    except Exception:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == d or host.endswith("." + d) for d in OPEN_SITES)


def open_in_browser(url):
    if sys.platform == "darwin":
        subprocess.Popen(["/usr/bin/open", url])
    elif os.name == "nt":
        os.startfile(url)
    else:
        subprocess.Popen(["xdg-open", url])


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.split("?")[0] in ("/feed.json", "/feed-thumb.jpg"):
            # The promo feed and its thumbnail, as the add-on last saved them.
            try:
                if self.path.startswith("/feed.json"):
                    body, kind = open(os.path.join(DATA, "feed.json"), "rb").read(), "application/json"
                else:
                    body, kind = open(open(os.path.join(DATA, "feed-thumb.txt")).read().strip(), "rb").read(), "image/jpeg"
            except Exception:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.split("?")[0] == "/state.json":
            path = os.path.join(DATA, "state.json")
            body = open(path, "rb").read() if os.path.exists(path) else b"{}"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def do_POST(self):
        if self.path == "/talk":
            # The talk goes to the chat the add-on last wrote into state.json, through the voice relay.
            # A buyer's computer has no relay: the talk is queued as a job and the add-on types it in.
            try:
                state = json.load(open(os.path.join(DATA, "state.json")))
                body = json.dumps({"session": state["session"], "text": TALK}).encode()
                req = urllib.request.Request(RELAY, data=body, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=3).read()
                self.send_response(204)
            except Exception:
                try:
                    os.makedirs(DATA, exist_ok=True)
                    with open(os.path.join(DATA, "jobs.jsonl"), "a") as f:
                        f.write(json.dumps({"text": TALK, "at": time.time()}) + "\n")
                    self.send_response(204)
                except Exception:
                    self.send_response(502)
            self.end_headers()
            return
        if self.path == "/open":
            try:
                n = int(self.headers.get("Content-Length") or 0)
                url = str(json.loads(self.rfile.read(min(n, 20000)) or b"{}").get("url", "")).strip()
            except Exception:
                url = ""
            if not can_open(url):
                self.send_error(400)
                return
            try:
                open_in_browser(url)
                self.send_response(204)
            except Exception:
                self.send_response(502)
            self.end_headers()
            return
        if self.path != "/do":
            self.send_error(404)
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
            job = json.loads(self.rfile.read(min(n, 20000)) or b"{}")
            text = str(job.get("text", "")).strip()[:4000]
        except Exception:
            text = ""
        if not text:
            self.send_error(400)
            return
        os.makedirs(DATA, exist_ok=True)
        with open(os.path.join(DATA, "jobs.jsonl"), "a") as f:
            f.write(json.dumps({"text": text, "at": time.time()}) + "\n")
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    # Runs as a background service, so it is up before Claude is. While another copy holds the
    # port (an older YouCloned version), it waits for the port instead of quitting.
    while True:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
            break
        except OSError:
            time.sleep(5)
    server.serve_forever()
