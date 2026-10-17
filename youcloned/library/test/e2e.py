#!/usr/bin/env python3
"""End-to-end checks for the YouCloned library Edge Function.

Usage:
  python3 e2e.py ENV_FILE [--db-container NAME]

ENV_FILE holds YOUCLONED_LIBRARY_URL and YOUCLONED_LIBRARY_TOKEN (made by make-token.py).
--db-container lets it look inside the local database to check chunk overlap.
Prints PASS or FAIL per check and exits 1 when any check fails. Never prints the token.
"""
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

args = sys.argv[1:]
if not args:
    sys.exit(__doc__)
env_file = Path(args[0])
container = args[args.index("--db-container") + 1] if "--db-container" in args else None

values = {}
for line in env_file.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip()
URL = values["YOUCLONED_LIBRARY_URL"]
TOKEN = values["YOUCLONED_LIBRARY_TOKEN"]

seen_bodies = []
results = []


def call(body, token=TOKEN, method="POST"):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["x-library-token"] = token
    data = None if method == "GET" else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(URL, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        status = error.code
    seen_bodies.append(raw)
    try:
        return status, json.loads(raw)
    except ValueError:
        return status, {"_raw": raw[:200]}


def check(name, passed, detail=""):
    results.append(passed)
    print(("PASS " if passed else "FAIL ") + name + ("" if passed or not detail else " :: " + str(detail)[:400]))


def words_of(text):
    return set(re.findall(r"[a-z]+", text.lower()))


# Three sources of different kinds. The web page is long enough for several chunks.
EMAIL_REF = "<msg-1001@example.com>"
EMAIL = ("Hi Dana,\n\nI attached the invoice for the twelve-week coaching program. "
         "The balance is due Friday, and you can pay by card or bank transfer. "
         "Thanks again for a great first month.\n\nPat")
WEB_REF = "https://example.com/blog/container-tomatoes"
TIPS = [
    "Pick a pot at least fifty litres deep so the roots have room to spread.",
    "Fill it with a loose potting mix rich in compost and a little perlite for drainage.",
    "Tomatoes want eight hours of direct sun, so a south-facing balcony works best.",
    "Water deeply in the morning and let the top inch of soil dry before watering again.",
    "Feed every two weeks with a liquid fertiliser that is high in potassium once flowers appear.",
    "Pinch out the side shoots on cordon varieties to keep the plant tidy and productive.",
    "Tie the main stem to a stake with soft twine as it grows.",
    "Marigoldia companions planted at the edge of the pot help keep whitefly away.",
    "Harvest when the fruit is fully coloured and gives slightly when squeezed.",
    "Remove yellowing leaves near the base to improve airflow and reduce blight.",
]
WEB = "\n\n".join("Tip %d. %s %s" % (i + 1, TIPS[i % len(TIPS)], TIPS[(i * 3 + 1) % len(TIPS)]) for i in range(40))
WEB_NEW = ("Thornwhistle is the new trellis we tested this spring. "
           "It folds flat for winter and holds two heavy cherry plants without bending.")
YT_REF = "https://www.youtube.com/watch?v=abc123xyz00"
YT = ("My golden retriever Biscuit sprints after the tennis ball across the meadow every morning. "
      "She drops it at my feet and barks until I throw it again, and we keep going until she flops in the grass. "
      "The Brackenwold trail behind our house is her favourite place for it.")
ALL_TEXT = EMAIL + WEB + WEB_NEW + YT

# 1. The lock.
status, body = call({"action": "stats"}, token="wrong-token-value")
check("wrong token gets 401", status == 401 and body.get("ok") is False, (status, body))
status, body = call({"action": "stats"}, token=None)
check("missing token gets 401", status == 401 and body.get("ok") is False, (status, body))
status, body = call({}, method="GET")
check("GET gets 405", status == 405, (status, body))
status, body = call({"action": "explode"})
check("unknown action gets 400 JSON", status == 400 and body.get("ok") is False and "error" in body, (status, body))

# 2. Ingest three kinds.
status, body = call({"action": "ingest", "source": {"kind": "email", "ref": EMAIL_REF, "title": "Invoice for the program",
                                                    "happened_at": "2026-10-01T09:00:00Z"}, "text": EMAIL})
check("ingest email", status == 200 and body.get("ok") and body.get("chunks") == 1, (status, body))
email_chunks = body.get("chunks", 0)
status, body = call({"action": "ingest", "source": {"kind": "web", "ref": WEB_REF, "title": "Container tomatoes"}, "text": WEB})
check("ingest long web page into several chunks", status == 200 and body.get("ok") and body.get("chunks", 0) >= 2
      and body.get("words") == len(WEB.split()), (status, body))
web_chunks = body.get("chunks", 0)
status, body = call({"action": "ingest", "source": {"kind": "youtube", "ref": YT_REF, "title": "Morning fetch"}, "text": YT})
check("ingest youtube transcript", status == 200 and body.get("ok") and body.get("chunks") == 1, (status, body))
yt_chunks = body.get("chunks", 0)

status, body = call({"action": "stats"})
check("stats counts per kind", status == 200 and body.get("kinds", {}).get("email") == 1 and body["kinds"].get("web") == 1
      and body["kinds"].get("youtube") == 1 and body.get("sources") == 3 and body.get("last_added"), body)
check("stats total chunks", body.get("chunks") == email_chunks + web_chunks + yt_chunks, body)

# 3. Chunk overlap (looks inside the local database).
if container:
    sql = ("select string_agg(content, E'\\x1f' order by n) from youcloned.chunks c join youcloned.sources s "
           "on s.id = c.source_id where s.ref = '%s'" % WEB_REF)
    out = subprocess.run(["docker", "exec", "-i", container, "psql", "-U", "postgres", "-At", "-c", sql],
                         capture_output=True, text=True).stdout.rstrip("\n")
    parts = out.split("\x1f")
    sizes = [len(p.split()) for p in parts]
    overlaps = all(" ".join(parts[i + 1].split()[:6]) in " ".join(parts[i].split()[-60:]) for i in range(len(parts) - 1))
    check("chunks are about 350 words, cut on sentences, with overlap",
          len(parts) >= 2 and all(s <= 360 for s in sizes) and max(sizes) >= 250 and overlaps
          and all(p.rstrip().endswith(".") for p in parts), sizes)

# 4. Re-ingest replaces chunks.
status, body = call({"action": "ingest", "source": {"kind": "web", "ref": WEB_REF, "title": "Container tomatoes"}, "text": WEB})
status, body = call({"action": "stats"})
check("re-ingest same page does not double chunks", body.get("chunks") == email_chunks + web_chunks + yt_chunks
      and body.get("sources") == 3, body)
status, body = call({"action": "ingest", "source": {"kind": "web", "ref": WEB_REF, "title": "Container tomatoes v2"}, "text": WEB_NEW})
check("re-ingest new text", status == 200 and body.get("chunks") == 1, (status, body))
status, body = call({"action": "stats"})
check("re-ingest replaced the old chunks", body.get("chunks") == email_chunks + 1 + yt_chunks and body.get("sources") == 3, body)
status, body = call({"action": "search", "query": "Marigoldia", "k": 5})
check("old page text is gone", status == 200 and not any("Marigoldia" in r["content"] for r in body.get("results", [])), body)
status, body = call({"action": "search", "query": "Thornwhistle", "k": 5})
top = (body.get("results") or [{}])[0]
check("new page text is found", top.get("ref") == WEB_REF and top.get("title") == "Container tomatoes v2", body)

# 5. Search by meaning: none of the query words appear in any source.
for query, want_ref in [("puppy playing fetch outdoors", YT_REF), ("outstanding payment request", EMAIL_REF)]:
    shared = words_of(query) & words_of(ALL_TEXT)
    status, body = call({"action": "search", "query": query, "k": 3})
    top = (body.get("results") or [{}])[0]
    check("meaning search '%s' finds %s (no shared words: %s)" % (query, want_ref, "yes" if not shared else sorted(shared)),
          status == 200 and not shared and top.get("ref") == want_ref and isinstance(top.get("score"), float),
          [(r.get("ref"), r.get("score")) for r in body.get("results", [])])

# 6. Search by an exact rare word.
status, body = call({"action": "search", "query": "Brackenwold", "k": 3})
top = (body.get("results") or [{}])[0]
check("keyword search 'Brackenwold' finds the transcript", status == 200 and top.get("ref") == YT_REF
      and "Brackenwold" in top.get("content", ""), body)
status, body = call({"action": "search", "query": "Brackenwold", "k": 5, "kinds": ["email"]})
check("kinds filter keeps only email results", status == 200 and body.get("results")
      and all(r["kind"] == "email" for r in body["results"]), body)
status, body = call({"action": "search", "query": "x", "kinds": ["fax"]})
check("bad kind gets 400", status == 400 and body.get("ok") is False, (status, body))

# 7. Size cap.
status, body = call({"action": "ingest", "source": {"kind": "doc", "ref": "big.txt"}, "text": "a" * 400001})
check("text over 400k characters gets 413", status == 413 and body.get("ok") is False, (status, body))

# 8. Wiki.
status, body = call({"action": "wiki_upsert", "slug": "offers/garden-course", "title": "Garden course", "body": "Backyard Garden Course, $97."})
check("wiki upsert", status == 200 and body.get("ok") and body.get("slug") == "offers/garden-course", body)
status, body = call({"action": "wiki_upsert", "slug": "offers/garden-course", "title": "Garden course (2026)", "body": "Backyard Garden Course, $127."})
status, body = call({"action": "wiki_get", "slug": "offers/garden-course"})
check("wiki get returns the updated page", status == 200 and body.get("page", {}).get("title") == "Garden course (2026)"
      and body["page"].get("body") == "Backyard Garden Course, $127.", body)
call({"action": "wiki_upsert", "slug": "voice", "title": "How I sound", "body": "Warm, short sentences."})
status, body = call({"action": "wiki_list"})
slugs = [p.get("slug") for p in body.get("pages", [])]
check("wiki list", status == 200 and sorted(slugs) == ["offers/garden-course", "voice"] and "body" not in body["pages"][0], body)
status, body = call({"action": "wiki_get", "slug": "nope"})
check("wiki get missing page gets 404", status == 404 and body.get("ok") is False, (status, body))

# 9. Forget.
status, body = call({"action": "forget", "ref": YT_REF})
check("forget removes the source", status == 200 and body.get("forgotten") == 1, body)
status, body = call({"action": "stats"})
check("stats after forget", body.get("kinds", {}).get("youtube") == 0 and body.get("sources") == 2
      and body.get("chunks") == email_chunks + 1, body)
status, body = call({"action": "search", "query": "Brackenwold", "k": 5})
check("forgotten source no longer found", status == 200 and not any(r["ref"] == YT_REF for r in body.get("results", [])), body)

# 10. No secret in any reply.
check("token never appears in a reply", not any(TOKEN in b for b in seen_bodies))

failed = results.count(False)
print("\n%d checks, %d passed, %d failed" % (len(results), len(results) - failed, failed))
sys.exit(1 if failed else 0)
