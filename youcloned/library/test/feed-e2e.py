#!/usr/bin/env python3
"""End-to-end checks for feed.py against a running library (the local one run-local.sh starts).

Usage:
  python3 feed-e2e.py ENV_FILE WORK_DIR [--whisper URL] [--db-container NAME]

ENV_FILE holds YOUCLONED_LIBRARY_URL and YOUCLONED_LIBRARY_TOKEN. WORK_DIR is an empty scratch folder.
Makes its own small fixtures (a three-page website with a sitemap, txt, md, docx, pptx, html, epub, pdf,
a Feed me folder and, on a Mac, a spoken recording made with say), runs feed.py on each, and checks the
library finds every one. The transcribe check uses the local transcriber (default http://127.0.0.1:2022).
YouTube is never called: only the caption cleaner is checked.
It also checks --helper keeps every file inside the helper's own folders (links included), and that a source
the library lost goes in again. --db-container (the local database) adds the emptied-library check.
Prints PASS or FAIL per check and exits 1 when any check fails. Never prints the token.
"""
import functools
import http.server
import importlib.util
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import threading
import time
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
LIB = HERE.parent
FEED = LIB / "feed.py"
PLUGIN = LIB.parent

args = sys.argv[1:]
if len(args) < 2:
    sys.exit(__doc__)
ENV = Path(args[0]).resolve()
WORK = Path(args[1]).resolve()
WHISPER = args[args.index("--whisper") + 1] if "--whisper" in args else "http://127.0.0.1:2022"
DB = args[args.index("--db-container") + 1] if "--db-container" in args else None
WORK.mkdir(parents=True, exist_ok=True)

TOKEN = ""
for line in ENV.read_text(encoding="utf-8").splitlines():
    if line.startswith("YOUCLONED_LIBRARY_TOKEN="):
        TOKEN = line.split("=", 1)[1].strip()

outputs = []
results = []


def check(name, passed, detail=""):
    results.append(bool(passed))
    print(("PASS " if passed else "FAIL ") + name + ("" if passed or not detail else " :: " + str(detail)[-600:]), flush=True)


def feed(*argv, env_file=ENV, extra_env=None, python=None, py_flags=()):
    cmd = [python or sys.executable, *py_flags, str(FEED), *argv]
    if env_file is not None:
        cmd += ["--env", str(env_file)]
    env = dict(os.environ)
    env.update(extra_env or {})
    run = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=1800)
    out = run.stdout + run.stderr
    outputs.append(out)
    m = re.search(r"^FED (\d+) sources, (\d+) chunks$", run.stdout, re.M)
    fed = (int(m.group(1)), int(m.group(2))) if m else None
    return run.returncode, out, fed


def stats():
    code, out, _ = feed("stats")
    m = re.search(r"^STATS (.*)$", out, re.M)
    return json.loads(m.group(1)) if m else {}


def search(query, k=5):
    code, out, _ = feed("search", query, "--k", str(k))
    return out


def found(query, ref_part):
    out = search(query)
    first = out.split("\n2. ")[0]
    return ref_part in first, first[:500]


start = stats()
check("stats reads the library", "sources" in start, start)

# ---------- the shipped helper files say the right model and tools ----------

def front(name):
    text = (PLUGIN / "agents" / (name + ".md")).read_text(encoding="utf-8")
    meta = dict(re.findall(r"(?m)^(\w[\w-]*):\s*(.*)$", text.split("---")[1]))
    return meta, text


meta, body = front("librarian")
check("librarian file: model haiku, read-only Gmail tools", meta.get("model") == "haiku"
      and [t.strip() for t in meta.get("tools", "").split(",")] == ["Read", "Glob", "Grep", "Bash", "Write", "ToolSearch",
                                                                    "mcp__claude_ai_Gmail__search_threads", "mcp__claude_ai_Gmail__get_thread"]
      and "in:sent" in body, meta)
meta, body = front("wiki-writer")
check("wiki writer file: model sonnet, no connector tools", meta.get("model") == "sonnet"
      and [t.strip() for t in meta.get("tools", "").split(",")] == ["Read", "Glob", "Grep", "Bash", "Write", "Edit"]
      and "Library/index.md" in body, meta)

# ---------- no env file ----------
code, out, fed = feed("stats", env_file=WORK / "nowhere" / ".env")
check("no env file: exit 3 with a plain line", code == 3 and "env file" in out and fed == (0, 0), out)

# ---------- add ----------
note = WORK / "note.txt"
note.write_text("Our Quillbrook coaching package costs one payment and includes six calls.", encoding="utf-8")
code, out, fed = feed("add", "--kind", "note", "--ref", "test:quillbrook", "--title", "Quillbrook note", "--file", str(note))
check("add from a file", code == 0 and fed == (1, 1), out)
ok, top = found("Quillbrook", "test:quillbrook")
check("search finds the added note", ok, top)
code, out, fed = feed("add", "--kind", "note", "--ref", "test:quillbrook", "--title", "Quillbrook note", "--file", str(note))
check("adding the same text again is skipped", code == 0 and fed == (0, 0) and "Already in your library" in out, out)

mail = WORK / "m1.txt"
mail.write_text("Subject: Tarnvale launch\n\nHi Sam, the Tarnvale workshop opens Monday and I saved you a seat.\n\nPat", encoding="utf-8")
code, out, fed = feed("add", "--kind", "email", "--ref", "gmail:18c2ab001", "--title", "Tarnvale launch", "--date", "2026-09-30T14:00:00Z",
                      "--file", str(mail), "--remove")
check("add an email with --remove deletes the scratch file", code == 0 and fed == (1, 1) and not mail.exists(), out)
ok, top = found("Tarnvale", "gmail:18c2ab001")
check("search finds the email", ok and "(email," in top, top)

proc = subprocess.run([sys.executable, str(FEED), "add", "--kind", "note", "--ref", "test:stdin", "--title", "From stdin", "--stdin", "--env", str(ENV)],
                      input="Brimholt is the name of the stdin test word.", capture_output=True, text=True)
outputs.append(proc.stdout + proc.stderr)
check("add from stdin", proc.returncode == 0 and "FED 1 sources, 1 chunks" in proc.stdout, proc.stdout)

# A big text goes in pieces of at most 60k characters, each its own source.
para = ("Every spring the Velmora garden club meets to swap seeds and stories about the winter. " * 6).strip()
big = "\n\n".join(para + " Section %d." % i for i in range(260))
bigfile = WORK / "big.txt"
bigfile.write_text(big, encoding="utf-8")
code, out, fed = feed("add", "--kind", "doc", "--ref", "test:big", "--title", "Big book", "--file", str(bigfile))
sys.dont_write_bytecode = True  # no __pycache__ beside feed.py
spec = importlib.util.spec_from_file_location("feedmod", str(FEED))
feedmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(feedmod)
pieces = feedmod.split_text(big, feedmod.PIECE)
check("a %d-character text goes in %d parts of at most %d characters" % (len(big), len(pieces), feedmod.PIECE),
      code == 0 and fed is not None and fed[0] == len(pieces) >= 3 and all(len(p) <= feedmod.PIECE <= 60000 for p in pieces), out[-400:])
code, out, fed = feed("add", "--kind", "doc", "--ref", "test:big", "--title", "Big book", "--file", str(bigfile))
check("the same big text again is skipped", code == 0 and fed == (0, 0), out[-300:])

# A piece too big for the function's CPU limit is sent again in halves (feed.py starts at 40k here).
huge = "\n\n".join(para + " Chapter %d of the Osterbrook story." % i for i in range(40))
hugefile = WORK / "huge.txt"
hugefile.write_text(huge, encoding="utf-8")
code, out, fed = feed("add", "--kind", "doc", "--ref", "test:huge", "--title", "Huge piece", "--file", str(hugefile),
                      extra_env={"YOUCLONED_FEED_PIECE": "40000"})
check("a piece over the CPU limit is split again and goes in (%s sources)" % (fed and fed[0]),
      code == 0 and fed is not None and fed[0] >= 3 and "Could not add" not in out, out[-400:])
huge_parts = fed[0] if fed else 0
out = search("Velmora", 3)
check("the parts are found as ref#part-N", "test:big#part-" in out, out[:400])

# ---------- web ----------
site = WORK / "site"
site.mkdir(exist_ok=True)
NAV = "<nav><a href='/'>Home</a> <a href='/about.html'>About</a> Zorblatnav menu</nav>"
JUNK = "<script>var Glimmerscript = 1;</script><style>.x{color:red}</style><footer>Fennimorefoot legal small print</footer>"
page = lambda title, body: ("<!doctype html><html><head><title>%s</title>%s</head><body>%s<main>%s</main>%s</body></html>"
                            % (title, "<style>body{}</style>", NAV, body, JUNK))
filler = " We help busy people grow food at home with simple steps that fit a small yard or a balcony."
(site / "index.html").write_text(page("Pat's Garden", "<h1>Grow your own food</h1><p>The Hollowmere method." + filler * 3 + "</p>"), encoding="utf-8")
(site / "about.html").write_text(page("About Pat", "<h1>About</h1><p>Pat started in Oakhurst with one Crestwillow seed." + filler * 3 + "</p>"), encoding="utf-8")
(site / "offer.html").write_text(page("Backyard Garden Course", "<h1>Backyard Garden Course</h1><p>The Larkspindle course is $97." + filler * 3 + "</p>"), encoding="utf-8")
seen_agents = []


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        seen_agents.append(self.headers.get("User-Agent", ""))


httpd = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(site)))
port = httpd.server_address[1]
base = "http://127.0.0.1:%d" % port
(site / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                                  + "".join("<url><loc>%s/%s</loc></url>" % (base, p) for p in ("", "about.html", "offer.html"))
                                  + "</urlset>", encoding="utf-8")
(site / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: %s/sitemap.xml\n" % base, encoding="utf-8")
threading.Thread(target=httpd.serve_forever, daemon=True).start()

code, out, fed = feed("web", base + "/offer.html")
check("web reads one page", code == 0 and fed == (1, 1), out)
t0 = time.time()
code, out, fed = feed("web", base + "/", "--crawl", "--max", "200")
took = time.time() - t0
check("web --crawl reads the sitemap pages it hasn't read (2 new, the offer unchanged)", code == 0 and fed == (2, 2) and "Read 3 pages" in out, out)
check("crawl waits about a second between requests (%.1fs for 5 requests)" % took, took >= 4.0, took)
check("crawl sends the YouCloned librarian user agent", seen_agents and all(a == "YouCloned librarian" for a in seen_agents), seen_agents)
for word, path in (("Hollowmere", base + "/"), ("Crestwillow", base + "/about.html"), ("Larkspindle", base + "/offer.html")):
    ok, top = found(word, path + "\n")
    check("search finds web page %s" % path.rsplit("/", 1)[-1] or "index", ok and "(web," in top, top)
leaked = [w for w in ("Zorblatnav", "Glimmerscript", "Fennimorefoot") if w in search(w, 10)]
check("nav, script, style and footer text stay out", not leaked, leaked)

# Without a sitemap the crawl follows same-site links (and never leaves the site).
(site / "robots.txt").unlink()
(site / "sitemap.xml").unlink()
(site / "index.html").write_text(page("Pat's Garden", "<h1>Grow</h1><p>The Hollowmere method, now with Pemberwick beds."
                                      + filler * 3 + " <a href='/about.html'>more</a> <a href='https://elsewhere.example.org/x'>out</a>"
                                      + " <a href='http://['>broken</a></p>"), encoding="utf-8")
code, out, fed = feed("web", base + "/", "--crawl")
check("crawl without a sitemap follows same-site links", code == 0 and fed == (1, 1) and "Read 3 pages" not in out and "elsewhere" not in out, out)
check("a malformed link (href=\"http://[\") is skipped and the crawl goes on to its end", code == 0 and "Skipped a broken link" in out
      and "Traceback" not in out and re.search(r"^Read \d+ pages?\.$", out, re.M), out)
httpd.shutdown()

# ---------- doc ----------
docs = WORK / "docs"
docs.mkdir(exist_ok=True)


def make_docx(path, paras):
    w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join("<w:p><w:r><w:t>%s</w:t></w:r></w:p>" % p for p in paras)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>")
        z.writestr("word/document.xml", "<w:document xmlns:w='%s'><w:body>%s</w:body></w:document>" % (w, body))


def make_pptx(path, slides, notes):
    a = "http://schemas.openxmlformats.org/drawingml/2006/main"
    p = "http://schemas.openxmlformats.org/presentationml/2006/main"
    with zipfile.ZipFile(path, "w") as z:
        for i, lines in enumerate(slides, 1):
            paras = "".join("<a:p><a:r><a:t>%s</a:t></a:r></a:p>" % l for l in lines)
            z.writestr("ppt/slides/slide%d.xml" % i, "<p:sld xmlns:p='%s' xmlns:a='%s'><p:txBody>%s</p:txBody></p:sld>" % (p, a, paras))
        for i, line in notes.items():
            z.writestr("ppt/notesSlides/notesSlide%d.xml" % i,
                       "<p:notes xmlns:p='%s' xmlns:a='%s'><a:p><a:r><a:t>%s</a:t></a:r></a:p><a:p><a:r><a:t>%d</a:t></a:r></a:p></p:notes>" % (p, a, line, i))


def make_epub(path, chapters):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr("META-INF/container.xml", "<container xmlns='urn:oasis:names:tc:opendocument:xmlns:container'><rootfiles>"
                                             "<rootfile full-path='OEBPS/content.opf'/></rootfiles></container>")
        items = "".join("<item id='c%d' href='c%d.xhtml'/>" % (i, i) for i in range(len(chapters)))
        spine = "".join("<itemref idref='c%d'/>" % i for i in range(len(chapters)))
        z.writestr("OEBPS/content.opf", "<package xmlns='http://www.idpf.org/2007/opf'><manifest>%s</manifest><spine>%s</spine></package>" % (items, spine))
        for i, text in enumerate(chapters):
            z.writestr("OEBPS/c%d.xhtml" % i, "<html><body><h1>Chapter %d</h1><p>%s</p></body></html>" % (i + 1, text))


def make_pdf(path, text):
    stream = "BT /F1 12 Tf 72 720 Td (%s) Tj ET" % text
    objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>",
            "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
            "<</Length %d>>stream\n%s\nendstream" % (len(stream), stream), "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"]
    out, offsets = "%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += "%d 0 obj\n%s\nendobj\n" % (i, o)
    xref = len(out)
    out += "xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + "".join("%010d 00000 n \n" % o for o in offsets)
    out += "trailer\n<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    path.write_bytes(out.encode("latin-1"))


(docs / "plan.txt").write_text("The Wendlecroft plan has three phases for the first year.", encoding="utf-8")
(docs / "notes.md").write_text("# Notes\n\nThe Brasswhistle checklist keeps launches on time.\n", encoding="utf-8")
make_docx(docs / "Workbook_One.docx", ["Module one", "The Ombershade worksheet asks what your buyer fears most."])
make_pptx(docs / "deck.pptx", [["Slide title", "Selling with the Quorvane frame"], ["Second slide", "Price and promise"]],
          {1: "Tell the Harrowgate story here"})
(docs / "page.html").write_text("<html><head><title>Saved page</title><script>var Snickerjunk=1</script></head>"
                                "<body><p>The Dunmarrow guarantee lasts thirty days.</p></body></html>", encoding="utf-8")
make_epub(docs / "book.epub", ["The Calloway farm taught me patience.", "Then the Ivorythorn harvest came in early."])
make_pdf(docs / "guide.pdf", "The Mirelocke guide explains the offer in plain steps")

for name, word, extra in (("plan.txt", "Wendlecroft", ""), ("notes.md", "Brasswhistle", ""), ("Workbook_One.docx", "Ombershade", "Workbook One"),
                          ("deck.pptx", "Quorvane", ""), ("page.html", "Dunmarrow", ""), ("book.epub", "Ivorythorn", "")):
    code, out, fed = feed("doc", str(docs / name))
    ok, top = found(word, (docs / name).resolve().as_posix())
    check("doc %s goes in and is found" % name, code == 0 and fed == (1, 1) and ok and "(doc," in top and (not extra or extra in top), out + top)
check("pptx speaker notes are kept", found("Harrowgate", (docs / "deck.pptx").resolve().as_posix())[0])
check("html script text stays out", "Snickerjunk" not in search("Snickerjunk", 10))

code, out, fed = feed("doc", str(docs / "guide.pdf"), py_flags=("-S",))
check("pdf without pypdf: exit 4 with the uv line", code == 4 and "uv run --with pypdf python" in out and fed == (0, 0), out)
have_pypdf = importlib.util.find_spec("pypdf") is not None
if have_pypdf:
    code, out, fed = feed("doc", str(docs / "guide.pdf"))
    ok, top = found("Mirelocke", (docs / "guide.pdf").resolve().as_posix())
    check("pdf with pypdf goes in and is found", code == 0 and fed == (1, 1) and ok, out + top)
elif shutil.which("uv"):
    run = subprocess.run(["uv", "run", "--with", "pypdf", "python", str(FEED), "doc", str(docs / "guide.pdf"), "--env", str(ENV)],
                         capture_output=True, text=True)
    outputs.append(run.stdout + run.stderr)
    check("pdf through uv run --with pypdf goes in", run.returncode == 0 and "FED 1 sources" in run.stdout, run.stdout + run.stderr)

# ---------- folder ----------
box = WORK / "vault" / "Feed me"
(box / "course").mkdir(parents=True, exist_ok=True)
(box / "a.txt").write_text("Kestrelmoor is the first folder file.", encoding="utf-8")
(box / "b.md").write_text("Saltbrindle is in the second folder file.", encoding="utf-8")
make_docx(box / "course" / "c.docx", ["Thimbleweld appears in the course workbook."])
(box / "course" / "d.html").write_text("<p>Gorsewyn is on the saved lesson page.</p>", encoding="utf-8")
(box / ".hidden.txt").write_text("Hiddenword should never go in.", encoding="utf-8")
(box / "~$c.docx").write_text("office lock file", encoding="utf-8")
(box / "lesson.mp4").write_bytes(b"")
code, out, fed = feed("folder", str(box))
check("folder adds every supported file (4) and skips hidden and lock files", code == 0 and fed == (4, 4) and "1 video or recording" in out, out)
for word, name in (("Kestrelmoor", "a.txt"), ("Saltbrindle", "b.md"), ("Thimbleweld", "c.docx"), ("Gorsewyn", "d.html")):
    ok, top = found(word, "/" + name)
    check("search finds folder file %s" % name, ok, top)
check("hidden files stay out", "Hiddenword" not in search("Hiddenword", 10))
code, out, fed = feed("folder", str(box))
check("second folder run skips unchanged files", code == 0 and fed == (0, 0) and out.count("Already in your library") == 4, out)
time.sleep(1.1)
(box / "a.txt").write_text("Kestrelmoor is the first folder file, now with Ashencliff added.", encoding="utf-8")
code, out, fed = feed("folder", str(box))
check("a changed file goes in again, the rest are skipped", code == 0 and fed == (1, 1) and found("Ashencliff", "/a.txt")[0], out)
state_file = ENV.parent / "Library" / ".fed.json"
check("what was fed is kept in <vault>/Library/.fed.json", state_file.is_file() and any(k.endswith("/a.txt") for k in json.loads(state_file.read_text())["files"]))

# ---------- transcribe ----------
code, out, fed = feed("transcribe", str(box), "--whisper", "http://127.0.0.1:1")
check("transcriber not answering: exit 5 with a plain line", code == 5 and "voice step" in out and fed == (0, 0), out)
if shutil.which("say") and shutil.which("ffmpeg"):
    rec = WORK / "recordings"
    rec.mkdir(exist_ok=True)
    subprocess.run(["say", "-o", str(rec / "Coaching_call_one.aiff"),
                    "Welcome to the call. Today the purple giraffe sells handmade lanterns at the Saturday market, and we talk about pricing."], check=True)
    code, out, fed = feed("transcribe", str(rec), "--whisper", WHISPER)
    ok, top = found("giraffe lanterns Saturday market", "/Coaching_call_one.aiff")
    check("transcribe a spoken recording with the local transcriber, then find it", code == 0 and fed == (1, 1) and ok and "Coaching call one" in top, out + top)
    code, out, fed = feed("transcribe", str(rec), "--whisper", WHISPER)
    check("a second transcribe run skips the recording", code == 0 and fed == (0, 0) and "Already in your library" in out, out)
else:
    check("transcribe (needs macOS say and ffmpeg)", False, "say or ffmpeg missing")

# ---------- YouTube: the caption cleaner only ----------
VTT = """WEBVTT
Kind: captions
Language: en

NOTE this is a note
that spans lines

00:00:00.000 --> 00:00:02.000 align:start position:0%
hey<00:00:00.500><c> everyone</c><00:00:01.000><c> welcome</c>

00:00:02.000 --> 00:00:02.010 align:start position:0%
hey everyone welcome

00:00:02.010 --> 00:00:04.000 align:start position:0%
hey everyone welcome
back<00:00:02.500><c> to</c><00:00:03.000><c> the</c><00:00:03.500><c> channel</c>

00:00:04.000 --> 00:00:06.000
[Music]

00:00:06.000 --> 00:00:08.000
today we&#39;re pricing &amp; packaging
"""
SRT = "1\n00:00:01,000 --> 00:00:02,000\nFirst line here\n\n2\n00:00:02,000 --> 00:00:03,000\n<i>Second</i> line\n"
got = feedmod.caption_text(VTT)
check("vtt cleaner: no timings, tags, notes or repeats", got == "hey everyone welcome back to the channel today we're pricing & packaging", got)
got = feedmod.caption_text(SRT)
check("srt cleaner", got == "First line here Second line", got)
check("channel address gets /videos", feedmod.channel_videos_url("youtube.com/@patgarden") == "https://youtube.com/@patgarden/videos"
      and feedmod.channel_videos_url("https://www.youtube.com/@patgarden/videos") == "https://www.youtube.com/@patgarden/videos")
code, out, fed = feed("youtube", "https://www.youtube.com/@nobody", extra_env={"PATH": str(WORK / "empty-path")}, python=sys.executable)
check("no yt-dlp or uvx: exit 6 with a plain line", code == 6 and "yt-dlp" in out and fed == (0, 0), out)

# ---------- wiki ----------
page_file = WORK / "index.md"
page_file.write_text("# Library\n\n- [[offers/backyard-garden-course]]\n", encoding="utf-8")
code, out, fed = feed("wiki-put", "feedtest/index", "Feed test index", str(page_file))
check("wiki-put saves a page", code == 0 and "Saved wiki page feedtest/index" in out, out)
code, out, fed = feed("wiki-list")
check("wiki-list shows it", code == 0 and "feedtest/index: Feed test index" in out, out)

# ---------- stats ----------
end = stats()
dk = {k: end.get("kinds", {}).get(k, 0) - start.get("kinds", {}).get(k, 0) for k in ("email", "web", "doc", "note", "other")}
want_doc = len(pieces) + huge_parts + 6 + 4 + (1 if have_pypdf or shutil.which("uv") else 0)
want = {"email": 1, "web": 3, "doc": want_doc, "note": 2, "other": 1 if shutil.which("say") else 0}
check("stats counts every kind fed (%s)" % dk, dk == want, (dk, want))
check("stats wiki pages counted", end.get("wiki_pages", 0) >= start.get("wiki_pages", 0) + 1, end)

# ---------- re-feed: a source the library lost goes in again ----------
URL = ""
for line in ENV.read_text(encoding="utf-8").splitlines():
    if line.startswith("YOUCLONED_LIBRARY_URL="):
        URL = line.split("=", 1)[1].strip()


def library_call(body):
    request = urllib.request.Request(URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "x-library-token": TOKEN})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


b_ref = (box / "b.md").resolve().as_posix()
gone = library_call({"action": "forget", "ref": b_ref})
has = library_call({"action": "has", "refs": [b_ref, (box / "a.txt").resolve().as_posix()]})
check("has names only the refs still in the library", has.get("refs") == [(box / "a.txt").resolve().as_posix()] and gone.get("forgotten") == 1, has)
code, out, fed = feed("folder", str(box))
check("a source missing from the library goes in again though the file is unchanged", code == 0 and fed == (1, 1)
      and "no longer in your library" in out and out.count("Already in your library") == 3 and found("Saltbrindle", "/b.md")[0], out)

# ---------- helpers: --helper keeps every file inside the helper's own folders ----------
hv = WORK / "helper-vault"
(hv / "Feed me").mkdir(parents=True, exist_ok=True)
(hv / "Library").mkdir(parents=True, exist_ok=True)
henv = hv / ".env"
shutil.copyfile(str(ENV), str(henv))
os.chmod(str(henv), 0o600)
hhome = WORK / "helper-home"
feeding = hhome / ".youcloned" / "feeding"
feeding.mkdir(parents=True, exist_ok=True)
hrun = lambda *a: feed(*a, "--helper", env_file=henv, extra_env={"HOME": str(hhome)})
env_size = henv.stat().st_size

# Codex: add --file <vault>/.env --remove uploaded the env file, then deleted it.
code, out, fed = hrun("add", "--kind", "note", "--ref", "test:envgrab", "--title", "grab", "--file", str(henv), "--remove")
check("helper: add --file <vault>/.env --remove is refused and the env file stays", code != 0 and fed == (0, 0)
      and henv.is_file() and henv.stat().st_size == env_size and "env file" in out, out)
code, out, fed = feed("add", "--kind", "note", "--ref", "test:envgrab", "--title", "grab", "--file", str(henv), env_file=henv)
check("without --helper the env file is refused too", code != 0 and fed == (0, 0) and henv.is_file(), out)
link = feeding / "m9.txt"
link.symlink_to(henv)
code, out, fed = hrun("add", "--kind", "email", "--ref", "gmail:link", "--title", "link", "--file", str(link), "--remove")
check("helper: a link in feeding that leads to the env file is refused, the link and the env file stay", code != 0 and fed == (0, 0)
      and link.is_symlink() and henv.is_file() and henv.stat().st_size == env_size, out)
outside = WORK / "outside.txt"
outside.write_text("Wombleton is outside the helper folders.", encoding="utf-8")
(hv / "Feed me" / "away.txt").symlink_to(outside)
code, out, fed = hrun("doc", str(hv / "Feed me" / "away.txt"))
check("helper: a link in Feed me that leads outside is refused", code != 0 and fed == (0, 0) and "outside" in out, out)
code, out, fed = hrun("doc", str(outside))
check("helper: a document outside Feed me is refused", code != 0 and fed == (0, 0) and "outside" in out, out)
kept = hv / "Feed me" / "keep.txt"
kept.write_text("Pellingford stays in the Feed me folder.", encoding="utf-8")
code, out, fed = hrun("add", "--kind", "note", "--ref", "test:keep", "--title", "keep", "--file", str(kept), "--remove")
check("helper: --remove outside feeding is refused and the file stays", code != 0 and kept.is_file() and fed == (0, 0), out)
mail2 = feeding / "m2.txt"
mail2.write_text("Subject: Quenwick\n\nThe Quenwick class starts Friday.", encoding="utf-8")
code, out, fed = hrun("add", "--kind", "email", "--ref", "gmail:quenwick", "--title", "Quenwick", "--file", str(mail2), "--remove")
check("helper: add from feeding with --remove goes in and the scratch file goes", code == 0 and fed == (1, 1) and not mail2.exists(), out)
(hv / "Feed me" / ".env.local").write_text("NOT_A_KEY=1\n", encoding="utf-8")
(hv / "Feed me" / "id_rsa").write_text("not a key\n", encoding="utf-8")
code, out, fed = hrun("doc", str(hv / "Feed me" / "id_rsa"))
check("helper: a key-shaped file is refused", code != 0 and fed == (0, 0) and "key file" in out, out)
code, out, fed = hrun("folder", str(hv / "Feed me"))
check("helper: folder feeds Feed me and skips the links that lead out", code == 0 and fed == (1, 1) and "outside" in out, out)
# Codex: wiki-put accepted any file.
code, out, fed = hrun("wiki-put", "feedtest/outside", "Outside", str(outside))
check("helper: wiki-put of a file outside Library is refused", code != 0 and "outside" in out, out)
code, out, fed = hrun("wiki-put", "feedtest/env", "Env", str(hv / "Library" / ".." / ".env"))
check("helper: wiki-put of the env file through .. is refused", code != 0 and "env file" in out, out)
wiki_page = hv / "Library" / "helper.md"
wiki_page.write_text("# Helper page\n", encoding="utf-8")
code, out, fed = hrun("wiki-put", "feedtest/helper", "Helper page", str(wiki_page))
check("helper: wiki-put of a page in Library works", code == 0 and "Saved wiki page feedtest/helper" in out, out)
for ref in ("gmail:quenwick", (hv / "Feed me" / "keep.txt").resolve().as_posix()):
    library_call({"action": "forget", "ref": ref})

# ---------- re-feed: an emptied library takes everything again ----------
if DB:
    subprocess.run(["docker", "exec", "-i", DB, "psql", "-U", "postgres", "-q", "-c", "delete from youcloned.sources;"], check=True, capture_output=True)
    code, out, fed = feed("folder", str(box))
    check("after the library is emptied, unchanged files all go in again", code == 0 and fed == (4, 4)
          and "library is empty" in out and "Already in your library" not in out, out)

# ---------- never a secret ----------
check("the token never appears in anything feed.py printed", TOKEN and not any(TOKEN in o for o in outputs))
check("every run ends with the FED line", all(re.search(r"^FED \d+ sources, \d+ chunks$", o, re.M) for o in outputs))

failed = results.count(False)
print("\n%d checks, %d passed, %d failed" % (len(results), len(results) - failed, failed))
sys.exit(1 if failed else 0)
