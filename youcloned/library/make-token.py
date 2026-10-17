#!/usr/bin/env python3
"""Make the YouCloned library token and save it in the buyer's env file.

Usage:
  python3 make-token.py [ENV_FILE] --project-url URL [--function NAME] [--new]

ENV_FILE defaults to the .env file in the vault named by ~/.youcloned/vault-path.
URL is the project address the Supabase connector's get_project_url returns.
NAME is the library function's name in that project: library (the default), or youcloned-library when the
project already has a function called library that isn't ours.
The script writes two lines (the token and the library address) and keeps every other line.
It prints only the sha256 of the token, which goes into youcloned.settings.
The token itself is never printed. Run it again without --new and it keeps the token it made before.
Standard library only, Python 3.9 or newer, Mac and Windows.
"""
import argparse
import hashlib
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TOKEN_NAME = "YOUCLONED_LIBRARY_TOKEN"
URL_NAME = "YOUCLONED_LIBRARY_URL"


def fail(message):
    sys.stderr.write("make-token: " + message + "\n")
    sys.exit(1)


def default_env_file():
    marker = Path.home() / ".youcloned" / "vault-path"
    if not marker.is_file():
        fail("no env file given and ~/.youcloned/vault-path is missing; pass the env file path")
    vault = Path(marker.read_text(encoding="utf-8").strip()).expanduser()
    return vault / ".env"


def git_ok(env_file):
    """True when git would never pick this file up: no git, no repository, or the file is ignored."""
    git = shutil.which("git")
    if not git:
        return True
    if sys.platform == "darwin" and git == "/usr/bin/git":
        # Without the developer tools this is a stand-in that pops an install box.
        if subprocess.run(["xcode-select", "-p"], capture_output=True).returncode != 0:
            return True
    folder = str(env_file.parent)
    tracked = subprocess.run([git, "ls-files", "--error-unmatch", "--", env_file.name],
                             cwd=folder, capture_output=True)
    if tracked.returncode == 0:
        fail(str(env_file) + " is tracked by git; take it out of git before a key goes in it")
    ignored = subprocess.run([git, "check-ignore", "-q", "--", env_file.name], cwd=folder, capture_output=True)
    if ignored.returncode == 0 or ignored.returncode == 128:
        return True
    fail(str(env_file) + " is inside a git folder but git does not ignore it; add .env to that folder's .gitignore first")


FUNCTION_NAMES = ("library", "youcloned-library")


def library_url(project_url, name="library"):
    if name not in FUNCTION_NAMES:
        fail("--function must be one of " + ", ".join(FUNCTION_NAMES))
    url = project_url.strip().rstrip("/")
    if not (url.startswith("https://") or url.startswith("http://127.0.0.1") or url.startswith("http://localhost")):
        fail("--project-url must be the https address get_project_url returns")
    for other in FUNCTION_NAMES:
        if url.endswith("/functions/v1/" + other):
            url = url[: -len("/functions/v1/" + other)]
    return url + "/functions/v1/" + name


def main():
    parser = argparse.ArgumentParser(description="Make the YouCloned library token.")
    parser.add_argument("env_file", nargs="?")
    parser.add_argument("--project-url", required=True)
    parser.add_argument("--function", default="library", help="the library function's name (library or youcloned-library)")
    parser.add_argument("--new", action="store_true", help="replace the token even if one is saved")
    args = parser.parse_args()

    env_file = Path(args.env_file).expanduser() if args.env_file else default_env_file()
    env_file = env_file.resolve()
    if env_file.is_dir():
        fail(str(env_file) + " is a folder; pass the env file inside it")
    if not env_file.parent.is_dir():
        fail("folder " + str(env_file.parent) + " does not exist")
    git_ok(env_file)

    lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    existing = None
    for line in lines:
        if line.strip().startswith(TOKEN_NAME + "="):
            existing = line.split("=", 1)[1].strip().strip('"').strip("'")
    token = existing if (existing and not args.new) else secrets.token_urlsafe(32)

    wanted = {TOKEN_NAME: TOKEN_NAME + "=" + token, URL_NAME: URL_NAME + "=" + library_url(args.project_url, args.function)}
    out, seen = [], set()
    for line in lines:
        name = line.strip().split("=", 1)[0].strip()
        if name.startswith("export "):
            name = name[len("export "):].strip()
        if name in wanted and "=" in line:
            if name not in seen:
                out.append(wanted[name])
                seen.add(name)
            continue
        out.append(line)
    for name, line in wanted.items():
        if name not in seen:
            out.append(line)

    handle, temp = tempfile.mkstemp(prefix=".env-", dir=str(env_file.parent))
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(out) + "\n")
        if os.name != "nt":
            os.chmod(temp, 0o600)
        os.replace(temp, str(env_file))
    except BaseException:
        if os.path.exists(temp):
            os.remove(temp)
        raise
    if os.name != "nt":
        os.chmod(str(env_file), 0o600)

    print(hashlib.sha256(token.encode("utf-8")).hexdigest())


if __name__ == "__main__":
    main()
