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
# Appended, never prepended, so the folders the Claude app already gives win. ~/.local/bin is where the
# Tools step puts gh (and Node) on an Intel Mac.
export PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin"

command -v git >/dev/null || { say "Git isn't installed yet. Run setup's Tools step first."; exit 1; }
command -v gh >/dev/null || { say "GitHub's tool (gh) isn't installed yet. Run setup's Tools step first."; exit 1; }
gh auth status >/dev/null 2>&1 || { say "You aren't logged in to GitHub yet. Run: gh auth login --web --git-protocol https --hostname github.com"; exit 2; }
[ -d "$FOLDER" ] || { say "The folder $FOLDER isn't there."; exit 1; }
[ -f "$HOME/.youcloned/git-hooks/pre-commit" ] || { say "Protection isn't on yet, so nothing was backed up. Run setup's Protection step first."; exit 1; }
cd "$FOLDER"
FOLDER=$(pwd)  # the nightly job needs the full path

# Never back up keys, Obsidian's per-device window state, or the trash.
[ -d .git ] || { git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }; }
# Proven again on every run: a run that fails part way never leaves an older "backup is ready" behind.
rm -f .git/youcloned-backup-private
touch .gitignore
for line in '.env' '*.env' '.env.*' '!.env.example' '.DS_Store' '.obsidian/workspace*.json' '.trash/' 'node_modules/' '.venv/' '__pycache__/'; do
  grep -qxF -- "$line" .gitignore || printf '%s\n' "$line" >> .gitignore
done
git check-ignore -q .env || { say "The env file isn't ignored by Git, so nothing was backed up."; exit 1; }

# The privacy check, shared word for word with the nightly job below. Git can fetch from one address
# and push to another (remote.origin.pushurl, or url.*.insteadOf / pushInsteadOf rewriting), so EVERY
# address origin fetches from or pushes to must be a private GitHub repository this login can read.
# Addresses are never printed: one can hold a login token.
CHECKS=$(cat <<'CHECKS_EOF'
gh_slug() {  # prints owner/repo for a github.com address, fails for anything else
  local u=${1%/} re='^(https://([^/@]+@)?github\.com/|ssh://git@github\.com/|git@github\.com:)([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$'
  [[ $u =~ $re ]] || return 1
  local owner=${BASH_REMATCH[3]} repo=${BASH_REMATCH[4]%.git}
  [ -n "$repo" ] || return 1
  printf '%s/%s\n' "$owner" "$repo"
}
private_ok() {
  local slug
  slug=$(gh_slug "$1") || return 1
  [ "$(gh repo view "$slug" --json isPrivate -q .isPrivate 2>/dev/null)" = "true" ]
}
origin_urls() {
  { git remote get-url --all origin 2>/dev/null
    git remote get-url --push --all origin 2>/dev/null
    git ls-remote --get-url origin 2>/dev/null
    git config --get-all remote.origin.url 2>/dev/null
    git config --get-all remote.origin.pushurl 2>/dev/null
  } | sed '/^[[:space:]]*$/d' | sort -u
}
origin_private() {  # 0 all private; 1 an address isn't GitHub; 2 a GitHub one is public or unreadable; 3 none
  local u n=0 list
  list=$(origin_urls)
  while IFS= read -r u; do
    [ -n "$u" ] || continue
    n=$((n + 1))
    gh_slug "$u" >/dev/null || return 1
    private_ok "$u" || return 2
  done <<< "$list"
  [ "$n" -gt 0 ] || return 3
}
CHECKS_EOF
)
eval "$CHECKS"

if git remote | grep -qxF origin; then
  :  # checked below, with every address it fetches from or pushes to
elif [ -n "$THEIRS" ]; then
  gh_slug "$THEIRS" >/dev/null || { say "That doesn't look like a GitHub address. Nothing was changed."; exit 1; }
  private_ok "$THEIRS" || { say "That repository is PUBLIC or can't be read with your GitHub login. Your clone folder only goes to a private one. Nothing was backed up."; exit 1; }
  git remote add origin "$THEIRS"
  say "Using your own private repository."
else
  name="youcloned-$(basename "$FOLDER" | tr -cs 'A-Za-z0-9' '-' | sed 's/^-*//;s/-*$//' | tr 'A-Z' 'a-z')"
  if gh repo view "$name" >/dev/null 2>&1; then name="$name-$(date +%Y%m%d)"; fi
  gh repo create "$name" --private --source . --remote origin >/dev/null
  say "Made your private GitHub repository: $name"
fi

rc=0; origin_private || rc=$?
case "$rc" in
  0) ;;
  1) say "This folder fetches from or pushes to somewhere that isn't a GitHub repository. Nothing was backed up."; exit 1 ;;
  *) say "This folder's GitHub link (where it fetches from or pushes to) is PUBLIC or can't be read. Nothing was backed up. Make it private on github.com, or remove that link, then run this again."; exit 1 ;;
esac

# Files over 50MB stay on this computer (GitHub refuses files over 100MB).
find . -path ./.git -prune -o -type f -size +50M -print 2>/dev/null | sed 's|^\./||' | while IFS= read -r big; do
  grep -qxF -- "$big" .git/info/exclude 2>/dev/null || printf '%s\n' "$big" >> .git/info/exclude
done

git add -A
git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(date +%F)" || true
gh auth setup-git >/dev/null 2>&1 || true  # lets Git use the GitHub login for the push
git push -q -u origin HEAD:main || { say "The first backup did not reach GitHub. Check the internet connection and run this again."; exit 1; }

# The nightly job: the same check, then commit and push. Runs at 2:30am, or at the next wake.
mkdir -p "$HOME/.youcloned" "$HOME/Library/LaunchAgents"
JOB="$HOME/.youcloned/backup-nightly.sh"
{
  printf '%s\n' '#!/bin/bash' 'set -uo pipefail'
  # launchd gives a bare PATH and loads no shell profile, so name every folder the Tools step uses.
  printf '%s\n' 'export PATH="$PATH:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"'
  printf '%s\n' "$CHECKS"
  cat <<'JOB_EOF'
FOLDER=$(head -n 1 "$HOME/.youcloned/backup-folder")
cd "$FOLDER" || exit 1
origin_private || { echo "$(date): an address this folder fetches from or pushes to is not a private GitHub repository you can read, nothing pushed"; exit 1; }
find . -path ./.git -prune -o -type f -size +50M -print 2>/dev/null | sed 's|^\./||' | while IFS= read -r big; do
  grep -qxF -- "$big" .git/info/exclude 2>/dev/null || printf '%s\n' "$big" >> .git/info/exclude
done
git add -A
git -c user.name="YouCloned backup" -c user.email="youcloned-backup@example.com" commit -qm "YouCloned backup $(date +%F)" || true
git push -q origin HEAD:main && echo "$(date): backed up"
JOB_EOF
} > "$JOB"
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
LABEL=ai.bnsn.youcloned.backup
if [ -n "${YOUCLONED_NO_SCHEDULE:-}" ]; then  # tests set it, so no job is loaded on the test computer
  say "Test run: the nightly schedule was not loaded."
else
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  for attempt in 1 2 3; do
    if launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null; then break; fi
    [ "$attempt" = 3 ] || sleep 1
  done
  launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || {
    say "Your clone folder is saved to your private GitHub repository, but the nightly backup could not be scheduled, so this step isn't finished. Restart the computer, then run this again."
    exit 1
  }
fi

# Written only now: the first backup reached GitHub AND the nightly job is scheduled.
touch .git/youcloned-backup-private
say "Your clone folder is saved to a private GitHub repository, and it saves again every night at 2:30am."
say "BACKUP READY"
