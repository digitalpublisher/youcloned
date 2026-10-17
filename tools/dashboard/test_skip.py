#!/usr/bin/env python3
"""Skip on the dashboard's Needs You list moves only a draft state.json lists, and nothing else.

Starts the shipped dashboard server on a spare port with a made-up home folder. No network, no sound.
Usage: python3 -I tools/dashboard/test_skip.py
"""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "youcloned", "dashboard", "server.py")


def post(port, body):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/skip", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        return urllib.request.urlopen(req, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    home = tempfile.mkdtemp()
    crew = os.path.join(home, "YouCloned", "crew", "support")
    os.makedirs(os.path.join(crew, "drafts"))
    os.makedirs(os.path.join(home, ".youcloned"))
    for name in ("maria reply.md", "tom.md"):
        open(os.path.join(crew, "drafts", name), "w").write("Hi")
    open(os.path.join(home, "YouCloned", "YOUCLONED.md"), "w").write("# rules")
    state = {"crew": [{"name": "support", "dir": crew, "drafts": [{"name": "maria reply.md", "preview": "Hi"}]}]}
    open(os.path.join(home, ".youcloned", "state.json"), "w").write(json.dumps(state))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([sys.executable, SERVER, str(port)], env={**os.environ, "HOME": home}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/state.json", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        checks = [
            ("a listed draft moves to skipped/", post(port, {"crew": "support", "file": "maria reply.md"}) == 204
             and os.path.isfile(os.path.join(crew, "skipped", "maria reply.md")) and not os.path.exists(os.path.join(crew, "drafts", "maria reply.md"))),
            ("the same draft again is refused", post(port, {"crew": "support", "file": "maria reply.md"}) == 404),
            ("a draft state.json doesn't list stays put", post(port, {"crew": "support", "file": "tom.md"}) == 404 and os.path.isfile(os.path.join(crew, "drafts", "tom.md"))),
            ("a path out of drafts/ is refused", post(port, {"crew": "support", "file": "../../YOUCLONED.md"}) == 404 and os.path.isfile(os.path.join(home, "YouCloned", "YOUCLONED.md"))),
            ("an unknown helper is refused", post(port, {"crew": "inbox", "file": "tom.md"}) == 404),
        ]
    finally:
        proc.terminate()
        proc.wait()
    bad = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(("PASS " if ok else "FAIL ") + name)
    print("skip: all %d tests pass" % len(checks) if not bad else "skip: %d failed" % len(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
