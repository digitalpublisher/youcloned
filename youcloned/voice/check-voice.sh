# Checks every piece of your clone's voice on this Mac and says what passed. Add the word "speak" to also hear a test line,
# or "loop" to also run the full loop test (talk, key cuts it off, listen, hear a phrase), which plays sound and uses the mic.
# Usage: bash check-voice.sh            or            bash check-voice.sh speak            or            bash check-voice.sh loop

HERE="$(cd "$(dirname "$0")" && pwd)"
HOMEDIR="$HOME/.youcloned-phone"
LOG="$HOMEDIR/check.log"
ENVFILE="$HOME/.voicemode/voicemode.env"
mkdir -p "$HOMEDIR"
: > "$LOG"
FAILS=0
TMP="$(mktemp -d)"

pass() { printf '\033[0;32m    PASS: %s\033[0m\n' "$1"; echo "PASS $1" >> "$LOG"; }
fail() { printf '\033[0;31m    FAIL: %s\033[0m\n' "$1"; echo "FAIL $1" >> "$LOG"; FAILS=$((FAILS + 1)); }

FFMPEG=""
for p in /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do [ -x "$p" ] && FFMPEG="$p" && break; done

VOICE="am_michael"
[ -f "$ENVFILE" ] && V="$(grep '^VOICEMODE_VOICES=' "$ENVFILE" | head -1 | cut -d= -f2 | cut -d, -f1)" && [ -n "$V" ] && VOICE="$V"

if [ -x "$HOME/.local/bin/voicemode" ]; then pass "VoiceMode is installed"; else fail "VoiceMode is missing (run setup-voice.sh)"; fi
UV=""
for p in /opt/homebrew/bin/uv /usr/local/bin/uv; do [ -x "$p" ] && UV="$p" && break; done
VMPY="$([ -n "$UV" ] && "$UV" tool dir 2>/dev/null)/voice-mode/bin/python"
if [ -x "$VMPY" ] && "$VMPY" "$HERE/patch-voicemode.py" check >> "$LOG" 2>&1; then pass "The instant-stop fix is in"; else fail "The instant-stop fix is missing (run setup-voice.sh)"; fi

# The speaking voice takes a few minutes to wake up the first time, so give it up to 5 minutes.
UP=""
for _ in $(seq 1 100); do
  /usr/bin/curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:8880/v1/models 2>/dev/null | grep -q 200 && UP=1 && break
  sleep 3
done
if [ -n "$UP" ]; then pass "The speaking voice (Kokoro) is running"; else fail "The speaking voice (Kokoro) isn't answering"; fi

UP=""
for _ in $(seq 1 20); do
  /usr/bin/curl -s -m 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:2022/health 2>/dev/null | grep -q 200 && UP=1 && break
  sleep 3
done
if [ -n "$UP" ]; then pass "The listening engine (Whisper) is running"; else fail "The listening engine (Whisper) isn't answering"; fi

LINE="Hi, this is your clone. My voice is working, and I can hear you too."
/usr/bin/curl -s -m 60 -X POST http://127.0.0.1:8880/v1/audio/speech -H 'Content-Type: application/json' \
  -d "{\"model\":\"tts-1\",\"input\":\"$LINE\",\"voice\":\"$VOICE\",\"response_format\":\"mp3\"}" -o "$TMP/test.mp3"
SIZE=$(/usr/bin/stat -f %z "$TMP/test.mp3" 2>/dev/null || echo 0)
if [ "$SIZE" -gt 5000 ]; then
  pass "Your clone spoke a test line ($VOICE)"
  [ "${1:-}" = "speak" ] && /usr/bin/afplay "$TMP/test.mp3"
else
  fail "Your clone couldn't speak the test line"
fi

# Plays the test line into the listening engine and checks it hears the right words.
if [ "$SIZE" -gt 5000 ] && [ -n "$FFMPEG" ]; then
  "$FFMPEG" -loglevel error -y -i "$TMP/test.mp3" -ar 16000 -ac 1 "$TMP/test.wav"
  HEARD=$(/usr/bin/curl -s -m 60 http://127.0.0.1:2022/v1/audio/transcriptions -F file=@"$TMP/test.wav" -F model=whisper-1 -F response_format=json)
  echo "heard: $HEARD" >> "$LOG"
  if echo "$HEARD" | grep -qi "voice"; then pass "The listening engine heard the test line correctly"; else fail "The listening engine didn't hear the test line"; fi
fi

if /usr/bin/python3 -c "import json,os,sys; d=json.load(open(os.path.expanduser('~/.claude.json'))); sys.exit(0 if 'voicemode' in d.get('mcpServers',{}) else 1)" 2>/dev/null; then
  pass "The voice is connected to Claude"
else
  fail "The voice isn't connected to Claude (run setup-voice.sh)"
fi
if [ -f "$HOME/.claude/skills/talk-out-loud/SKILL.md" ]; then pass "The talk skill is in place"; else fail "The talk skill is missing"; fi
if [ -d "$HOME/Library/Services/Clone Next.workflow" ] && [ -d "$HOME/Library/Services/Clone Stop.workflow" ]; then pass "The two voice keys are in place"; else fail "The voice keys are missing"; fi

if grep -q '^VOICEMODE_TTS_BASE_URLS=.*8895' "$ENVFILE" 2>/dev/null; then
  if /usr/bin/curl -s -m 3 http://127.0.0.1:8895/v1/models | grep -q model; then pass "The Speechify voice connector is running"; else fail "The Speechify voice connector isn't answering"; fi
fi

if [ "${1:-}" = "loop" ]; then
  if [ -x "$VMPY" ] && ( set -o pipefail; "$VMPY" "$HERE/loop-test.py" | tee -a "$LOG" ); then pass "The full voice loop passed 3 of 3"; else fail "The full voice loop test didn't pass"; fi
fi

rm -rf "$TMP"
if [ "$FAILS" -eq 0 ]; then echo "    Everything passed."; else echo "    $FAILS check(s) failed. Details: $LOG"; fi
exit "$FAILS"
