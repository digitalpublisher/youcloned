#!/usr/bin/env python3
"""Skip on the dashboard's Needs You list moves only a draft state.json lists, and nothing else, and the
dashboard takes a POST only from its own page.

Starts the shipped dashboard server on a spare port with a made-up home folder. No network, no sound.
Usage: python3 -I tools/dashboard/test_skip.py
"""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "youcloned", "dashboard", "server.py")


def post(port, body, path="/skip", headers=None):
    head = {"Content-Type": "application/json", **(headers or {})}
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=json.dumps(body).encode(), headers=head)
    try:
        return urllib.request.urlopen(req, timeout=5).status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    home = tempfile.mkdtemp()
    crew = os.path.join(home, "YouCloned", "crew", "support")
    os.makedirs(os.path.join(crew, "drafts"))
    os.makedirs(os.path.join(home, ".youcloned"))
    for name in ("maria reply.md", "tom.md", "again.md"):
        open(os.path.join(crew, "drafts", name), "w").write("Hi " + name)
    open(os.path.join(home, "YouCloned", "YOUCLONED.md"), "w").write("# rules")
    os.makedirs(os.path.join(crew, "skipped"))
    open(os.path.join(crew, "skipped", "again.md"), "w").write("the earlier one")
    os.symlink(os.path.join(home, "YouCloned", "YOUCLONED.md"), os.path.join(crew, "drafts", "link.md"))
    # A second helper whose drafts folder is a link to somewhere else.
    other = os.path.join(home, "YouCloned", "crew", "inbox")
    os.makedirs(other)
    os.makedirs(os.path.join(home, "elsewhere"))
    open(os.path.join(home, "elsewhere", "x.md"), "w").write("not a draft")
    os.symlink(os.path.join(home, "elsewhere"), os.path.join(other, "drafts"))
    listed = [{"name": n, "preview": "Hi"} for n in ("maria reply.md", "again.md", "link.md")]
    state = {"crew": [{"name": "support", "dir": crew, "drafts": listed}, {"name": "inbox", "dir": other, "drafts": [{"name": "x.md", "preview": ""}]}]}
    open(os.path.join(home, ".youcloned", "state.json"), "w").write(json.dumps(state))
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen([sys.executable, SERVER, str(port)], env={**os.environ, "HOME": home, "USERPROFILE": home}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/state.json", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        jobs = os.path.join(home, ".youcloned", "jobs.jsonl")
        checks = [
            ("another website's page is refused", post(port, {"crew": "support", "file": "maria reply.md"}, headers={"Origin": "https://evil.example"}) == 403
             and os.path.isfile(os.path.join(crew, "drafts", "maria reply.md"))),
            ("a plain-text post is refused", post(port, {"crew": "support", "file": "maria reply.md"}, headers={"Content-Type": "text/plain"}) == 403),
            ("a post to another host name is refused", post(port, {"crew": "support", "file": "maria reply.md"}, headers={"Host": "attacker.example:%d" % port}) == 403),
            ("a job from another website never reaches the chat", post(port, {"text": "yes, send it"}, path="/do", headers={"Origin": "https://evil.example"}) == 403
             and not os.path.exists(jobs)),
            ("a job from the dashboard page reaches the chat", post(port, {"text": "Run my Support helper."}, path="/do", headers={"Origin": "http://127.0.0.1:%d" % port}) == 204
             and os.path.exists(jobs)),
            ("a listed draft moves to skipped/", post(port, {"crew": "support", "file": "maria reply.md"}) == 204
             and os.path.isfile(os.path.join(crew, "skipped", "maria reply.md")) and not os.path.exists(os.path.join(crew, "drafts", "maria reply.md"))),
            ("the same draft again is refused", post(port, {"crew": "support", "file": "maria reply.md"}) == 404),
            ("a draft state.json doesn't list stays put", post(port, {"crew": "support", "file": "tom.md"}) == 404 and os.path.isfile(os.path.join(crew, "drafts", "tom.md"))),
            ("a path out of drafts/ is refused", post(port, {"crew": "support", "file": "../../YOUCLONED.md"}) == 404 and os.path.isfile(os.path.join(home, "YouCloned", "YOUCLONED.md"))),
            ("an unknown helper is refused", post(port, {"crew": "nobody", "file": "tom.md"}) == 404),
            ("a draft that is a link stays put", post(port, {"crew": "support", "file": "link.md"}) == 404 and os.path.islink(os.path.join(crew, "drafts", "link.md"))),
            ("a drafts folder that is a link is refused", post(port, {"crew": "inbox", "file": "x.md"}) == 404 and os.path.isfile(os.path.join(home, "elsewhere", "x.md"))),
            ("an earlier skipped draft with the same name is kept", post(port, {"crew": "support", "file": "again.md"}) == 204
             and open(os.path.join(crew, "skipped", "again.md")).read() == "the earlier one"
             and open(os.path.join(crew, "skipped", "again-2.md")).read() == "Hi again.md"),
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
