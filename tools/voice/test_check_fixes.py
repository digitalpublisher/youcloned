# The setup check (youcloned/voice/check-fixes.py) runs every buyer row, counts a row with no check as not
# passed, skips author and n/a rows, and only says "Every fix is in." when all pass.
# Runs made-up rows with true/false commands, so nothing on this computer is touched.
# Usage: python3 -I tools/voice/test_check_fixes.py
import json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "..", "..", "youcloned", "voice", "check-fixes.py")


def run(fixes):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump({"fixes": fixes}, f)
    out = subprocess.run([sys.executable, SCRIPT, "--fixes", f.name, "--platform", "mac"], capture_output=True, text=True)
    os.unlink(f.name)
    return out.returncode, out.stdout


row = lambda i, buyers="yes", mac="in-pr", check=None: {"id": i, "fix": "made-up " + i, "buyers": buyers, "mac": mac, "pc": "n/a", "check": check}

code, text = run([row("a", check={"mac": "true"}), row("b", check={"mac": "test -d voice"}), row("j", buyers="author"), row("n", mac="n/a")])
assert code == 0 and "Every fix is in." in text and "PASS: a" in text and "PASS: b" in text, text
assert "j:" not in text and "n:" not in text, text

code, text = run([row("a", check={"mac": "true"}), row("f", check={"mac": "false"}), row("u")])
assert code == 2 and "FAIL: f" in text and "NOT CHECKED YET: u" in text and "2 of 3 fixes" in text, text
assert "Every fix is in." not in text, text

shipped = json.load(open(os.path.join(HERE, "..", "..", "youcloned", "fixes.json")))["fixes"]
listed = subprocess.run([sys.executable, SCRIPT, "--list", "--platform", "mac"], capture_output=True, text=True)
assert listed.returncode == 0 and listed.stdout.count("\n") == sum(1 for r in shipped if r["buyers"] in ("yes", "adapt") and r["mac"] != "n/a"), listed.stdout
print("check-fixes: all 3 tests pass")
