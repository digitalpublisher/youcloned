# Sets up your clone's free voice on this Mac: the listening engine, the speaking voice, the Claude hookup, the talk skill and the two voice keys.
# Run it from Terminal:  bash ~/Downloads/clone-on-my-phone/files/setup-voice.sh
# Safe to run again. It skips anything already done and never touches your YouCloned setup.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VM="$HOME/.local/bin/voicemode"
ENVFILE="$HOME/.voicemode/voicemode.env"
VOICEMODE_VERSION="8.12.0"

say_step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }
say_ok()   { printf '\033[0;32m    OK: %s\033[0m\n' "$1"; }
say_stop() { printf '\n\033[1;31mSTOPPED: %s\033[0m\n' "$1"; exit 1; }

# Writes one setting into ~/.voicemode/voicemode.env, replacing the old line if there is one.
set_env() {
  mkdir -p "$HOME/.voicemode"
  touch "$ENVFILE"
  if grep -q "^$1=" "$ENVFILE"; then
    /usr/bin/sed -i '' "s#^$1=.*#$1=$2#" "$ENVFILE"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENVFILE"
  fi
}

say_step "Checking this Mac"
[ "$(uname -s)" = "Darwin" ] || say_stop "This setup is for a Mac."
if [ "$(uname -m)" != "arm64" ]; then
  echo "    This Mac has an Intel chip. The voice still works, it just answers a little slower."
fi
if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
  /usr/bin/xcode-select --install >/dev/null 2>&1
  say_stop "Apple's free developer tools aren't on this Mac yet. A box just opened (it can hide behind other windows). Click Install, wait for it to finish, then run this setup again."
fi
say_ok "Apple's developer tools are here"

if /usr/bin/pgrep -x Claude >/dev/null 2>&1; then
  echo ""
  echo "    The Claude app is open. Quit it now: click the Claude window, then press Command and Q together."
  printf "    When Claude is closed, press Return here to keep going. "
  read -r _
  while /usr/bin/pgrep -x Claude >/dev/null 2>&1; do
    printf "    Claude is still open. Quit it with Command and Q, then press Return. "
    read -r _
  done
fi
say_ok "Claude is closed"

say_step "Picking your clone's free voice"
CURRENT_VOICE=""
[ -f "$ENVFILE" ] && CURRENT_VOICE="$(grep '^VOICEMODE_VOICES=' "$ENVFILE" | head -1 | cut -d= -f2 | cut -d, -f1)"
if [ -n "$CURRENT_VOICE" ]; then
  VOICE="$CURRENT_VOICE"
  say_ok "Keeping the voice you picked before ($VOICE)"
else
  echo "    Type 1 for a man's voice or 2 for a woman's voice, then press Return."
  printf "    Your pick (1 or 2): "
  read -r PICK
  case "$PICK" in 2) VOICE="af_sky" ;; *) VOICE="am_michael" ;; esac
  say_ok "Voice picked ($VOICE)"
fi

say_step "Installing Homebrew, the free tool that installs the rest"
BREW=""
[ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew
[ -z "$BREW" ] && [ -x /usr/local/bin/brew ] && BREW=/usr/local/bin/brew
if [ -z "$BREW" ]; then
  echo "    Homebrew asks for your Mac password. Type it (nothing shows while you type) and press Return."
  echo "    If it says Press RETURN to continue, press Return."
  /bin/bash -c "$(/usr/bin/curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || say_stop "Homebrew didn't install. Run this setup again; it picks up where it stopped."
  [ -x /opt/homebrew/bin/brew ] && BREW=/opt/homebrew/bin/brew
  [ -z "$BREW" ] && [ -x /usr/local/bin/brew ] && BREW=/usr/local/bin/brew
  [ -n "$BREW" ] || say_stop "Homebrew didn't install. Run this setup again."
fi
eval "$("$BREW" shellenv)"
if ! grep -q "brew shellenv" "$HOME/.zprofile" 2>/dev/null; then
  printf '\neval "$(%s shellenv)"\n' "$BREW" >> "$HOME/.zprofile"
fi
say_ok "Homebrew is ready"

say_step "Installing the sound tools (a few minutes)"
"$BREW" install uv ffmpeg portaudio cmake >/dev/null 2>&1 || "$BREW" install uv ffmpeg portaudio cmake || say_stop "The sound tools didn't install. Check your internet and run this setup again."
say_ok "Sound tools are ready"

say_step "Installing VoiceMode, the free voice add-on for Claude"
UV="$(dirname "$BREW")/uv"
if [ -x "$VM" ] && "$VM" --version 2>/dev/null | grep -q "$VOICEMODE_VERSION"; then
  say_ok "VoiceMode $VOICEMODE_VERSION is already here"
else
  "$UV" tool install --force "voice-mode==$VOICEMODE_VERSION" || say_stop "VoiceMode didn't install. Check your internet and run this setup again."
fi
[ -x "$VM" ] || say_stop "VoiceMode isn't where it should be ($VM). Run this setup again."
# The instant-stop fix: the stop key cuts your clone off in under half a second and it listens to you right after.
# A reinstall puts the stock file back, so this runs every time. If it can't apply, the voice still works, just slower to stop.
"$("$UV" tool dir)/voice-mode/bin/python" "$HERE/patch-voicemode.py" || printf '    The instant-stop fix was skipped. The voice still works.\n'
say_ok "VoiceMode is ready"

say_step "Writing your voice settings"
# Keeps the Speechify voice if you switched it on before; otherwise the free voice.
if ! grep -q '^VOICEMODE_TTS_BASE_URLS=.*8895' "$ENVFILE" 2>/dev/null; then
  set_env VOICEMODE_TTS_BASE_URLS "http://127.0.0.1:8880/v1"
fi
set_env VOICEMODE_VOICES "$VOICE"
set_env VOICEMODE_TTS_VOICE "$VOICE"
set_env VOICEMODE_PREFER_LOCAL "true"
set_env VOICEMODE_STREAMING_ENABLED "true"
set_env VOICEMODE_TTS_FORMAT "pcm"
set_env VOICEMODE_CONTROL_CHANNEL_ENABLED "true"
set_env VOICEMODE_VAD_AGGRESSIVENESS "0"
set_env VOICEMODE_SILENCE_THRESHOLD_MS "2000"
set_env VOICEMODE_DEFAULT_LISTEN_DURATION "600"
say_ok "Settings saved in ~/.voicemode/voicemode.env"

say_step "Installing the listening engine (Whisper, about 150 MB)"
if ! /usr/bin/curl -s -m 3 http://127.0.0.1:2022/health >/dev/null 2>&1; then
  "$VM" service install whisper || say_stop "The listening engine didn't install. Run this setup again."
fi
# Whisper's start file listens to your whole network by default. This keeps it on this Mac only.
WSTART="$HOME/.voicemode/services/whisper/bin/start-whisper-server.sh"
if [ -f "$WSTART" ] && grep -q -- "--host 0.0.0.0" "$WSTART"; then
  /usr/bin/sed -i '' 's/--host 0\.0\.0\.0/--host 127.0.0.1/g' "$WSTART"
  "$VM" service restart whisper >/dev/null 2>&1
fi
say_ok "Listening engine installed"

say_step "Installing the speaking voice (Kokoro, a few hundred MB)"
if ! /usr/bin/curl -s -m 3 http://127.0.0.1:8880/v1/models >/dev/null 2>&1; then
  "$VM" service install kokoro || say_stop "The speaking voice didn't install. Run this setup again."
fi
# Kokoro's start files also listen to your whole network by default. Same fix: this Mac only.
KDIR="$HOME/.voicemode/services/kokoro"
if grep -q -- "--host 0.0.0.0" "$KDIR"/start-*.sh 2>/dev/null; then
  /usr/bin/sed -i '' 's/--host 0\.0\.0\.0/--host 127.0.0.1/g' "$KDIR"/start-*.sh
  "$VM" service restart kokoro >/dev/null 2>&1
fi
say_ok "Speaking voice installed (the first start takes a few minutes)"

say_step "Connecting the voice to your clone in the Claude app"
/usr/bin/python3 "$HERE/connect-voice-to-claude.py" "$VM" || say_stop "Couldn't connect the voice to Claude. Run this setup again."

mkdir -p "$HOME/.claude/skills/talk-out-loud"
cp "$HERE/talk-out-loud/SKILL.md" "$HOME/.claude/skills/talk-out-loud/SKILL.md"
say_ok "Talk skill added"

say_step "Adding the two voice keys"
bash "$HERE/setup-keys.sh" || say_stop "The voice keys didn't install. Run this setup again."

say_step "Testing the voice"
bash "$HERE/check-voice.sh" speak
RESULT=$?
if [ $RESULT -eq 0 ]; then
  printf '\n\033[1;32mAll set. Open the Claude app again and go back to the guide.\033[0m\n'
else
  printf '\n\033[1;31mThe voice test didn'"'"'t pass. Wait one minute, then run this setup again. Your clone can also read the log: ~/.youcloned-phone/check.log\033[0m\n'
fi
exit $RESULT
