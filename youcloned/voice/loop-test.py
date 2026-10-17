# The full voice loop test, three rounds: your clone talks, the Control+Option+N key cuts it off mid-sentence, the listen opens,
# a test phrase plays through the speakers, and your clone has to hear the right words. Mac only. It plays sound and uses the mic,
# so run it when nobody is talking to the clone. Run with VoiceMode's own Python:
#   "$(uv tool dir)/voice-mode/bin/python" loop-test.py        (or: bash check-voice.sh loop)
# Exits 0 only when every round passes: stopped within 1 second, the listen opened, and the words came through.
import glob
import json
import os
import subprocess
import sys
import time

from voice_mode.config import EVENT_LOG_DIR

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = os.path.expanduser("~/.youcloned-phone/clone-keys.sh")
CONVERSE = ("import sys\nfrom pathlib import Path\nfrom voice_mode.config import EVENT_LOG_DIR\nfrom voice_mode.utils import initialize_event_logger\n"
            "initialize_event_logger(log_dir=Path(EVENT_LOG_DIR), enabled=True)\nfrom voice_mode.cli import voice_mode\n"
            "sys.argv = ['voicemode', 'converse'] + sys.argv[1:]\nsys.exit(voice_mode())\n")
PHRASES = [("the blue pelican flies at noon", "pelican"), ("seven green apples on the table", "apples"), ("the red kite lands softly", "kite")]


def utc():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".%06d" % int((time.time() % 1) * 1e6)


def events(since):
    out = []
    for path in sorted(glob.glob(os.path.join(str(EVENT_LOG_DIR), "voicemode_events_*.jsonl")))[-2:]:
        for line in open(path):
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if d.get("timestamp", "") > since:
                out.append(d)
    return out


def wait_for(since, kind, timeout):
    start = time.time()
    while time.time() - start < timeout:
        for d in events(since):
            if d.get("event_type") == kind:
                return d
        time.sleep(0.05)
    return None


def one_round(n, phrase, word):
    since = utc()
    line = ("Loop test round %d. I'm going to keep talking for quite a while so the key can cut me off in the middle of this long sentence, "
            "and then I'll open the listen and wait for the test phrase to come through the speakers." % n)
    talk = subprocess.Popen([sys.executable, "-c", CONVERSE, "--skip-conch", "-d", "14", "--min-duration", "6", "-m", line],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    if not wait_for(since, "TTS_FIRST_AUDIO", 30):
        talk.kill()
        return {"round": n, "pass": False, "why": "your clone never started talking"}
    time.sleep(1.5)
    pressed = time.time()
    subprocess.run(["/bin/bash", KEYS, "next"], capture_output=True)
    stopped = wait_for(since, "TTS_PLAYBACK_END", 10)
    stop_s = time.time() - pressed if stopped else None
    listening = wait_for(since, "RECORDING_START", 15)
    if listening:
        time.sleep(0.3)
        subprocess.run(["/usr/bin/say", "-v", "Samantha", phrase])
    try:
        talk.communicate(timeout=40)
    except subprocess.TimeoutExpired:
        talk.kill()
    heard = [d for d in events(since) if d.get("event_type") in ("STT_COMPLETE", "STT_NO_SPEECH")]
    text = (heard[-1].get("data") or {}).get("text") if heard else None
    result = {"round": n, "stop_s": round(stop_s, 2) if stop_s is not None else None, "listen_opened": bool(listening), "heard": text}
    if stop_s is None or stop_s > 1.0:
        result["why"] = "the key didn't stop the voice within 1 second"
    elif not listening:
        result["why"] = "the listen didn't open after the key"
    elif not text or word not in text.lower():
        result["why"] = "your clone didn't hear the test phrase"
    result["pass"] = "why" not in result
    return result


def main():
    if not os.path.exists(KEYS):
        sys.exit("The voice keys aren't set up yet. Run setup-voice.sh first.")
    passed = 0
    for n, (phrase, word) in enumerate(PHRASES, 1):
        r = one_round(n, phrase, word)
        print(("    PASS: " if r["pass"] else "    FAIL: ") + "round %d %s" % (n, json.dumps(r)), flush=True)
        passed += r["pass"]
        time.sleep(2)
    print("    %d of 3 loop rounds passed." % passed)
    sys.exit(0 if passed == 3 else 1)


if __name__ == "__main__":
    main()
