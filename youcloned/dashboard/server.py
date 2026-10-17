#!/usr/bin/env python3
"""YouCloned dashboard server. Serves the dashboard on this computer only.

GET  /            the dashboard
GET  /state.json  live numbers the YouCloned add-on writes (plan usage, words, name)
POST /do          {"text": "..."} queues a job; the add-on puts it into Claude's chat
POST /talk        asks Isaac's voice relay to start a voice conversation in the owner's YouCloned chat
POST /skip        {"crew": "support", "file": "x.md"} moves a draft the Needs You list shows into the helper's skipped folder
"""
import json, os, sys, time, urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.expanduser("~"), ".youcloned")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4600
RELAY = "http://127.0.0.1:8771/say"
TALK = "Talk to Isaac was pressed in YouCloned. Start a voice conversation now: call converse with a short hello and listen."


def skip_draft(crew, name):
    """Moves one waiting draft into skipped/, next to drafts/. Only a draft state.json lists for that helper
    can be named, so no other file on the computer can be reached. True when it moved."""
    try:
        state = json.load(open(os.path.join(DATA, "state.json")))
        helper = next(c for c in state.get("crew") or [] if c.get("name") == crew)
        if name not in [d.get("name") for d in helper.get("drafts") or []] or os.path.basename(name) != name:
            return False
        src = os.path.join(helper["dir"], "drafts", name)
        if not os.path.isfile(src):
            return False
        os.makedirs(os.path.join(helper["dir"], "skipped"), exist_ok=True)
        os.replace(src, os.path.join(helper["dir"], "skipped", name))
        return True
    except Exception:
        return False


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
            try:
                state = json.load(open(os.path.join(DATA, "state.json")))
                body = json.dumps({"session": state["session"], "text": TALK}).encode()
                req = urllib.request.Request(RELAY, data=body, headers={"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=3).read()
                self.send_response(204)
            except Exception:
                self.send_response(502)
            self.end_headers()
            return
        if self.path == "/skip":
            try:
                n = int(self.headers.get("Content-Length") or 0)
                ask = json.loads(self.rfile.read(min(n, 4000)) or b"{}")
                moved = skip_draft(str(ask.get("crew", "")), str(ask.get("file", "")))
            except Exception:
                moved = False
            self.send_response(204 if moved else 404)
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
