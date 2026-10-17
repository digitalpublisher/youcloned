#!/usr/bin/env python3
"""Check the YouCloned library works: add a one-line note, find it, then remove it.

Usage:
  python3 smoke-test.py [ENV_FILE]

ENV_FILE defaults to the .env file in the vault named by ~/.youcloned/vault-path.
It reads the library address and token from that file and never prints the token.
Prints one PASS or FAIL line per check and exits 1 when any check fails.
Standard library only, Python 3.9 or newer, Mac and Windows.
"""
import json
import secrets
import sys
import urllib.error
import urllib.request
from pathlib import Path

TOKEN_NAME = "YOUCLONED_LIBRARY_TOKEN"
URL_NAME = "YOUCLONED_LIBRARY_URL"


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


def call(url, token, body):
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Content-Type": "application/json", "x-library-token": token})
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode("utf-8"))
        except ValueError:
            return error.code, {}
    except urllib.error.URLError as error:
        reason = str(error.reason)
        if "CERTIFICATE_VERIFY_FAILED" in reason:
            reason += " (on a Mac with Python from python.org, run Install Certificates.command in the Python folder)"
        return 0, {"error": reason}


def main():
    if len(sys.argv) > 1:
        env_file = Path(sys.argv[1]).expanduser()
    else:
        marker = Path.home() / ".youcloned" / "vault-path"
        if not marker.is_file():
            print("FAIL no env file given and ~/.youcloned/vault-path is missing")
            sys.exit(1)
        env_file = Path(marker.read_text(encoding="utf-8").strip()).expanduser() / ".env"
    values = env_values(env_file) if env_file.is_file() else {}
    url, token = values.get(URL_NAME), values.get(TOKEN_NAME)
    if not url or not token:
        print("FAIL the env file has no " + URL_NAME + " or " + TOKEN_NAME + "; run make-token.py first")
        sys.exit(1)

    ref = "youcloned-smoke-test-" + secrets.token_hex(4)
    word = "smokecheck" + secrets.token_hex(3)
    results = []

    status, body = call(url, token, {"action": "ingest", "source": {"kind": "note", "ref": ref, "title": "Smoke test"},
                                     "text": "This one-line note proves the library works: " + word + "."})
    results.append(("add a note", status == 200 and body.get("ok") is True and body.get("chunks") == 1, status, body))

    status, body = call(url, token, {"action": "search", "query": word, "k": 3})
    found = any(r.get("ref") == ref for r in body.get("results", [])) if status == 200 else False
    results.append(("find the note", found, status, body))

    status, body = call(url, token, {"action": "forget", "ref": ref})
    results.append(("remove the note", status == 200 and body.get("forgotten") == 1, status, body))

    failed = False
    for name, passed, status, body in results:
        print(("PASS " if passed else "FAIL ") + name + ("" if passed else " (status " + str(status) + ": " + str(body.get("error", "")) + ")"))
        failed = failed or not passed
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
