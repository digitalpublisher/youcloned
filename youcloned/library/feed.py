#!/usr/bin/env python3
"""Feed the YouCloned library: emails, web pages, documents, recordings and YouTube transcripts.

Usage (put --env ENV_FILE after the command when the env file is not the vault's .env):
  feed.py add --kind K --ref R --title T [--date D] (--file F | --stdin) [--remove]
  feed.py web URL [--crawl] [--max 200]
  feed.py doc PATH
  feed.py folder PATH
  feed.py transcribe PATH_OR_FOLDER [--whisper URL]
  feed.py youtube CHANNEL_URL [--max 200]
  feed.py search QUERY [--k 8] [--kinds email,web]
  feed.py stats
  feed.py wiki-put SLUG TITLE FILE
  feed.py wiki-list

A helper (the librarian or the wiki writer) adds --helper: then every file must sit inside the helper's own
folders (~/.youcloned/feeding and <vault>/Feed me for add, doc, folder and transcribe; <vault>/Library for
wiki-put), --remove works only inside ~/.youcloned/feeding, and a link counts where it leads, not where it sits.
Env files and key files are never read, in any mode.

The env file is <vault>/.env, where the vault is the first line of ~/.youcloned/vault-path
(or the Obsidian Vault folder in Documents). It holds YOUCLONED_LIBRARY_URL and YOUCLONED_LIBRARY_TOKEN.
The token is read in code and never printed. What was fed is kept in <vault>/Library/.fed.json,
so a second run skips what is already in the library and unchanged.

Prints plain lines a person can read, then one machine line: FED n sources, m chunks
Exit codes: 0 done, 1 something failed, 2 wrong use, 3 no env file or library address,
4 a PDF needs pypdf, 5 the transcriber or ffmpeg is missing, 6 yt-dlp is missing.
Python 3.9 or newer, standard library only (pypdf for PDFs when it is there). Mac and Windows.
"""
import argparse
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import uuid
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

TOKEN_NAME = "YOUCLONED_LIBRARY_TOKEN"
URL_NAME = "YOUCLONED_LIBRARY_URL"
AGENT = "YouCloned librarian"
# Characters a call. The function embeds every piece of a call inside one request, and an Edge Function
# gets about 2 seconds of CPU a request: about 12k characters (7 pieces) fits, 16k does not. So text goes
# in 8k sources, and a source that still hits the limit (status 546 or 503) is sent again in halves.
PIECE = 8000
MIN_PIECE = 1000
LIMIT_STATUS = (503, 546)
MAX_PAGE_BYTES = 5_000_000
DEFAULT_WHISPER = "http://127.0.0.1:2022"
SEGMENT_SECONDS = 600  # recordings go to the transcriber ten minutes at a time

DOC_TYPES = {".txt", ".text", ".md", ".markdown", ".csv", ".html", ".htm", ".docx", ".pptx", ".epub", ".pdf", ".vtt", ".srt"}
MEDIA_TYPES = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".wmv", ".mpg", ".mpeg", ".flv",
               ".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif", ".wma"}
SKIP_LINKS = re.compile(r"\.(?:jpe?g|png|gif|webp|svg|ico|bmp|tiff?|pdf|zip|gz|rar|7z|dmg|exe|msi|css|js|json|xml|rss|"
                        r"mp4|mov|m4v|webm|avi|mp3|m4a|wav|ogg|woff2?|ttf|eot|docx?|xlsx?|pptx?)$", re.I)

FED = {"sources": 0, "chunks": 0}

# Files feed.py never reads: env files, and names that hold keys. hooks/helpers.js holds the same list (KEY_NAME).
ENV_NAME = re.compile(r"^\.env(?:\..+)?$", re.I)
KEY_NAME = re.compile(r"(?:\.(?:pem|key|p12|pfx|keystore|jks|ppk|gpg|asc|kdbx)$|^id_(?:rsa|dsa|ecdsa|ed25519)|^(?:credentials|secrets?)(?:\.|$)"
                      r"|^\.(?:npmrc|netrc|pgpass|pypirc|git-credentials)$|^token\.json$)", re.I)
FEEDS_FILES = {"add", "web", "doc", "folder", "transcribe", "youtube"}
# Said when a source or a wiki page holds the library token. It never names the title, the file or any of its words,
# since the token may be in them.
TOKEN_SKIP = "Skipped one source: it holds your library token, and that never goes in the library."


# The library token once the env file is read. say() never prints it, whatever line it is handed.
HIDE = []


def say(line):
    line = str(line)
    for secret in HIDE:
        line = line.replace(secret, "[your library token]")
    print(line, flush=True)


def finish(code):
    say("FED %d sources, %d chunks" % (FED["sources"], FED["chunks"]))
    sys.exit(code)


# ---------- the env file and the library ----------

def vault_from_marker():
    marker = Path.home() / ".youcloned" / "vault-path"
    if marker.is_file():
        lines = marker.read_text(encoding="utf-8").splitlines()
        if lines and lines[0].strip():
            return Path(lines[0].strip()).expanduser()
    return Path.home() / "Documents" / "Obsidian Vault"


def env_values(env_file):
    values = {}
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[len("export "):]
        if "=" in line and not line.startswith("#"):
            name, value = line.split("=", 1)
            values[name.strip()] = value.strip().strip('"').strip("'")
    return values


# Windows opens ".env." and ".env " as .env, "name:stream" as a hidden stream inside name, and ENV~1 as a
# short name for a long one. A name counts as what Windows would open, and the tricks are refused outright.
# hooks/helpers.js holds the same rules (winName, SHORT_NAME); change both together.
SHORT_NAME = re.compile(r"^[^~\s]{1,6}~\d+(?:\.[^.]{0,3})?$")
DRIVE = re.compile(r"^[A-Za-z]:[\\/]*$")


def win_name(part):
    return re.sub(r"[. ]+$", "", part.split(":", 1)[0])


def path_parts(path):
    """Every name along the path, split at both kinds of slash, the drive (C:) left out."""
    parts = [p for p in re.split(r"[\\/]+", str(path)) if p]
    return parts[1:] if parts and DRIVE.match(parts[0]) else parts


def secret_name(path):
    """True when the path names an env file (anywhere along it) or a file that holds keys, Windows spellings too."""
    parts = path_parts(path)
    return (any(ENV_NAME.match(part) or ENV_NAME.match(win_name(part)) for part in parts)
            or bool(parts and (KEY_NAME.search(parts[-1]) or KEY_NAME.search(win_name(parts[-1])))))


def name_trick(path):
    """Why a path spelled with a Windows name trick is refused, or None."""
    for part in path_parts(path):
        if ":" in part:
            return "a name with a colon (a hidden Windows stream) is not allowed"
        if part not in (".", "..") and re.search(r"[. ]$", part):
            return "a name that ends in a dot or a space is not allowed"
        if SHORT_NAME.match(part):
            return "a short Windows name such as ENV~1 is not allowed; use the full name"
    return None


def within(path, folder):
    return path == folder or folder in path.parents


class Library:
    def __init__(self, env_arg, helper=False):
        self.helper = helper
        if env_arg:
            self.env_file = Path(env_arg).expanduser().resolve()
            self.vault = self.env_file.parent
        else:
            self.vault = vault_from_marker()
            self.env_file = self.vault / ".env"
        if not self.env_file.is_file():
            say("I can't find your env file at " + str(self.env_file) + ". The library step of setup makes it.")
            finish(3)
        values = env_values(self.env_file)
        self.url = values.get(URL_NAME, "")
        self._token = values.get(TOKEN_NAME, "")
        if self._token:
            HIDE.append(self._token)
        if not self.url or not self._token:
            say("Your env file has no library address or token yet. The library step of setup adds them.")
            finish(3)
        self.state_file = self.vault / "Library" / ".fed.json"
        self.roots = {"feeding": Path.home() / ".youcloned" / "feeding", "feedme": self.vault / "Feed me", "library": self.vault / "Library"}
        self.state = self._load_state()
        self.checked = False

    # What was fed, kept beside the wiki pages. It belongs to one library: a new library starts it over.
    def _load_state(self):
        lib = hashlib.sha256(self.url.encode("utf-8")).hexdigest()[:16]
        state = {}
        try:
            state = json.loads(self.state_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
        if not isinstance(state, dict) or state.get("library") != lib:
            state = {"library": lib}
        for key in ("hashes", "parts", "files"):
            if not isinstance(state.get(key), dict):
                state[key] = {}
        return state

    def save_state(self):
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        temp = self.state_file.with_name(".fed.json.tmp")
        temp.write_text(json.dumps(self.state, indent=1, sort_keys=True), encoding="utf-8")
        os.replace(str(temp), str(self.state_file))

    def call(self, body, timeout=300):
        data = json.dumps(body).encode("utf-8")
        wait = 2
        for attempt in range(5):
            request = urllib.request.Request(self.url, data=data, method="POST",
                                             headers={"Content-Type": "application/json", "x-library-token": self._token})
            try:
                with urllib.request.urlopen(request, timeout=timeout) as response:
                    return response.status, json.loads(response.read().decode("utf-8"))
            except urllib.error.HTTPError as error:
                try:
                    reply = json.loads(error.read().decode("utf-8"))
                except ValueError:
                    reply = {}
                # The CPU limit answers the same way every time: one more try (a cold start), then give up.
                if error.code < 500 or attempt == 4 or (error.code in LIMIT_STATUS and attempt >= 1):
                    return error.code, reply
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                reason = str(getattr(error, "reason", error))
                if "CERTIFICATE_VERIFY_FAILED" in reason:
                    return 0, {"error": reason + " (on a Mac with Python from python.org, run Install Certificates.command in the Python folder)"}
                if attempt == 4:
                    return 0, {"error": reason}
            time.sleep(wait)
            wait *= 2
        return 0, {"error": "no answer"}

    def file_problem(self, path, roots=("feeding", "feedme")):
        """Why feed.py won't read this file (or folder), or None. Env and key files never; for a helper,
        only inside its own folders, judged by where a link leads."""
        given = Path(path).expanduser()
        if secret_name(path) or secret_name(given.absolute()):
            return str(given) + " is an env file or a key file, and those never go in the library"
        trick = name_trick(path)
        if trick:
            return str(given) + ": " + trick
        if not os.path.lexists(str(given)):
            return None  # the command says there is nothing there
        try:
            resolved = given.resolve(strict=True)
        except (OSError, RuntimeError):
            return str(given) + " leads nowhere"
        if secret_name(given.absolute()) or secret_name(resolved):
            return str(given) + " is an env file or a key file, and those never go in the library"
        try:
            if resolved == self.env_file or resolved.samefile(self.env_file):
                return str(given) + " is the env file, and it never goes in the library"
        except OSError:
            pass
        if self.helper:
            folders = []
            for name in roots:
                try:
                    folders.append(self.roots[name].resolve(strict=True))
                except (OSError, RuntimeError):
                    pass
            if not any(within(resolved, f) for f in folders):
                return str(given) + " is outside " + " and ".join(str(self.roots[n]) for n in roots)
        return None

    # A library that was emptied or replaced, or that lost a source, starts that part of the record over,
    # so nothing is skipped by mistake. It runs before anything is skipped.
    def check_once(self, only=None):
        """only: the refs this run can skip (all of them when None)."""
        if self.checked:
            return
        self.checked = True
        if not (self.state["hashes"] or self.state["files"]):
            return
        status, body = self.call({"action": "stats"})
        if status != 200:
            return
        if body.get("sources") == 0:
            lib = self.state["library"]
            self.state = {"library": lib, "hashes": {}, "parts": {}, "files": {}}
            self.save_state()
            say("Your library is empty, so everything goes in again.")
            return
        refs = sorted(r for r in self.state["hashes"] if only is None or r in only)
        probe = {ref: (ref + "#part-1" if int(self.state["parts"].get(ref, 1) or 1) > 1 else ref) for ref in refs}
        present = set()
        wanted = sorted(set(probe.values()))
        for start in range(0, len(wanted), 500):
            status, body = self.call({"action": "has", "refs": wanted[start:start + 500]})
            if status != 200 or not isinstance(body.get("refs"), list):
                return  # an older library function can't say; the empty check above still holds
            present.update(str(r) for r in body["refs"])
        gone = [ref for ref in refs if probe[ref] not in present]
        for ref in gone:
            for key in ("hashes", "parts", "files"):
                self.state[key].pop(ref, None)
        if gone:
            self.save_state()
            say(str(len(gone)) + (" source is" if len(gone) == 1 else " sources are") + " no longer in your library, so "
                + ("it goes" if len(gone) == 1 else "they go") + " in again.")

    def holds_token(self, *values):
        """True when the library token is in any of the values (text, title, ref, date, slug...)."""
        return bool(self._token) and any(self._token in str(v) for v in values if v)

    def ingest(self, kind, ref, title, text, happened_at=None, quiet=False):
        """Sends one source, in pieces of at most 8k characters. Returns (sent, chunks) or None on failure."""
        if self.holds_token(kind, ref, title, text, happened_at):
            say(TOKEN_SKIP)
            return None
        self.check_once()
        text = text.strip()
        if not text:
            if not quiet:
                say("Skipped " + title + ": no words in it.")
            return (0, 0)
        digest = hashlib.sha256((kind + "\n" + title + "\n" + (happened_at or "") + "\n" + text).encode("utf-8")).hexdigest()
        if self.state["hashes"].get(ref) == digest:
            if not quiet:
                say("Already in your library: " + title)
            return (0, 0)
        old_parts = int(self.state["parts"].get(ref, 1) or 1)
        try:
            size = max(MIN_PIECE, min(60000, int(os.environ.get("YOUCLONED_FEED_PIECE") or PIECE)))
        except ValueError:
            size = PIECE
        while True:
            pieces = split_text(text, size)
            sent, chunks, problem = [], 0, None
            for n, piece in enumerate(pieces, 1):
                part_ref = ref if len(pieces) == 1 else ref + "#part-" + str(n)
                part_title = title if len(pieces) == 1 else title + " (part " + str(n) + " of " + str(len(pieces)) + ")"
                source = {"kind": kind, "ref": part_ref, "title": part_title[:1000]}
                if happened_at:
                    source["happened_at"] = happened_at
                status, body = self.call({"action": "ingest", "source": source, "text": piece})
                if status != 200 or not body.get("ok"):
                    problem = (status, part_title, str(body.get("error", "no answer")))
                    break
                sent.append((part_ref, int(body.get("chunks", 0))))
                chunks += int(body.get("chunks", 0))
            if not problem:
                break
            if problem[0] in LIMIT_STATUS and size > MIN_PIECE:
                # Too much for one call: take back what this try sent and go again in smaller pieces.
                for part_ref, _ in sent:
                    self.call({"action": "forget", "ref": part_ref})
                size //= 2
                continue
            FED["sources"] += len(sent)
            FED["chunks"] += chunks
            say("Could not add " + problem[1] + " (status " + str(problem[0]) + ": " + problem[2] + ")")
            return None
        FED["sources"] += len(sent)
        FED["chunks"] += chunks
        # Take out what an earlier, longer or differently cut copy left behind.
        stale = []
        if len(pieces) > 1:
            stale.append(ref)
            stale += [ref + "#part-" + str(n) for n in range(len(pieces) + 1, old_parts + 1)]
        elif old_parts > 1:
            stale += [ref + "#part-" + str(n) for n in range(1, old_parts + 1)]
        for gone in stale:
            self.call({"action": "forget", "ref": gone})
        self.state["hashes"][ref] = digest
        self.state["parts"][ref] = len(pieces)
        self.save_state()
        if not quiet:
            say("Added " + title + ": " + str(chunks) + " pieces" + (" in " + str(len(pieces)) + " parts" if len(pieces) > 1 else "") + ".")
        return (len(pieces), chunks)


def split_text(text, size):
    """Cuts text into pieces of at most size characters, on paragraph, line, sentence or word breaks."""
    if len(text) <= size:
        return [text]
    pieces, rest = [], text
    while len(rest) > size:
        window = rest[:size]
        cut = -1
        for mark in ("\n\n", "\n", ". ", "! ", "? ", " "):
            at = window.rfind(mark)
            if at > size // 2:
                cut = at + len(mark)
                break
        if cut <= 0:
            cut = size
        pieces.append(rest[:cut].strip())
        rest = rest[cut:].lstrip()
    if rest.strip():
        pieces.append(rest.strip())
    return [p for p in pieces if p]


def iso_from_mtime(path):
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()


def nice_title(path):
    stem = re.sub(r"[_]+", " ", Path(path).stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem or Path(path).name


# ---------- HTML to readable text ----------

SKIP_TAGS = {"script", "style", "nav", "noscript", "svg", "template", "iframe", "footer", "form", "button", "select"}
BLOCK_TAGS = {"p", "div", "section", "article", "main", "aside", "header", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol",
              "tr", "table", "blockquote", "pre", "br", "hr", "dd", "dt", "dl", "figure", "figcaption", "title", "body"}


class Reader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.links = []
        self.title = ""
        self.skip = 0
        self.in_title = False
        self.skip_stack = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag == "title":
            self.in_title = True
        if tag in SKIP_TAGS or (a.get("role") or "").lower() == "navigation" or "hidden" in a or (a.get("aria-hidden") == "true"):
            if tag not in ("br", "hr", "img", "input", "meta", "link"):
                self.skip += 1
                self.skip_stack.append(tag)
                return
        if tag in BLOCK_TAGS and not self.skip:
            self.parts.append("\n\n" if tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "blockquote", "table") else "\n")
        if tag == "li" and not self.skip:
            self.parts.append("- ")

    def handle_startendtag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and a.get("href"):
            self.links.append(a["href"])
        if tag in ("br", "hr") and not self.skip:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.skip_stack:
            # Close the skipped part even when a tag inside it was never closed.
            while self.skip_stack:
                self.skip -= 1
                if self.skip_stack.pop() == tag:
                    break
            return
        if tag in BLOCK_TAGS and not self.skip:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
            return
        if not self.skip:
            self.parts.append(data)

    def text(self):
        raw = "".join(self.parts)
        lines = [re.sub(r"[ \t\r\f\v ]+", " ", line).strip() for line in raw.split("\n")]
        out, blank = [], False
        for line in lines:
            if not line or line == "-":
                blank = True
                continue
            if blank and out:
                out.append("")
            out.append(line)
            blank = False
        return "\n".join(out).strip()


def html_to_text(markup):
    reader = Reader()
    try:
        reader.feed(markup)
        reader.close()
    except Exception:
        pass
    return reader.text(), re.sub(r"\s+", " ", reader.title).strip(), reader.links


# ---------- the web ----------

def fetch(url, accept_html=True):
    request = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5"})
    with urllib.request.urlopen(request, timeout=30) as response:
        kind = response.headers.get("Content-Type", "")
        raw = response.read(MAX_PAGE_BYTES)
        final = response.geturl()
    if accept_html and kind and not re.search(r"html|xml|text/plain", kind, re.I):
        return final, None, kind
    charset = None
    m = re.search(r"charset=([\w-]+)", kind, re.I) or re.search(rb"<meta[^>]+charset=[\"']?([\w-]+)", raw[:4000], re.I)
    if m:
        charset = m.group(1).decode("ascii", "ignore") if isinstance(m.group(1), bytes) else m.group(1)
    try:
        return final, raw.decode(charset or "utf-8", errors="replace"), kind
    except LookupError:
        return final, raw.decode("utf-8", errors="replace"), kind


def host_of(url):
    try:
        host = (urllib.parse.urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def clean_url(url):
    parts = urllib.parse.urlsplit(url)
    query = "&".join(q for q in parts.query.split("&") if q and not re.match(r"(utm_|fbclid|gclid)", q))
    path = parts.path or "/"
    return urllib.parse.urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, query, ""))


def seen_key(url):
    u = clean_url(url)
    return u[:-1] if u.endswith("/") else u


def sitemap_urls(start, robots_text, pause):
    """Page addresses from the site's sitemap (named in robots.txt, or /sitemap.xml), same site only."""
    base = urllib.parse.urlsplit(start)
    root = base.scheme + "://" + base.netloc
    maps = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", robots_text or "")
    if not maps:
        maps = [root + "/sitemap.xml", root + "/sitemap_index.xml"]
    found, done = [], set()
    while maps and len(done) < 20:
        address = maps.pop(0)
        if address in done or host_of(address) != host_of(start):
            continue
        done.add(address)
        pause()
        try:
            _, body, _ = fetch(address, accept_html=False)
            tree = ET.fromstring(body.encode("utf-8"))
        except Exception:
            continue
        tag = tree.tag.split("}")[-1]
        locs = [el.text.strip() for el in tree.iter() if el.tag.split("}")[-1] == "loc" and el.text]
        if tag == "sitemapindex":
            maps.extend(locs)
        else:
            found.extend(u for u in locs if host_of(u) == host_of(start))
        if found and tag != "sitemapindex":
            break
    return found


def cmd_web(lib, args):
    start = args.url.strip()
    if not re.match(r"^https?://", start, re.I):
        start = "https://" + start
    limit = max(1, min(int(args.max), 200)) if args.crawl else 1
    last = [0.0]

    def pause():
        gap = time.time() - last[0]
        if gap < 1.0:
            time.sleep(1.0 - gap)
        last[0] = time.time()

    robots = urllib.robotparser.RobotFileParser()
    robots_text = ""
    allowed = lambda u: True
    if args.crawl:
        base = urllib.parse.urlsplit(start)
        try:
            pause()
            _, robots_text, _ = fetch(base.scheme + "://" + base.netloc + "/robots.txt", accept_html=False)
            robots.parse((robots_text or "").splitlines())
            allowed = lambda u: robots.can_fetch(AGENT, u)
        except Exception:
            robots_text = ""
    queue = [start]
    if args.crawl:
        queue += sitemap_urls(start, robots_text, pause)
        say("Reading " + host_of(start) + " (up to " + str(limit) + " pages).")
    seen, pages, failed = set(), 0, 0
    while queue and pages < limit:
        url = queue.pop(0)
        try:
            key = seen_key(url)
            skip = key in seen or SKIP_LINKS.search(urllib.parse.urlsplit(url).path) or not allowed(url)
        except ValueError:
            say("Skipped a broken link: " + url[:120])
            continue
        if skip:
            seen.add(key)
            continue
        seen.add(key)
        pause()
        try:
            final, body, kind = fetch(url)
        except Exception as error:
            say("Could not open " + url + " (" + str(getattr(error, "reason", error))[:120] + ")")
            failed += 1
            continue
        seen.add(seen_key(final))
        if body is None:
            continue
        text, title, links = html_to_text(body)
        if args.crawl:
            for href in links:
                try:
                    nxt = urllib.parse.urljoin(final, href.strip())
                    if nxt.startswith("http") and host_of(nxt) == host_of(start) and seen_key(nxt) not in seen:
                        queue.append(clean_url(nxt))
                except ValueError:
                    say("Skipped a broken link on " + final[:120] + ": " + href.strip()[:80])
        if len(text.split()) < 20:
            say("Skipped " + final + ": almost no words on it.")
            continue
        done = lib.ingest("web", clean_url(final), title or final, text)
        if done is None:
            failed += 1
        pages += 1
    say("Read " + str(pages) + (" page." if pages == 1 else " pages."))
    return 1 if failed and not pages else 0


# ---------- documents ----------

class NeedsPypdf(Exception):
    pass


W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"


def docx_text(path):
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    paras = []
    for p in root.iter(W + "p"):
        bits = []
        for el in p.iter():
            if el.tag == W + "t" and el.text:
                bits.append(el.text)
            elif el.tag == W + "tab":
                bits.append("\t")
            elif el.tag in (W + "br", W + "cr"):
                bits.append("\n")
        line = "".join(bits).strip()
        if line:
            paras.append(line)
    return "\n\n".join(paras)


def drawing_paras(xml_bytes):
    root = ET.fromstring(xml_bytes)
    out = []
    for p in root.iter(A + "p"):
        line = "".join(t.text or "" for t in p.iter(A + "t")).strip()
        if line:
            out.append(line)
    return out


def pptx_text(path):
    num = lambda name: int(re.search(r"(\d+)\.xml$", name).group(1))
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        slides = sorted((n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)), key=num)
        out = []
        for name in slides:
            n = num(name)
            lines = drawing_paras(z.read(name))
            notes_name = "ppt/notesSlides/notesSlide%d.xml" % n
            notes = [l for l in drawing_paras(z.read(notes_name)) if not l.isdigit()] if notes_name in names else []
            block = "Slide %d\n%s" % (n, "\n".join(lines))
            if notes:
                block += "\nSpeaker notes: " + " ".join(notes)
            out.append(block.strip())
    return "\n\n".join(out)


def epub_text(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        order = []
        try:
            container = ET.fromstring(z.read("META-INF/container.xml"))
            opf_path = next(el.get("full-path") for el in container.iter() if el.tag.endswith("rootfile"))
            opf = ET.fromstring(z.read(opf_path))
            folder = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
            items = {el.get("id"): el.get("href") for el in opf.iter() if el.tag.endswith("}item") or el.tag == "item"}
            for el in opf.iter():
                if el.tag.endswith("itemref") and el.get("idref") in items:
                    order.append(urllib.parse.unquote(folder + items[el.get("idref")]))
        except Exception:
            order = []
        if not order:
            order = sorted(n for n in names if re.search(r"\.x?html?$", n, re.I))
        texts = []
        for name in order:
            if name in names:
                text, _, _ = html_to_text(z.read(name).decode("utf-8", errors="replace"))
                if text:
                    texts.append(text)
    return "\n\n".join(texts)


def pdf_text(path):
    try:
        import pypdf  # noqa: optional
    except ImportError:
        raise NeedsPypdf()
    reader = pypdf.PdfReader(str(path))
    pages = []
    for page in reader.pages:
        try:
            pages.append((page.extract_text() or "").strip())
        except Exception:
            pages.append("")
    return "\n\n".join(p for p in pages if p)


def caption_text(raw):
    """WebVTT or SRT captions to plain text: no timings, no tags, no lines repeated by rolling captions."""
    raw = raw.replace("\r\n", "\n").replace("\r", "\n").lstrip("﻿")
    out = []
    block_skip = False
    for line in raw.split("\n"):
        s = line.strip()
        if not s:
            block_skip = False
            continue
        if block_skip:
            continue
        if s.startswith("WEBVTT") or re.match(r"^(Kind|Language|X-TIMESTAMP-MAP)\s*[:=]", s):
            continue
        if re.match(r"^(NOTE|STYLE|REGION)\b", s):
            block_skip = True
            continue
        if "-->" in s or re.match(r"^\d+$", s):
            continue
        s = re.sub(r"<[^>]*>", "", s)
        s = html.unescape(s).replace("​", "")
        s = re.sub(r"\s+", " ", s).strip()
        if not s or re.fullmatch(r"\[[^\]]*\]|\([^)]*\)", s):
            continue
        if out and (s == out[-1] or out[-1].endswith(s)):
            continue
        if out and s.startswith(out[-1]):
            out[-1] = s
            continue
        out.append(s)
    text = " ".join(out)
    return re.sub(r"\s+", " ", text).strip()


def doc_text(path):
    ext = path.suffix.lower()
    if ext in (".txt", ".text", ".md", ".markdown", ".csv"):
        return path.read_text(encoding="utf-8", errors="replace")
    if ext in (".html", ".htm"):
        return html_to_text(path.read_text(encoding="utf-8", errors="replace"))[0]
    if ext == ".docx":
        return docx_text(path)
    if ext == ".pptx":
        return pptx_text(path)
    if ext == ".epub":
        return epub_text(path)
    if ext == ".pdf":
        return pdf_text(path)
    if ext in (".vtt", ".srt"):
        return caption_text(path.read_text(encoding="utf-8", errors="replace"))
    raise ValueError("I can't read " + ext + " files yet")


def pypdf_line(target):
    me = str(Path(__file__).resolve())
    return ('PDFs need one more reader. Run it like this instead: uv run --with pypdf python "' + me + '" '
            + target)


def file_ref(path):
    return path.resolve().as_posix()


def feed_doc(lib, path, quiet_skip=False):
    """Returns 'ok', 'skip', 'fail' or 'pdf'."""
    problem = lib.file_problem(path)
    if problem:
        say("Skipped: " + problem + ".")
        return "fail"
    ref = file_ref(path)
    st = path.stat()
    stamp = {"mtime": int(st.st_mtime), "size": st.st_size}
    if lib.state["files"].get(ref) == stamp:
        if not quiet_skip:
            say("Already in your library: " + path.name)
        return "skip"
    try:
        text = doc_text(path)
    except NeedsPypdf:
        return "pdf"
    except Exception as error:
        say("Could not read " + path.name + " (" + str(error)[:160] + ")")
        return "fail"
    done = lib.ingest("doc", ref, nice_title(path), text, iso_from_mtime(path))
    if done is None:
        return "fail"
    lib.state["files"][ref] = stamp
    lib.save_state()
    return "ok"


def cmd_doc(lib, args):
    path = Path(args.path).expanduser()
    problem = lib.file_problem(path)
    if problem:
        say("I won't read that: " + problem + ".")
        return 1
    if not path.is_file():
        say("There is no file at " + str(path) + ".")
        return 1
    if path.suffix.lower() not in DOC_TYPES:
        say("I can't read " + path.suffix + " files yet. I read " + ", ".join(sorted(DOC_TYPES)) + ".")
        return 1
    result = feed_doc(lib, path)
    if result == "pdf":
        say(pypdf_line('doc "' + str(path) + '"' + env_tail(args)))
        return 4
    return 1 if result == "fail" else 0


def env_tail(args):
    return ((' --env "' + args.env + '"') if getattr(args, "env", None) else "") + (" --helper" if getattr(args, "helper", False) else "")


def files_in(folder, types):
    for dirpath, dirnames, filenames in os.walk(str(folder)):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        for name in sorted(filenames):
            if name.startswith(".") or name.startswith("~$"):
                continue
            p = Path(dirpath) / name
            if p.suffix.lower() in types:
                yield p


def cmd_folder(lib, args):
    folder = Path(args.path).expanduser()
    problem = lib.file_problem(folder)
    if problem:
        say("I won't read that: " + problem + ".")
        return 1
    if not folder.is_dir():
        say("There is no folder at " + str(folder) + ".")
        return 1
    counts = {"ok": 0, "skip": 0, "fail": 0, "pdf": 0}
    pdfs_waiting = 0
    for path in files_in(folder, DOC_TYPES):
        result = feed_doc(lib, path)
        counts[result] += 1
    pdfs_waiting = counts["pdf"]
    media = sum(1 for _ in files_in(folder, MEDIA_TYPES))
    say("From " + folder.name + ": " + str(counts["ok"]) + " added, " + str(counts["skip"]) + " already in your library"
        + (", " + str(counts["fail"]) + " could not be read" if counts["fail"] else "") + ".")
    if media:
        say("There " + ("is 1 video or recording" if media == 1 else "are " + str(media) + " videos or recordings")
            + " in this folder. They go in with: transcribe")
    if pdfs_waiting:
        say(str(pdfs_waiting) + " PDF" + ("" if pdfs_waiting == 1 else "s") + " waiting. " + pypdf_line('folder "' + str(folder) + '"' + env_tail(args)))
        return 4
    return 1 if counts["fail"] and not counts["ok"] else 0


# ---------- recordings, transcribed on this computer ----------

def whisper_up(base):
    try:
        with urllib.request.urlopen(urllib.request.Request(base.rstrip("/") + "/health", headers={"User-Agent": AGENT}), timeout=5):
            return True
    except urllib.error.HTTPError:
        return True  # it answered
    except Exception:
        return False


def multipart(fields, file_field, file_path):
    boundary = "----youcloned" + uuid.uuid4().hex
    lines = []
    for name, value in fields.items():
        lines.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + name + "\"\r\n\r\n" + value + "\r\n").encode("utf-8"))
    lines.append(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + file_field + "\"; filename=\"audio.wav\"\r\n"
                  "Content-Type: audio/wav\r\n\r\n").encode("utf-8"))
    lines.append(Path(file_path).read_bytes())
    lines.append(("\r\n--" + boundary + "--\r\n").encode("utf-8"))
    return b"".join(lines), "multipart/form-data; boundary=" + boundary


def whisper_text(base, wav):
    body, kind = multipart({"response_format": "json", "temperature": "0"}, "file", wav)
    last = None
    # whisper.cpp's server answers on the path it was started with: the voice step uses the OpenAI-style one.
    for path in ("/v1/audio/transcriptions", "/inference"):
        request = urllib.request.Request(base.rstrip("/") + path, data=body, method="POST",
                                         headers={"Content-Type": kind, "User-Agent": AGENT})
        try:
            with urllib.request.urlopen(request, timeout=1800) as response:
                raw = response.read().decode("utf-8", errors="replace")
            try:
                return str(json.loads(raw).get("text", ""))
            except ValueError:
                return raw
        except urllib.error.HTTPError as error:
            last = error
            if error.code != 404:
                raise
    raise last


def clean_transcript(text):
    text = re.sub(r"\[(?:BLANK_AUDIO|MUSIC|Music|music|SOUND|silence|inaudible)[^\]]*\]", " ", text)
    text = re.sub(r"\((?:music|Music|upbeat music|silence|inaudible)[^)]*\)", " ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def media_seconds(path):
    probe = shutil.which("ffprobe")
    if not probe:
        return None
    try:
        out = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        return float(out)
    except (ValueError, OSError, subprocess.SubprocessError):
        return None


def cmd_transcribe(lib, args):
    target = Path(args.path).expanduser()
    problem = lib.file_problem(target)
    if problem:
        say("I won't read that: " + problem + ".")
        return 1
    if not target.exists():
        say("There is nothing at " + str(target) + ".")
        return 1
    base = args.whisper or os.environ.get("YOUCLONED_WHISPER_URL") or DEFAULT_WHISPER
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        say("ffmpeg isn't on this computer yet. The tools step of setup installs it.")
        return 5
    if not whisper_up(base):
        say("The transcriber isn't answering on this computer. The voice step of setup installs it; run that step, then try again.")
        return 5
    files = [target] if target.is_file() else list(files_in(target, MEDIA_TYPES))
    if not files:
        say("I found no videos or recordings in " + str(target) + ".")
        return 0
    failed = done = 0
    for path in files:
        if path.suffix.lower() not in MEDIA_TYPES:
            say("Skipped " + path.name + ": not a video or recording.")
            continue
        problem = lib.file_problem(path)
        if problem:
            say("Skipped: " + problem + ".")
            failed += 1
            continue
        ref = file_ref(path)
        st = path.stat()
        stamp = {"mtime": int(st.st_mtime), "size": st.st_size}
        if lib.state["files"].get(ref) == stamp:
            say("Already in your library: " + path.name)
            continue
        seconds = media_seconds(path)
        say("Transcribing " + path.name + (" (" + str(max(1, round(seconds / 60))) + " min)" if seconds else "") + "...")
        with tempfile.TemporaryDirectory(prefix="youcloned-") as tmp:
            pattern = os.path.join(tmp, "part%04d.wav")
            run = subprocess.run([ffmpeg, "-nostdin", "-loglevel", "error", "-y", "-i", str(path), "-vn", "-ac", "1", "-ar", "16000",
                                  "-c:a", "pcm_s16le", "-f", "segment", "-segment_time", str(SEGMENT_SECONDS), pattern],
                                 capture_output=True, text=True)
            parts = sorted(Path(tmp).glob("part*.wav"))
            if run.returncode != 0 or not parts:
                say("Could not read the sound in " + path.name + " (" + (run.stderr.strip().splitlines() or ["no sound found"])[-1][:160] + ")")
                failed += 1
                continue
            texts = []
            try:
                for part in parts:
                    texts.append(clean_transcript(whisper_text(base, part)))
            except Exception as error:
                say("The transcriber stopped on " + path.name + " (" + str(error)[:160] + ")")
                failed += 1
                continue
        text = "\n\n".join(t for t in texts if t)
        if len(text.split()) < 3:
            say("Skipped " + path.name + ": no speech in it.")
            continue
        result = lib.ingest(args.kind, ref, nice_title(path), text, iso_from_mtime(path))
        if result is None:
            failed += 1
            continue
        lib.state["files"][ref] = stamp
        lib.save_state()
        done += 1
    say("Transcribed " + str(done) + (" recording." if done == 1 else " recordings.") + (" " + str(failed) + " had a problem." if failed else ""))
    return 1 if failed and not done else 0


# ---------- YouTube ----------

def ytdlp():
    if shutil.which("yt-dlp"):
        return [shutil.which("yt-dlp")]
    if shutil.which("uvx"):
        return [shutil.which("uvx"), "yt-dlp"]
    return None


def channel_videos_url(url):
    url = url.strip().rstrip("/")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    if re.search(r"/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)$", url):
        url += "/videos"
    return url


def cmd_youtube(lib, args):
    tool = ytdlp()
    if not tool:
        say("I need the YouTube reader (yt-dlp) for this, and it isn't on this computer. The tools step of setup installs uv, which brings it.")
        return 6
    listing = subprocess.run(tool + ["--flat-playlist", "--ignore-errors", "--playlist-end", str(int(args.max)),
                                     "--print", "%(id)s\t%(title)s", channel_videos_url(args.url)],
                             capture_output=True, text=True, timeout=900)
    videos = []
    for line in listing.stdout.splitlines():
        if "\t" in line:
            vid, title = line.split("\t", 1)
            if re.fullmatch(r"[\w-]{6,20}", vid.strip()):
                videos.append((vid.strip(), title.strip()))
    if not videos:
        say("I couldn't list the videos on that channel. Check the address (it looks like youtube.com/@yourname).")
        return 1
    say("Found " + str(len(videos)) + " videos. Reading their captions.")
    added = missing = in_a_row = 0
    for vid, title in videos:
        ref = "https://www.youtube.com/watch?v=" + vid
        if ref in lib.state["hashes"]:
            continue
        time.sleep(1)
        with tempfile.TemporaryDirectory(prefix="youcloned-yt-") as tmp:
            run = subprocess.run(tool + ["--skip-download", "--no-simulate", "--write-subs", "--write-auto-subs", "--sub-langs", "en.*,en",
                                         "--sub-format", "vtt", "--print", "%(upload_date)s", "-o", os.path.join(tmp, "%(id)s.%(ext)s"), ref],
                                 capture_output=True, text=True, timeout=300)
            subs = sorted(Path(tmp).glob("*.vtt"), key=lambda p: ("orig" in p.name, len(p.name)))
            date = next((l for l in run.stdout.split() if re.fullmatch(r"\d{8}", l)), None)
            text = caption_text(subs[0].read_text(encoding="utf-8", errors="replace")) if subs else ""
        if not text:
            missing += 1
            in_a_row = in_a_row + 1 if run.returncode != 0 else 0
            if in_a_row >= 5:
                say("YouTube stopped answering for now. I'll pick up where I left off next time.")
                break
            continue
        in_a_row = 0
        when = (date[:4] + "-" + date[4:6] + "-" + date[6:] + "T00:00:00Z") if date else None
        if lib.ingest("youtube", ref, title or vid, text, when) is not None:
            added += 1
    say("Added " + str(added) + " video transcripts." + (" " + str(missing) + " had no captions." if missing else ""))
    return 0


# ---------- the rest ----------

def cmd_add(lib, args):
    if args.remove and not args.file:
        say("--remove works only with --file.")
        return 2
    if args.file:
        path = Path(args.file).expanduser()
        problem = lib.file_problem(path)
        if not problem and args.remove and lib.helper:
            problem = lib.file_problem(path, roots=("feeding",))
            problem = problem and problem.replace("is outside", "can be removed only inside")
        if problem:
            say("I won't read that: " + problem + ".")
            return 1
        if not path.is_file():
            say("There is no file at " + str(path) + ".")
            return 1
        text = path.read_text(encoding="utf-8", errors="replace")
    else:
        text = sys.stdin.read()
    when = None
    if args.date:
        when = args.date.strip()
    result = lib.ingest(args.kind, args.ref.strip(), (args.title or args.ref).strip(), text, when)
    if result is not None and args.file and args.remove:
        try:
            Path(args.file).expanduser().unlink()
        except OSError:
            pass
    return 1 if result is None else 0


def cmd_search(lib, args):
    body = {"action": "search", "query": args.query, "k": int(args.k)}
    if args.kinds:
        body["kinds"] = [k.strip() for k in args.kinds.split(",") if k.strip()]
    status, reply = lib.call(body)
    if status != 200:
        say("Search did not work (status " + str(status) + ": " + str(reply.get("error", "")) + ")")
        return 1
    results = reply.get("results", [])
    if not results:
        say("Nothing in your library matches that yet.")
    for i, r in enumerate(results, 1):
        snippet = re.sub(r"\s+", " ", str(r.get("content", ""))).strip()
        say("%d. %s (%s, score %.3f)" % (i, r.get("title", ""), r.get("kind", ""), float(r.get("score", 0) or 0)))
        say("   " + r.get("ref", ""))
        say("   " + (snippet[:400] + ("..." if len(snippet) > 400 else "")))
    return 0


def cmd_stats(lib, args):
    status, reply = lib.call({"action": "stats"})
    if status != 200:
        say("Could not read the library (status " + str(status) + ": " + str(reply.get("error", "")) + ")")
        return 1
    kinds = reply.get("kinds", {})
    names = {"email": "emails", "web": "web pages", "youtube": "YouTube videos", "doc": "documents", "note": "notes", "other": "recordings and other"}
    say("Your library has " + str(reply.get("sources", 0)) + " sources in " + str(reply.get("chunks", 0)) + " searchable pieces, and "
        + str(reply.get("wiki_pages", 0)) + " wiki pages.")
    for k in ("email", "web", "youtube", "doc", "note", "other"):
        if kinds.get(k):
            say("  " + names[k] + ": " + str(kinds[k]))
    if reply.get("last_added"):
        say("Last added: " + str(reply["last_added"]))
    say("STATS " + json.dumps({"sources": reply.get("sources", 0), "chunks": reply.get("chunks", 0),
                               "wiki_pages": reply.get("wiki_pages", 0), "kinds": kinds}, sort_keys=True))
    return 0


def cmd_wiki_put(lib, args):
    path = Path(args.file).expanduser()
    problem = lib.file_problem(path, roots=("library",))
    if problem:
        say("I won't read that: " + problem + ".")
        return 1
    if not path.is_file():
        say("There is no file at " + str(path) + ".")
        return 1
    body = path.read_text(encoding="utf-8", errors="replace")
    if lib.holds_token(args.slug, args.title, body):
        say("Skipped that wiki page: it holds your library token, and that never goes in the library.")
        return 1
    status, reply = lib.call({"action": "wiki_upsert", "slug": args.slug, "title": args.title, "body": body})
    if status != 200:
        say("Could not save wiki page " + args.slug + " (status " + str(status) + ": " + str(reply.get("error", "")) + ")")
        return 1
    say("Saved wiki page " + reply.get("slug", args.slug) + ".")
    return 0


def cmd_wiki_list(lib, args):
    status, reply = lib.call({"action": "wiki_list"})
    if status != 200:
        say("Could not list the wiki (status " + str(status) + ": " + str(reply.get("error", "")) + ")")
        return 1
    pages = reply.get("pages", [])
    if not pages:
        say("Your wiki has no pages yet.")
    for p in pages:
        say(p.get("slug", "") + ": " + p.get("title", ""))
    return 0


def parser():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--env", default=argparse.SUPPRESS, help="the env file (default: the vault's .env)")
    common.add_argument("--helper", action="store_true", default=argparse.SUPPRESS,
                        help="run for a helper: files only inside the helper's own folders")
    top = argparse.ArgumentParser(prog="feed.py", description="Feed the YouCloned library.", parents=[common], allow_abbrev=False)
    sub = top.add_subparsers(dest="command")

    p = sub.add_parser("add", parents=[common], allow_abbrev=False, help="add one source from a file or stdin")
    p.add_argument("--kind", required=True, choices=["email", "web", "youtube", "doc", "note", "other"])
    p.add_argument("--ref", required=True)
    p.add_argument("--title", required=True)
    p.add_argument("--date")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--file")
    g.add_argument("--stdin", action="store_true")
    p.add_argument("--remove", action="store_true", help="delete the file once it is in the library")
    p.set_defaults(run=cmd_add)

    p = sub.add_parser("web", parents=[common], allow_abbrev=False, help="a web page, or the whole site with --crawl")
    p.add_argument("url")
    p.add_argument("--crawl", action="store_true")
    p.add_argument("--max", type=int, default=200)
    p.set_defaults(run=cmd_web)

    p = sub.add_parser("doc", parents=[common], allow_abbrev=False, help="one document")
    p.add_argument("path")
    p.set_defaults(run=cmd_doc)

    p = sub.add_parser("folder", parents=[common], allow_abbrev=False, help="every document in a folder")
    p.add_argument("path")
    p.set_defaults(run=cmd_folder)

    p = sub.add_parser("transcribe", parents=[common], allow_abbrev=False, help="videos and recordings, transcribed on this computer")
    p.add_argument("path")
    p.add_argument("--whisper", help="the transcriber's address (default " + DEFAULT_WHISPER + ")")
    p.add_argument("--kind", default="other", choices=["doc", "other"])
    p.set_defaults(run=cmd_transcribe)

    p = sub.add_parser("youtube", parents=[common], allow_abbrev=False, help="a YouTube channel's captions")
    p.add_argument("url")
    p.add_argument("--max", type=int, default=200)
    p.set_defaults(run=cmd_youtube)

    p = sub.add_parser("search", parents=[common], allow_abbrev=False, help="search the library")
    p.add_argument("query")
    p.add_argument("--k", type=int, default=8)
    p.add_argument("--kinds")
    p.set_defaults(run=cmd_search)

    p = sub.add_parser("stats", parents=[common], allow_abbrev=False, help="what is in the library")
    p.set_defaults(run=cmd_stats)

    p = sub.add_parser("wiki-put", parents=[common], allow_abbrev=False, help="save a wiki page from a file")
    p.add_argument("slug")
    p.add_argument("title")
    p.add_argument("file")
    p.set_defaults(run=cmd_wiki_put)

    p = sub.add_parser("wiki-list", parents=[common], allow_abbrev=False, help="list the wiki pages")
    p.set_defaults(run=cmd_wiki_list)
    return top


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    args = parser().parse_args()
    if not getattr(args, "run", None):
        parser().print_help()
        sys.exit(2)
    lib = Library(getattr(args, "env", None), helper=getattr(args, "helper", False))
    try:
        if args.command in FEEDS_FILES:
            lib.check_once([args.ref.strip()] if args.command == "add" else None)
        code = args.run(lib, args)
    except KeyboardInterrupt:
        say("Stopped. What went in stays in; run it again to carry on.")
        code = 1
    finish(code or 0)


if __name__ == "__main__":
    main()
