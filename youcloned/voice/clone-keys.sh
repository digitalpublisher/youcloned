# Runs when you press one of the two voice keys: "next" cuts your clone off or ends your turn, "stop" ends the voice and goes back to text.
# Usage: bash clone-keys.sh next | stop

VM="$HOME/.local/bin/voicemode"
SOCK="$HOME/.voicemode/control.sock"
LOG="$HOME/.youcloned-phone/keys.log"
mkdir -p "$HOME/.youcloned-phone"

chime() { /usr/bin/afplay -v 0.5 "/System/Library/Sounds/$1.aiff" >/dev/null 2>&1 & }
note() { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG"; }

# The voice only listens for keys while a spoken conversation is running.
if [ ! -S "$SOCK" ] || ! /usr/sbin/lsof "$SOCK" >/dev/null 2>&1; then
  note "$1 pressed, but no spoken conversation is running"
  chime Basso
  exit 0
fi

# One JSON line straight to the voice's control socket, so the key works in under half a second
# (the voicemode command alone takes a fifth of a second just to start). Falls back to it if the direct send fails.
send() { printf '%s\n' "$1" | /usr/bin/nc -U -w 1 "$SOCK" >> "$LOG" 2>&1; }

case "$1" in
  next)
    send '{"command": "skip_forward"}' || "$VM" control skip-forward >> "$LOG" 2>&1
    note "next: cut off or turn ended"
    chime Tink ;;
  stop)
    send '{"command": "stop", "hint": "switch-to-text"}' || "$VM" control stop --hint switch-to-text >> "$LOG" 2>&1
    note "stop: voice off, back to text"
    chime Pop ;;
  *)
    echo "Usage: bash clone-keys.sh next | stop"
    exit 1 ;;
esac
