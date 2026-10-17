# Adds the instant-stop fix to VoiceMode 8.12.0: the stop key cuts your clone off in under half a second, and the
# conversation keeps going so it listens to you right after. The fix itself is voicemode-8.12.0-instant-stop.diff (next to this file).
# Run with VoiceMode's own Python, so it patches the copy Claude uses:
#   Mac: "$(uv tool dir)/voice-mode/bin/python" patch-voicemode.py
#   PC:  & "$(uv tool dir)\voice-mode\Scripts\python.exe" patch-voicemode.py
# It only changes the exact stock 8.12.0 file, keeps a copy of the original, and is safe to run again.
# Usage: patch-voicemode.py [check]   ("check" changes nothing; it exits 0 only when the fix is in)
import hashlib
import importlib.util
import os
import re
import sys

STOCK = "746256f48a79d2436956c17b2d01a6e7ab7519483273e49869107be0b05b3fcf"    # streaming.py as VoiceMode 8.12.0 ships it
PATCHED = "dfdd7aa35581c4dc0ac2267b521fa5fe1cdba957fe1cee1d3b1063526895fa14"  # the same file with the fix in
DIFF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voicemode-8.12.0-instant-stop.diff")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def apply(old, diff):
    """Applies a unified diff to old (a list of lines). Every context and removed line must match exactly."""
    out, at = [], 0
    hunks = re.split(r"^(?=@@ )", diff, flags=re.M)[1:]
    for hunk in hunks:
        lines = hunk.splitlines(keepends=True)
        start = int(re.match(r"@@ -(\d+)", lines[0]).group(1)) - 1
        out += old[at:start]
        at = start
        for line in lines[1:]:
            tag, text = line[:1], line[1:]
            if tag == "+":
                out.append(text)
            elif tag in (" ", "-"):
                if old[at] != text:
                    raise ValueError("line %d doesn't match the stock file" % (at + 1))
                if tag == " ":
                    out.append(text)
                at += 1
    return out + old[at:]


def main():
    spec = importlib.util.find_spec("voice_mode")
    if not spec or not spec.submodule_search_locations:
        sys.exit("VoiceMode isn't installed for this Python. Run this with VoiceMode's own Python (see the top of this file).")
    target = os.path.join(list(spec.submodule_search_locations)[0], "streaming.py")
    data = open(target, "rb").read()
    if sha(data) == PATCHED:
        print("OK: the VoiceMode instant-stop fix is already in")
        return
    if len(sys.argv) > 1 and sys.argv[1] == "check":
        sys.exit("MISSING: the VoiceMode instant-stop fix isn't in (%s)" % target)
    if sha(data) != STOCK:
        sys.exit("STOPPED: VoiceMode's streaming.py isn't the 8.12.0 file this fix is for, so it was left alone (%s)" % target)
    new = "".join(apply(data.decode().splitlines(keepends=True), open(DIFF).read())).encode()
    if sha(new) != PATCHED:
        sys.exit("STOPPED: the fix didn't come out right, so VoiceMode was left alone")
    if not os.path.exists(target + ".youcloned-original"):
        open(target + ".youcloned-original", "wb").write(data)
    open(target, "wb").write(new)
    print("OK: VoiceMode instant-stop fix added (it loads the next time a voice chat starts)")


if __name__ == "__main__":
    main()
