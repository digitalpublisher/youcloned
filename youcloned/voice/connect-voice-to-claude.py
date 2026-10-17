# Adds the VoiceMode voice to Claude's own settings file (~/.claude.json) so every Claude Code chat on this computer can talk out loud.
# Mac usage: /usr/bin/python3 connect-voice-to-claude.py /path/to/voicemode     (add "remove" as a second word to take it out again)
# PC usage:  python connect-voice-to-claude.py --pc <VoiceMode's python.exe> <pc_voice.py> [ffmpeg folder]     (or --pc remove)
# On a PC the file is .claude.json in your user folder (%USERPROFILE%), the same file Claude Code uses there.
import json
import os
import shutil
import sys
import time

home = os.path.expanduser("~")
settings = os.path.join(home, ".claude.json")
pc = len(sys.argv) > 1 and sys.argv[1] == "--pc"
if pc:
    remove = len(sys.argv) > 2 and sys.argv[2] == "remove"
    if not remove and len(sys.argv) < 4:
        print("    Usage: connect-voice-to-claude.py --pc <python.exe> <pc_voice.py> [ffmpeg folder]")
        sys.exit(2)
else:
    voicemode = sys.argv[1] if len(sys.argv) > 1 else os.path.join(home, ".local", "bin", "voicemode")
    remove = len(sys.argv) > 2 and sys.argv[2] == "remove"

data = {}
if os.path.exists(settings):
    try:
        with open(settings, encoding="utf-8") as f:
            data = json.load(f)
    except ValueError:
        print("    Claude's settings file can't be read right now. Quit Claude and run this setup again.")
        sys.exit(1)
    backup = settings + ".before-voice-" + time.strftime("%Y%m%d-%H%M%S")
    shutil.copy2(settings, backup)

servers = data.setdefault("mcpServers", {})
if remove:
    servers.pop("voicemode", None)
    print("    OK: voice taken out of Claude's settings")
elif pc:
    # VoiceMode starts through pc_voice.py, which gives it a voice-key line that works on Windows.
    python, helper = sys.argv[2], sys.argv[3]
    windir = os.environ.get("SystemRoot", r"C:\Windows")
    parts = [os.path.dirname(python)]
    if len(sys.argv) > 4 and sys.argv[4]:
        parts.append(sys.argv[4])
    parts += [os.path.join(home, ".local", "bin"), os.path.join(windir, "System32"), windir,
              os.path.join(windir, "System32", "WindowsPowerShell", "v1.0")]
    servers["voicemode"] = {"type": "stdio", "command": python, "args": [helper, "mcp"],
                            "env": {"PATH": ";".join(parts), "PYTHONUTF8": "1"}}
    print("    OK: voice added to Claude's settings")
else:
    path = ":".join([
        os.path.join(home, ".local", "bin"),
        "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin",
    ])
    servers["voicemode"] = {"type": "stdio", "command": voicemode, "args": [], "env": {"PATH": path}}
    print("    OK: voice added to Claude's settings")

tmp = settings + ".tmp-voice"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, settings)
os.chmod(settings, 0o600)

# Lets the clone use the voice without asking permission every time (~/.claude/settings.json).
user_settings = os.path.join(home, ".claude", "settings.json")
tools = ["mcp__voicemode__converse"]
us = {}
if os.path.exists(user_settings):
    try:
        with open(user_settings, encoding="utf-8") as f:
            us = json.load(f)
    except ValueError:
        print("    Skipped the voice permission: ~/.claude/settings.json can't be read. Claude will ask the first time instead.")
        sys.exit(0)
    shutil.copy2(user_settings, user_settings + ".before-voice-" + time.strftime("%Y%m%d-%H%M%S"))
allow = us.setdefault("permissions", {}).setdefault("allow", [])
for t in tools:
    if remove and t in allow:
        allow.remove(t)
    elif not remove and t not in allow:
        allow.append(t)
os.makedirs(os.path.dirname(user_settings), exist_ok=True)
tmp = user_settings + ".tmp-voice"
with open(tmp, "w", encoding="utf-8") as f:
    json.dump(us, f, indent=2)
os.replace(tmp, user_settings)
print("    OK: voice permission saved")
