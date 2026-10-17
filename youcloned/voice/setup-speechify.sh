# Optional upgrade: switches your clone to a Speechify voice, with the free voice kept as the backup. Run "bash setup-speechify.sh off" to go back to the free voice.
# Your Speechify key is saved only in ~/.voicemode/speechify.env on this Mac, locked so only you can read it.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
HOMEDIR="$HOME/.youcloned-phone"
KEYFILE="$HOME/.voicemode/speechify.env"
ENVFILE="$HOME/.voicemode/voicemode.env"
LABEL="com.youcloned.speechify-voice"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

set_env() {
  touch "$ENVFILE"
  if grep -q "^$1=" "$ENVFILE"; then /usr/bin/sed -i '' "s#^$1=.*#$1=$2#" "$ENVFILE"; else printf '%s=%s\n' "$1" "$2" >> "$ENVFILE"; fi
}

if [ "${1:-}" = "off" ]; then
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST"
  set_env VOICEMODE_TTS_BASE_URLS "http://127.0.0.1:8880/v1"
  echo "    OK: back to the free voice. Quit and reopen the Claude app to hear it."
  exit 0
fi

[ -x "$HOME/.local/bin/voicemode" ] || { echo "    Set up the free voice first (setup-voice.sh), then come back here."; exit 1; }

echo ""
echo "    Paste your Speechify API key and press Return."
echo "    Nothing shows on the screen while you paste. That's normal."
printf "    Key: "
read -r -s KEY
echo ""
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
[ ${#KEY} -ge 20 ] || { echo "    That doesn't look like a full key. Copy it again from Speechify and run this again."; exit 1; }

printf "    Speechify voice name (press Return to use leonard): "
read -r SVOICE
SVOICE="$(printf '%s' "${SVOICE:-leonard}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

mkdir -p "$HOME/.voicemode" "$HOMEDIR" "$HOME/Library/LaunchAgents"
umask 077
printf 'SPEECHIFY_API_KEY=%s\nSPEECHIFY_VOICE=%s\nSPEECHIFY_SPEED=1.0\n' "$KEY" "$SVOICE" > "$KEYFILE"
chmod 600 "$KEYFILE"
umask 022
unset KEY
cp "$HERE/speechify-voice.py" "$HOMEDIR/speechify-voice.py"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/python3</string>
		<string>$HOMEDIR/speechify-voice.py</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$HOMEDIR/speechify-voice.log</string>
	<key>StandardErrorPath</key>
	<string>$HOMEDIR/speechify-voice.log</string>
</dict>
</plist>
PLISTEOF

/bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
/bin/launchctl bootstrap "gui/$(id -u)" "$PLIST"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  /usr/bin/curl -s -m 2 http://127.0.0.1:8895/v1/models | grep -q model && break
  sleep 1
done
if ! /usr/bin/curl -s -m 2 http://127.0.0.1:8895/v1/models | grep -q model; then
  echo "    The Speechify connector didn't start. Details: $HOMEDIR/speechify-voice.log"
  exit 1
fi
# One short test line through your Speechify account, so a wrong key or voice name shows up now, not mid-conversation.
CODE=$(/usr/bin/curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8895/v1/audio/speech \
  -H 'Content-Type: application/json' -d '{"input":"Testing.","response_format":"mp3"}')
if [ "$CODE" != "200" ]; then
  /bin/launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1
  rm -f "$PLIST" "$KEYFILE"
  echo "    Speechify didn't accept that key or voice name (it answered: $(tail -1 "$HOMEDIR/speechify-voice.log" | sed 's/.*error: //'))."
  echo "    Your clone stays on the free voice. Check the key and the voice name on Speechify, then run this again."
  exit 1
fi
set_env VOICEMODE_TTS_BASE_URLS "http://127.0.0.1:8895/v1,http://127.0.0.1:8880/v1"
echo "    OK: Speechify voice ($SVOICE) is on, with the free voice as the backup."
echo "    Quit and reopen the Claude app, then say \"let's talk\" to hear it."
