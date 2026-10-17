#!/usr/bin/env python3
"""Runs the check on every row of fixes.json that buyers get, and says what passed.

Setup is only done when every row passes. A row with no check yet counts as not passed.
Each check runs from the add-on folder, so it can name files as voice/... .
Usage: python3 voice/check-fixes.py            (PC: py voice\\check-fixes.py)
       add --list to show the rows without running them
"""
import json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GREEN, RED, PLAIN = "\033[0;32m", "\033[0;31m", "\033[0m"


def platform():
    return "pc" if os.name == "nt" else "mac"


def rows_for(fixes, where):
    """The rows a buyer on this computer gets: buyers yes or adapt, and not n/a here."""
    return [r for r in fixes if r.get("buyers") in ("yes", "adapt") and r.get(where) != "n/a"]


def check_for(row, where):
    check = row.get("check")
    return check.get(where) if isinstance(check, dict) else None


def run(command, where):
    shell = ["powershell", "-NoProfile", "-Command", command] if where == "pc" else ["/bin/bash", "-c", command]
    env = dict(os.environ)
    if where == "mac":
        # Setup puts uv and VoiceMode under Homebrew and ~/.local/bin, which a fresh shell may not have yet.
        env["PATH"] = ":".join(["/opt/homebrew/bin", "/usr/local/bin", os.path.expanduser("~/.local/bin"), env.get("PATH", "")])
    try:
        return subprocess.run(shell, cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def main(args):
    path = os.path.join(ROOT, "fixes.json")
    if "--fixes" in args:
        path = args[args.index("--fixes") + 1]
    where = args[args.index("--platform") + 1] if "--platform" in args else platform()
    rows = rows_for(json.load(open(path))["fixes"], where)
    fails = 0
    for row in rows:
        command = check_for(row, where)
        label = f"{row['id']}: {row['fix']}"
        if "--list" in args:
            print(f"    {row['id']}: {command or 'no check yet'}")
        elif not command:
            print(f"{RED}    NOT CHECKED YET: {label}{PLAIN}")
            fails += 1
        elif run(command, where):
            print(f"{GREEN}    PASS: {label}{PLAIN}")
        else:
            print(f"{RED}    FAIL: {label}{PLAIN}")
            fails += 1
    if "--list" not in args:
        print("    Every fix is in." if fails == 0 else f"    {fails} of {len(rows)} fixes aren't in yet.")
    return min(fails, 125)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
