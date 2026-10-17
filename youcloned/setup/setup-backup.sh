#!/bin/bash
# YouCloned night-one setup, step "Back up to GitHub": a PRIVATE GitHub copy of the clone folder,
# saved every night at 2:30am. It never makes or pushes to a public repository: the nightly job checks
# the repository is still private before every push and stops if it isn't.
#
#   setup-backup.sh "<clone folder>" ["<their own private GitHub repository address>"]
# Needs gh logged in (gh auth login). Keys never go up: the env files are git-ignored here, and the
# YouCloned key check (setup's Protection step) blocks any commit that holds one.
set -euo pipefail

FOLDER=${1:?"Give the clone folder, for example: setup-backup.sh \"$HOME/Documents/Obsidian Vault\""}
THEIRS=${2:-}
say() { printf '%s\n' "$*"; }
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"

command -v git >/dev/null || { say "Git isn't installed yet. Run setup's Tools step first."; exit 1; }
command -v gh >/dev/null || { say "GitHub's tool (gh) isn't installed yet. Run setup's Tools step first."; exit 1; }
gh auth status >/dev/null 2>&1 || { say "You aren't logged in to GitHub yet. Run: gh auth login --web --git-protocol https --hostname github.com"; exit 2; }
[ -d "$FOLDER" ] || { say "The folder $FOLDER isn't there."; exit 1; }
[ -f "$HOME/.youcloned/git-hooks/pre-commit" ] || { say "Protection isn't on yet, so nothing was backed up. Run setup's Protection step first."; exit 1; }
cd "$FOLDER"

# Never back up keys, Obsidian's per-device window state, or the trash.
[ -d .git ] || { git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }; }
touch .gitignore
for line in '.env' '*.env' '.env.*' '!.env.example' '.DS_Store' '.obsidian/workspace*.json' '.trash/' 'node_modules/' '.venv/' '__pycache__/'; do
  grep -qxF -- "$line" .gitignore || printf '%s\n' "$line" >> .gitignore
done
git check-ignore -q .env || { say "The env file isn't ignored by Git, so nothing was backed up."; exit 1; }

private_ok() { [ "$(gh repo view "$1" --json isPrivate -q .isPrivate 2>/dev/null)" = "true" ]; }

if url=$(git remote get-url origin 2>/dev/null); then
  case "$url" in
    *github.com*) private_ok "$url" || { say "This folder already points at a GitHub repository that is PUBLIC or can't be read. Nothing was backed up. Make it private on github.com, or remove that link, then run this again."; exit 1; } ;;
    *) say "This folder already backs up somewhere other than GitHub ($url). Nothing was changed."; exit 1 ;;
  esac
elif [ -n "$THEIRS" ]; then
  case "$THEIRS" in *github.com*) ;; *) say "That doesn't look like a GitHub address. Nothing was changed."; exit 1 ;; esac
  private_ok "$THEIRS" || { say "That repository is PUBLIC or can't be read with your GitHub login. Your clone folder only goes to a private one. Nothing was backed up."; exit 1; }
  git remote add origin "$THEIRS"
  url=$THEIRS
  say "Using your own private repository."
else
  name="youcloned-$(basename "$FOLDER" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-*//;s/-*$//' | tr 'A-Z' 'a-z')"
  if gh repo view "$name" >/dev/null 2>&1; then name="$name-$(date +%Y%m%d)"; fi
  gh repo create "$name" --private --source . --remote origin >/dev/null
  url=$(git remote get-url origin)
  private_ok "$url" || { say "GitHub made the repository but didn't report it as private. Nothing was pushed."; exit 1; }
  say "Made your private GitHub repository: $name"
fi

# Files over 50MB stay on this computer (GitHub refuses files over 100MB).
find . -path ./.git -prune -o -type f -size +50M -print 2>/dev/null | sed 's|^\./||' | while IFS= read -r big; do
  grep -qxF -- "$big" .git/info/exclude 2>/dev/null || printf '%s\n' "$big" >> .git/info/exclude
done

git add -A
git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(date +%F)" || true
gh auth setup-git >/dev/null 2>&1 || true  # lets Git use the GitHub login for the push
git push -q -u origin HEAD:main
touch .git/youcloned-backup-private

# The nightly job: the same check, then commit and push. Runs at 2:30am, or at the next wake.
mkdir -p "$HOME/.youcloned" "$HOME/Library/LaunchAgents"
JOB="$HOME/.youcloned/backup-nightly.sh"
cat > "$JOB" <<'JOB_EOF'
#!/bin/bash
set -uo pipefail
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
FOLDER=$(head -n 1 "$HOME/.youcloned/backup-folder")
cd "$FOLDER" || exit 1
url=$(git remote get-url origin) || exit 1
[ "$(gh repo view "$url" --json isPrivate -q .isPrivate 2>/dev/null)" = "true" ] || { echo "$(date): repository not private or not readable, nothing pushed"; exit 1; }
find . -path ./.git -prune -o -type f -size +50M -print 2>/dev/null | sed 's|^\./||' | while IFS= read -r big; do
  grep -qxF -- "$big" .git/info/exclude 2>/dev/null || printf '%s\n' "$big" >> .git/info/exclude
done
git add -A
git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(date +%F)" || true
git push -q origin HEAD:main && echo "$(date): backed up"
JOB_EOF
chmod 755 "$JOB"
printf '%s\n' "$FOLDER" > "$HOME/.youcloned/backup-folder"
PLIST="$HOME/Library/LaunchAgents/ai.bnsn.youcloned.backup.plist"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>ai.bnsn.youcloned.backup</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>$JOB</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>$HOME/.youcloned/backup.log</string>
<key>StandardErrorPath</key><string>$HOME/.youcloned/backup.log</string>
</dict></plist>
PLIST_EOF
if [ -z "${YOUCLONED_NO_SCHEDULE:-}" ]; then  # tests set it, so no job is loaded on the test computer
  launchctl bootout "gui/$(id -u)/ai.bnsn.youcloned.backup" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
fi

say "Your clone folder is saved to a private GitHub repository, and it saves again every night at 2:30am."
say "BACKUP READY"
