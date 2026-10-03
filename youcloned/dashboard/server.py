#!/usr/bin/env python3
"""YouCloned dashboard server. Serves the dashboard on this computer only.

GET  /            the dashboard
GET  /state.json  live numbers the YouCloned add-on writes (plan usage, words, name)
POST /do          {"text": "..."} queues a job; the add-on puts it into Claude's chat
"""
import json, os, sys, time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.expanduser("~"), ".youcloned")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4600


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def do_GET(self):
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
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError:
        # Another YouCloned window already serves the dashboard on this port.
        sys.exit(0)
