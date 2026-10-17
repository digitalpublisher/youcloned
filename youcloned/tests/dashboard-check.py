#!/usr/bin/env python3
"""Loads the dashboard (dashboard/index.html through dashboard/server.py) with sample state.json files and
proves a buyer never sees made-up content and every visible button does something.

  python3 youcloned/tests/dashboard-check.py [--shots DIR]

States checked: empty (the add-on has not written anything yet), fresh (nothing set up) and set up (every
step done, the library has sources, the Support helper has drafts). Each view is screenshotted at desktop
width and at 390px when --shots is given. /do, /open and /talk are caught in the browser, so nothing is
queued for a chat and no browser window opens. Needs Python Playwright with Chromium.
"""
import argparse, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SERVER = os.path.join(ROOT, "dashboard", "server.py")
NODE = shutil.which("node") or os.path.expanduser("~/.nvm/versions/node/v24.14.1/bin/node")
LONG_DASH = chr(0x2014)

# Text from the old sample panels. None of it may show for any buyer.
BANNED = ["7,514", "$4,120", "$3,180", "$214", "Garden", "Backyard", "Seed Starter", "Zoom Pro", "Canva", "Old email tool",
          "Sorted 38", "trolls", "Sample", "412 of", "1,212 of", "196 of", "40 of 40", "25 of 25", "Clip cutter", "Watchdog",
          "Comment helper", "7 of 9", "Up 17%", "Three emails", "Four support", "OfferBuilder", "Money finder",
          "Sales by product", "Made or saved", "Passed every check", "Welcome email 3", "Slack", "Zoom", "Money"]
VIEWS = ["home", "crew", "codex", "setup", "learn"]
SITES = ("bnsn.ai", "youtube.com", "youtu.be", "openai.com")


def steps():
    out = subprocess.run([NODE, "-e", "import('" + os.path.join(ROOT, "hooks", "steps.js") + "').then(m=>console.log(JSON.stringify(m.STEPS.map(s=>({id:s.id,title:s.title,why:s.why})))))"],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def states():
    now = int(time.time() * 1000)
    st = steps()
    review = lambda n: "Show me the drafts in /Users/pat/YouCloned/crew/" + n + "/drafts one at a time, newest first. Before anything goes out, show me exactly what goes where and wait for my yes."
    crew = lambda on, sup, ran: [
        {"name": "support", "title": "Support", "what": "Drafts answers to customer questions in your voice", "drafts": sup, "running": False, "lastRun": ran, "review": review("support") if on else ""},
        {"name": "inbox", "title": "Inbox", "what": "Sorts your new email and drafts the replies that need you", "drafts": 0, "running": False, "lastRun": ran, "review": review("inbox") if on else ""},
    ]
    fresh = {"claudePct": 12, "claudeLabel": "Claude plan · this 5 hours", "claudeSpan": "5-hour plan", "claudeAt": now, "words": None,
             "skillKey": False, "session": "s1", "listening": False, "at": now, "codexReady": False, "library": {"sources": None},
             "crewOn": False, "crew": crew(False, 0, 0),
             "setup": {"steps": [dict(s, done=False, skipped=False) for s in st], "next": st[0]["id"]}}
    done = {"claudePct": 38, "claudeLabel": "Claude plan · this 5 hours · resets 6:40 PM", "claudeSpan": "5-hour plan", "claudeAt": now,
            "words": 48210, "name": "Pat", "skillKey": True, "session": "s1", "listening": False, "at": now,
            "codexReady": True, "codex": {"left": 70, "label": "Codex · resets Fri 9:00 AM"}, "library": {"sources": 4},
            "crewOn": True, "crew": crew(True, 2, now - 3600000),
            "setup": {"steps": [dict(s, done=True, skipped=False) for s in st], "next": None}}
    return {"empty": {}, "fresh": fresh, "setup": done}


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


class Dash:
    def __init__(self, state, feed):
        self.home = tempfile.mkdtemp(prefix="yc-dash-")
        os.makedirs(os.path.join(self.home, ".youcloned"))
        with open(os.path.join(self.home, ".youcloned", "state.json"), "w") as f:
            json.dump(state, f)
        if feed:
            with open(os.path.join(self.home, ".youcloned", "feed.json"), "w") as f:
                json.dump(feed, f)
        self.port = free_port()
        env = dict(os.environ, HOME=self.home, USERPROFILE=self.home)
        self.proc = subprocess.Popen([sys.executable, SERVER, str(self.port)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.url = "http://127.0.0.1:%d/" % self.port
        for _ in range(100):
            try:
                urllib.request.urlopen(self.url + "state.json", timeout=1).read(); return
            except Exception:
                time.sleep(0.05)
        raise SystemExit("dashboard server did not start")

    def close(self):
        self.proc.terminate(); self.proc.wait(5); shutil.rmtree(self.home, ignore_errors=True)


VISIBLE_BUTTONS = """() => [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled)
  .map(b => ({ label: b.textContent.trim() || b.getAttribute('aria-label'), m: b.dataset.m || '' }))"""
VIEW_NOW = "() => [...document.querySelectorAll('[data-v]')].filter(v => !v.hidden).map(v => v.dataset.v)[0]"
GO = "v => document.querySelector('.crumbs [data-m=\"' + v + '\"]').click()"


def check(page, name, problems, sent, shots, width):
    page.wait_for_timeout(700)  # state.json and feed.json load, the cards draw
    pressed = 0
    for view in VIEWS:
        page.evaluate(GO, view)
        page.wait_for_timeout(150)
        text = page.evaluate("() => document.body.innerText")
        for bad in BANNED:
            if bad in text:
                problems.append("%s/%s@%d shows %r" % (name, view, width, bad))
        if LONG_DASH in text:
            problems.append("%s/%s@%d shows an em dash" % (name, view, width))
        over = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        if over > 1:
            problems.append("%s/%s@%d scrolls sideways by %dpx" % (name, view, width, over))
        if shots:
            page.evaluate("() => document.querySelectorAll('.toast').forEach(t => t.classList.remove('on'))")
            page.wait_for_timeout(300)  # the toast fades out
            page.screenshot(path=os.path.join(shots, "%s-%s-%d.png" % (name, view, width)), full_page=True)
        # Every visible, enabled button does something: changes the view, toggles the step list, or sends a request.
        buttons = page.evaluate(VISIBLE_BUTTONS)
        for i, b in enumerate(buttons):
            page.evaluate(GO, view)
            before_n, before_list = len(sent), page.evaluate("() => document.getElementById('steplist').hidden")
            page.evaluate("([i]) => { const bs = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null && !b.disabled); bs[i].click() }", [i])
            page.wait_for_timeout(120)
            pressed += 1
            now = page.evaluate(VIEW_NOW)
            moved = now != view or (b["m"] and now == b["m"])  # a tab button for the view it is on keeps it there
            toggled = page.evaluate("() => document.getElementById('steplist').hidden") != before_list
            if not (moved or toggled or len(sent) > before_n):
                problems.append("%s/%s@%d button %r does nothing" % (name, view, width, b["label"]))
            if b["m"] and b["m"] != page.evaluate(VIEW_NOW):
                problems.append("%s/%s@%d button %r went to the wrong view" % (name, view, width, b["label"]))
    return pressed


def allowed_jobs(st):
    ok = {"Set me up with YouCloned. Use the youcloned:setup skill.", "/youcloned codex", "What is in my library?",
          "Set up my clone's voice with YouCloned: call setup_next with only set to voice, and walk me through it.",
          "/youcloned crew support", "/youcloned crew inbox", "Write the story section of my VSL with Jon's VSL Story Writer skill.",
          "Show me my crew."}
    for c in (st.get("crew") or []):
        if c.get("review"):
            ok.add(c["review"])
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default="")
    a = ap.parse_args()
    if a.shots:
        os.makedirs(a.shots, exist_ok=True)
    from playwright.sync_api import sync_playwright
    problems, pressed = [], 0
    feed = {"items": [{"id": "oms-1", "title": "Over My Shoulder: the new crew", "note": "Watch the crew work.", "button": "Show me the crew",
                       "job": "Show me my crew.", "watch": "https://www.youtube.com/watch?v=abc"}]}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, st in states().items():
            dash = Dash(st, feed if name == "setup" else None)
            try:
                for width, height in ((1280, 900), (390, 844)):
                    sent = []
                    page = browser.new_page(viewport={"width": width, "height": height})

                    def catch(route, request, sent=sent):
                        body = request.post_data or ""
                        sent.append((request.url.rsplit("/", 1)[-1], json.loads(body) if body else {}))
                        route.fulfill(status=204, body="")
                    for path in ("do", "open", "talk"):
                        page.route("**/" + path, catch)
                    page.on("popup", lambda pop: problems.append("%s: a window opened for %s" % (name, pop.url)))
                    page.goto(dash.url)
                    pressed += check(page, name, problems, sent, a.shots, width)
                    jobs = allowed_jobs(st)
                    for kind, body in sent:
                        if kind == "do" and body.get("text") not in jobs:
                            problems.append("%s@%d sent an unknown job: %r" % (name, width, body.get("text")))
                        if kind == "open":
                            url = body.get("url", "")
                            host = urllib.parse.urlparse(url).hostname or ""
                            if not url.startswith("https://") or not any(host == d or host.endswith("." + d) for d in SITES):
                                problems.append("%s@%d opens an address outside the allowed sites: %r" % (name, width, url))
                    if name == "fresh" and not any(k == "do" and b.get("text", "").startswith("Set up my clone's voice") for k, b in sent):
                        problems.append("fresh@%d: the logo does not start the voice setup" % width)
                    if name == "setup" and not any(k == "talk" for k, b in sent):
                        problems.append("setup@%d: the logo does not start Talk" % width)
                    page.close()
                # What each buyer sees on the home view.
                page = browser.new_page(viewport={"width": 1280, "height": 900})
                page.goto(dash.url); page.wait_for_timeout(700)
                cards = dict(page.evaluate("() => ['hc-setup','hc-crew','hc-lib','homecards','today'].map(id => [id, !document.getElementById(id).hidden])"))
                today = page.evaluate("() => document.getElementById('today').innerText")
                want = {"empty": {"hc-setup": False, "hc-crew": False, "hc-lib": False, "homecards": False, "today": False},
                        "fresh": {"hc-setup": True, "hc-crew": False, "hc-lib": False, "homecards": True, "today": True},
                        "setup": {"hc-setup": False, "hc-crew": True, "hc-lib": True, "homecards": True, "today": True}}[name]
                if cards != want:
                    problems.append("%s: home cards %r, wanted %r" % (name, cards, want))
                for line in {"empty": [], "fresh": ["Next setup step: Your tools (0 of 10 done)"],
                             "setup": ["Support helper: 2 drafts waiting for you", "Your library holds 4 sources", "New from Jon: Over My Shoulder: the new crew"]}[name]:
                    if line not in today:
                        problems.append("%s: today is missing %r (it says %r)" % (name, line, today))
                page.close()
                # The server opens only the allowed sites; a bad address is refused before anything runs.
                req = urllib.request.Request(dash.url + "open", data=json.dumps({"url": "file:///etc/hosts"}).encode(), headers={"Content-Type": "application/json"})
                try:
                    urllib.request.urlopen(req, timeout=3); problems.append("/open accepted a file address")
                except urllib.error.HTTPError as e:
                    if e.code != 400:
                        problems.append("/open answered %d to a file address" % e.code)
            finally:
                dash.close()
        browser.close()
    if problems:
        print("\n".join("FAIL " + x for x in problems))
        sys.exit(1)
    print("dashboard check passed: 3 states, %d views each at 2 widths, %d button presses, every one did something, no sample text" % (len(VIEWS), pressed))


if __name__ == "__main__":
    main()
