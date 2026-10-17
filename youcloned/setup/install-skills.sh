#!/bin/bash
# YouCloned night-one setup, step "Jon's starter skills": downloads the starter skills pack, checks it
# against its published checksum, and puts each skill where Claude finds it (~/.claude/skills).
# Only the pack's own skills are replaced; the owner's own skills are never touched. The old
# "youcloned-setup" skill from the first YouCloned installer clashes with this setup, so it is moved
# to ~/.youcloned/retired-skills instead of deleted.
#
#   install-skills.sh            install or refresh the pack
#   install-skills.sh --check    exit 0 only when every skill in skills-pack.txt is installed
# YOUCLONED_SKILLS_ZIP=<file> uses a local zip instead of the download (tests); its checksum is still checked
# against YOUCLONED_SKILLS_SHA256 when that is set.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
LIST="$HERE/../skills-pack.txt"
SKILLS="$HOME/.claude/skills"
URL="https://youcloned.bnsn.ai/install/skills/youcloned-starter-skills.zip"

say() { printf '%s\n' "$*"; }

names() { grep -v '^[[:space:]]*#' "$LIST" | sed 's/[[:space:]]*$//' | grep -v '^$'; }

check() {
  local missing=0 n
  while IFS= read -r n; do
    [ -f "$SKILLS/$n/SKILL.md" ] || { say "MISSING $n"; missing=$((missing + 1)); }
  done < <(names)
  [ "$missing" -eq 0 ]
}

if [ "${1:-}" = "--check" ]; then
  if check; then say "ALL SKILLS READY"; exit 0; fi
  exit 1
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/youcloned-skills.XXXXXX")
trap 'rm -rf "$work"' EXIT

if [ -n "${YOUCLONED_SKILLS_ZIP:-}" ]; then
  cp "$YOUCLONED_SKILLS_ZIP" "$work/pack.zip"
  want=${YOUCLONED_SKILLS_SHA256:-}
else
  say "Downloading Jon's starter skills pack..."
  curl -fsSL --retry 3 -o "$work/pack.zip" "$URL" || { say "Could not download the skills pack. Check the internet connection and run this again."; exit 1; }
  want=$(curl -fsSL --retry 3 "$URL.sha256" | awk '{print $1}') || want=""
  [ -n "$want" ] || { say "Could not download the pack's checksum, so the pack was not installed. Run this again in a minute."; exit 1; }
fi

if [ -n "$want" ]; then
  have=$(shasum -a 256 "$work/pack.zip" | awk '{print $1}')
  [ "$have" = "$want" ] || { say "The skills pack did not match its checksum, so nothing was installed. Run this again; if it happens twice, tell YouCloned support."; exit 1; }
fi

mkdir -p "$work/stage" "$SKILLS"
unzip -q "$work/pack.zip" -d "$work/stage"
[ -d "$work/stage/skills" ] || { say "The skills pack is not in the expected shape, so nothing was installed."; exit 1; }

if [ -f "$SKILLS/youcloned-setup/SKILL.md" ]; then
  mkdir -p "$HOME/.youcloned/retired-skills"
  rm -rf "$HOME/.youcloned/retired-skills/youcloned-setup"
  mv "$SKILLS/youcloned-setup" "$HOME/.youcloned/retired-skills/youcloned-setup"
  say "Moved the old YouCloned setup skill aside (it clashes with this setup)."
fi

new=0; updated=0
for d in "$work/stage/skills"/*/; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  case "$name" in ''|.*|*/*|youcloned-setup) continue ;; esac
  if [ -e "$SKILLS/$name" ]; then updated=$((updated + 1)); else new=$((new + 1)); fi
  rm -rf "$SKILLS/$name.youcloned-new"
  cp -R "$d" "$SKILLS/$name.youcloned-new"
  rm -rf "$SKILLS/$name"
  mv "$SKILLS/$name.youcloned-new" "$SKILLS/$name"
done

say "Installed $new new skills and refreshed $updated. Your own skills were left as they were."
if check; then say "ALL SKILLS READY"; else say "Some skills from the list are still missing (above). Run this again."; exit 1; fi
