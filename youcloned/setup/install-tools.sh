#!/bin/bash
# YouCloned night one, the Tools step: puts the free tools your clone uses on this Mac.
# Apple's developer tools, Homebrew (Apple silicon Macs), Git, Node, Python 3.12, ffmpeg,
# GitHub's tool gh (the backup step needs it), yt-dlp and Obsidian. Your clone runs it from the chat.
# Safe to run again: it skips anything already here and never removes or upgrades anything.
#
#   bash install-tools.sh            installs what is missing
#   bash install-tools.sh --check    one line per tool (OK name version, or MISSING name), changes nothing
#   bash install-tools.sh --dry-run  says what it would run, changes nothing
#
# Exit codes: 0 every tool is ready. 1 something is missing or did not install.
# 2 unknown option. 3 Apple's developer tools box is open: click Install, wait, then run this again.
#
# Intel Macs: Homebrew's own installer stops on Intel Macs since September 2026 (#296), so there each
# tool comes from its maker's download into your user folder and no Mac password is asked.
# On Apple silicon the only password box is the one Homebrew's own installer asks for.
# Nothing here prints a key or a password. Tool output goes to ~/.youcloned/logs/install-tools.log.
# Works with the bash every Mac ships (3.2).

set -euo pipefail

MODE=install
case "${1:-}" in
  "") ;;
  --check) MODE=check ;;
  --dry-run) MODE=dry ;;
  -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
  *) echo "Unknown option: $1. Use --check, --dry-run, or nothing to install."; exit 2 ;;
esac

if [ -z "${HOME:-}" ] || [ "$HOME" = / ]; then echo "STOPPED: this needs your user folder (HOME) to be set."; exit 1; fi

# Tests point YC_TOOLS_ROOT at a sandbox so /opt/homebrew, /usr/local and /Applications are fake ones.
# On a buyer's Mac it is empty.
ROOT="${YC_TOOLS_ROOT:-}"
HB_ARM="$ROOT/opt/homebrew"
HB_INTEL="$ROOT/usr/local"
APPS="$ROOT/Applications"
LOCAL_BIN="$HOME/.local/bin"
YC_DIR="$HOME/.youcloned"
LOG="$YC_DIR/logs/install-tools.log"
# shellcheck disable=SC2088
LOG_SHOWN="~/.youcloned/logs/install-tools.log"
NODE_MAJOR=24
MIN_NODE=20
HOMEBREW_URL="https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
# Intel downloads. uv is the same pinned copy the add-on uses for its own Python (hooks/register.js).
UV_VERSION="0.12.15"
UV_SHA="e9ca61775532368fe518ab03e7a354c7ecab8ccb3c7d941c775fcc4a362b801b"
FFMPEG_TAG="b6.1.1"
FFMPEG_SHA="ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"
FFPROBE_SHA="fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0"

# The Claude app hands scripts a short PATH, so the usual tool folders go first.
PATH="$HB_ARM/bin:$LOCAL_BIN:$HB_INTEL/bin:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
export PATH
export HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_CLEANUP=1 NONINTERACTIVE=1

TOOLS="apple-developer-tools homebrew git node python ffmpeg gh yt-dlp obsidian"
WORK=""
cleanup() { if [ -n "$WORK" ]; then rm -rf "$WORK"; fi; }
trap cleanup EXIT

say() { printf '%s\n' "$*"; }

# Shows a path in your user folder as ~/... so the chat never shows a full user path.
# The ~ is printed for the owner to read, never expanded.
# shellcheck disable=SC2088
short_path() { case "$1" in "$HOME"/*) printf '~/%s\n' "${1#"$HOME"/}" ;; *) printf '%s\n' "$1" ;; esac; }

label() {
  case "$1" in
    apple-developer-tools) echo "Apple's developer tools" ;;
    homebrew) echo "Homebrew" ;;
    git) echo "Git" ;;
    node) echo "Node" ;;
    python) echo "Python 3.12" ;;
    ffmpeg) echo "ffmpeg, the video tool" ;;
    gh) echo "GitHub's tool (gh)" ;;
    yt-dlp) echo "yt-dlp, the YouTube transcript tool" ;;
    obsidian) echo "Obsidian" ;;
  esac
}

is_arm() {
  [ "$(uname -m 2>/dev/null || true)" = arm64 ] && return 0
  # Under Rosetta uname says x86_64 on an Apple silicon Mac; this flag still tells the truth.
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]
}

# Hides anything shaped like a key before a log line is shown.
redact() {
  sed -E -e 's/(gh[pousr]_|github_pat_|sk-|xox[abprs]-)[A-Za-z0-9_-]+/\1[hidden]/g' \
    -e 's/((TOKEN|Token|token|PASSWORD|Password|password|SECRET|Secret|secret|KEY|Key|key)[=:][[:space:]]*)[^[:space:]]+/\1[hidden]/g'
}

fail() {
  say "STOPPED: $1"
  if [ -s "$LOG" ]; then
    say "The last lines of the log ($LOG_SHOWN), for your clone:"
    tail -n 12 "$LOG" | redact
  fi
  exit 1
}

# ---------- what is on this Mac ----------
# Each probe prints the version and succeeds, or fails. A line starting with ! is a note for a MISSING line.

devtools_ok() { xcode-select -p >/dev/null 2>&1; }

brew_path() {
  if is_arm; then
    [ -x "$HB_ARM/bin/brew" ] && { echo "$HB_ARM/bin/brew"; return 0; }
  else
    [ -x "$HB_INTEL/bin/brew" ] && { echo "$HB_INTEL/bin/brew"; return 0; }
  fi
  return 1
}

first_field() { awk -v n="$1" 'NR==1 { print $n }'; }

obsidian_app() {
  local a
  for a in "$APPS/Obsidian.app" "$HOME/Applications/Obsidian.app"; do
    if [ -d "$a" ]; then echo "$a"; return 0; fi
  done
  return 1
}

# Node on PATH, or else the newest one nvm keeps in ~/.nvm (the add-on counts those too).
node_path() {
  local n best="" bestmajor=0 m
  if n=$(command -v node 2>/dev/null); then echo "$n"; return 0; fi
  for n in "$HOME"/.nvm/versions/node/v*/bin/node; do
    [ -x "$n" ] || continue
    m=${n#"$HOME"/.nvm/versions/node/v}; m=${m%%.*}
    case "$m" in ''|*[!0-9]*) continue ;; esac
    if [ "$m" -gt "$bestmajor" ]; then best="$n"; bestmajor="$m"; fi
  done
  [ -n "$best" ] && echo "$best"
}

probe() {
  local v b g a
  case "$1" in
    apple-developer-tools)
      devtools_ok || return 1
      v=$(xcode-select --version 2>/dev/null | first_field 3) || v=""
      echo "${v%.}" | grep . || echo installed ;;
    homebrew)
      if b=$(brew_path); then
        v=$("$b" --version 2>/dev/null | first_field 2) || return 1
        [ -n "$v" ] || return 1
        echo "$v"
      elif is_arm; then
        return 1
      else
        echo "(not needed on an Intel Mac)"
      fi ;;
    git)
      g=$(command -v git 2>/dev/null) || return 1
      # Apple's /usr/bin/git is a stand-in that pops the developer tools box until they are installed.
      if [ "$g" = /usr/bin/git ] && ! devtools_ok; then return 1; fi
      v=$(git --version 2>/dev/null | first_field 3) || return 1
      [ -n "$v" ] && echo "$v" ;;
    node)
      b=$(node_path) || return 1
      v=$("$b" --version 2>/dev/null) || return 1
      v=${v#v}
      case "${v%%.*}" in ''|*[!0-9]*) return 1 ;; esac
      if [ "${v%%.*}" -lt "$MIN_NODE" ]; then echo "!found $v, needs $MIN_NODE or newer"; return 1; fi
      echo "$v" ;;
    python)
      command -v python3.12 >/dev/null 2>&1 || return 1
      v=$(python3.12 --version 2>&1 | first_field 2) || return 1
      case "$v" in 3.12*) echo "$v" ;; *) return 1 ;; esac ;;
    ffmpeg)
      command -v ffmpeg >/dev/null 2>&1 || return 1
      v=$(ffmpeg -version 2>/dev/null | first_field 3) || return 1
      [ -n "$v" ] && echo "$v" ;;
    gh)
      command -v gh >/dev/null 2>&1 || return 1
      v=$(gh --version 2>/dev/null | first_field 3) || return 1
      [ -n "$v" ] && echo "$v" ;;
    yt-dlp)
      command -v yt-dlp >/dev/null 2>&1 || return 1
      v=$(yt-dlp --version 2>/dev/null | first_field 1) || return 1
      [ -n "$v" ] && echo "$v" ;;
    obsidian)
      a=$(obsidian_app) || return 1
      v=""
      if command -v plutil >/dev/null 2>&1; then
        v=$(plutil -extract CFBundleShortVersionString raw -o - "$a/Contents/Info.plist" 2>/dev/null) || v=""
      fi
      echo "${v:-installed}" ;;
  esac
}

# Prints one OK or MISSING line per tool. Succeeds only when every tool is here.
report() {
  local t out missing=""
  for t in $TOOLS; do
    if out=$(probe "$t"); then
      say "OK $t $out"
    else
      case "$out" in
        '!'*) say "MISSING $t (${out#!})" ;;
        *) say "MISSING $t" ;;
      esac
      missing="$missing $t"
    fi
  done
  [ -z "$missing" ]
}

have() { probe "$1" >/dev/null 2>&1; }

# ---------- doing it ----------

# Runs one command, or in a dry run only says it. Tool output goes to the log, never to the chat.
run() {
  if [ "$MODE" = dry ]; then say "Would run: $*"; return 0; fi
  printf '\n$ %s\n' "$*" >>"$LOG"
  "$@" >>"$LOG" 2>&1
}

start_log() {
  mkdir -p "$YC_DIR/logs"
  printf '\n===== install-tools.sh %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" >>"$LOG"
}

workdir() {
  if [ -z "$WORK" ]; then WORK=$(mktemp -d "${TMPDIR:-/tmp}/yc-tools.XXXXXX"); fi
}

skip_line() {
  local verb=is
  [ "$1" = apple-developer-tools ] && verb=are
  say "$(label "$1") $verb already here ($(probe "$1")). Skipping."
}

step_devtools() {
  if devtools_ok; then skip_line apple-developer-tools; return 0; fi
  if [ "$MODE" = dry ]; then say "Would run: xcode-select --install"; return 0; fi
  # Asked once per run, never in a loop. The clone waits for the person, then runs this step again.
  xcode-select --install >/dev/null 2>&1 || true
  say "A box opened behind the Claude window asking to install Apple's free developer tools: click Install, wait until it says done (about 5 to 15 minutes), then tell your clone to run this step again."
  exit 3
}

write_askpass() {
  workdir
  cat >"$WORK/askpass.sh" <<'ASKPASS'
#!/bin/bash
# Homebrew's installer calls this when it needs the Mac password. The answer goes straight to sudo.
/usr/bin/osascript -e 'display dialog "Homebrew needs the password you use to unlock this Mac to finish installing your tools." with title "YouCloned tools" default answer "" with hidden answer buttons {"Cancel", "OK"} default button "OK"' -e 'text returned of result' 2>/dev/null
ASKPASS
  chmod 700 "$WORK/askpass.sh"
}

step_homebrew() {
  if brew_path >/dev/null; then
    skip_line homebrew
  elif [ "$MODE" = dry ]; then
    say "Would run: NONINTERACTIVE=1 bash Homebrew's own installer ($HOMEBREW_URL)"
  else
    say "Installing Homebrew, the free tool that installs the rest (a few minutes)."
    workdir
    curl -fsSL --retry 3 -o "$WORK/brew-install.sh" "$HOMEBREW_URL" >>"$LOG" 2>&1 \
      || fail "Homebrew didn't download. Check your internet, then run this step again."
    write_askpass
    say "If a box asks for your Mac password, it's Homebrew's: type the password you use to unlock this Mac and click OK. The box can hide behind the Claude window."
    if ! SUDO_ASKPASS="$WORK/askpass.sh" run /bin/bash "$WORK/brew-install.sh"; then
      if grep -q -i "administrator\|sudo access" "$LOG" 2>/dev/null; then
        fail "Homebrew needs a Mac user that is an administrator. Sign in as one (System Settings, Users and Groups shows which), then run this step again."
      fi
      fail "Homebrew didn't install. Run this step again; it picks up where it stopped."
    fi
    brew_path >/dev/null || fail "Homebrew didn't install. Run this step again."
    say "Homebrew is ready."
  fi
  brew_profile
}

# Adds one line to a shell start file, only if a line like it isn't there yet.
add_profile_line() { # file, grep pattern, line, description
  if [ -f "$1" ] && grep -q -- "$2" "$1" 2>/dev/null; then return 0; fi
  if [ "$MODE" = dry ]; then say "Would add $4 to ~/${1##*/}"; return 0; fi
  printf '\n# YouCloned tools\n%s\n' "$3" >>"$1"
}

profiles() {
  echo "$HOME/.zprofile"
  case "${SHELL:-}" in */bash) echo "$HOME/.bash_profile" ;; esac
}

brew_profile() {
  local b f
  if [ "$MODE" = dry ] && ! brew_path >/dev/null; then b="$HB_ARM/bin/brew"; else b=$(brew_path) || return 0; fi
  for f in $(profiles); do
    add_profile_line "$f" "brew shellenv" "eval \"\$($b shellenv)\"" "Homebrew"
  done
}

local_bin_profile() {
  local f
  for f in $(profiles); do
    add_profile_line "$f" ".local/bin" 'export PATH="$HOME/.local/bin:$PATH"' "your own tools folder (~/.local/bin)"
  done
}

brew_install() { # tool, brew arguments...
  local t="$1"; shift
  local b
  if [ "$MODE" = dry ]; then b=$(brew_path) || b="$HB_ARM/bin/brew"; run "$b" "$@"; return 0; fi
  b=$(brew_path) || fail "Homebrew isn't here, so $(label "$t") can't install. Run this step again."
  say "Installing $(label "$t")..."
  run "$b" "$@" || fail "$(label "$t") didn't install. Check your internet, then run this step again."
}

# ---------- Intel Macs: each maker's own download, into your user folder ----------

sha_ok() { [ "$(shasum -a 256 "$1" | awk '{print $1}')" = "$2" ]; }
fetch() { curl -fsSL --retry 3 -o "$2" "$1" >>"$LOG" 2>&1; }
latest_tag() { curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/$1/releases/latest" 2>>"$LOG" | sed 's#.*/v##'; }

intel_node() {
  local base="https://nodejs.org/dist/latest-v$NODE_MAJOR.x" file sum
  if [ "$MODE" = dry ]; then say "Would download Node $NODE_MAJOR from $base into ~/.youcloned/tools/node and link it in ~/.local/bin"; return 0; fi
  say "Installing Node (from nodejs.org)..."
  workdir
  fetch "$base/SHASUMS256.txt" "$WORK/node.sums" || fail "Node didn't download. Check your internet, then run this step again."
  file=$(awk '$2 ~ /darwin-x64\.tar\.gz$/ { print $2; exit }' "$WORK/node.sums")
  sum=$(awk -v f="$file" '$2 == f { print $1; exit }' "$WORK/node.sums")
  [ -n "$file" ] && fetch "$base/$file" "$WORK/$file" && sha_ok "$WORK/$file" "$sum" \
    || fail "Node didn't download cleanly. Run this step again."
  rm -rf "$YC_DIR/tools/node" "$YC_DIR/tools/${file%.tar.gz}"
  mkdir -p "$YC_DIR/tools" "$LOCAL_BIN"
  tar -xzf "$WORK/$file" -C "$YC_DIR/tools" && mv "$YC_DIR/tools/${file%.tar.gz}" "$YC_DIR/tools/node" \
    || fail "Node didn't unpack. Run this step again."
  local b
  for b in node npm npx; do ln -sf "$YC_DIR/tools/node/bin/$b" "$LOCAL_BIN/$b"; done
}

intel_python() {
  local uv="$YC_DIR/bin/uv" url="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-x86_64-apple-darwin.tar.gz"
  if [ "$MODE" = dry ]; then
    say "Would download uv $UV_VERSION ($url) into ~/.youcloned/bin"
    say "Would run: uv python install 3.12 (puts python3.12 in ~/.local/bin)"
    return 0
  fi
  say "Installing Python 3.12..."
  if [ ! -x "$uv" ]; then
    workdir
    fetch "$url" "$WORK/uv.tar.gz" && sha_ok "$WORK/uv.tar.gz" "$UV_SHA" \
      || fail "Python's installer (uv) didn't download cleanly. Check your internet, then run this step again."
    tar -xzf "$WORK/uv.tar.gz" -C "$WORK" || fail "Python's installer didn't unpack. Run this step again."
    mkdir -p "$YC_DIR/bin"
    cp "$WORK/uv-x86_64-apple-darwin/uv" "$uv" && chmod 755 "$uv"
  fi
  mkdir -p "$LOCAL_BIN"
  UV_PYTHON_BIN_DIR="$LOCAL_BIN" UV_NO_MODIFY_PATH=1 run "$uv" python install 3.12 \
    || fail "Python 3.12 didn't install. Check your internet, then run this step again."
}

intel_ffmpeg() {
  local base="https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_TAG"
  if [ "$MODE" = dry ]; then say "Would download ffmpeg and ffprobe ($base) into ~/.local/bin"; return 0; fi
  say "Installing ffmpeg, the video tool..."
  workdir
  mkdir -p "$LOCAL_BIN"
  fetch "$base/ffmpeg-darwin-x64" "$WORK/ffmpeg" && sha_ok "$WORK/ffmpeg" "$FFMPEG_SHA" \
    && fetch "$base/ffprobe-darwin-x64" "$WORK/ffprobe" && sha_ok "$WORK/ffprobe" "$FFPROBE_SHA" \
    || fail "ffmpeg didn't download cleanly. Check your internet, then run this step again."
  chmod 755 "$WORK/ffmpeg" "$WORK/ffprobe"
  mv -f "$WORK/ffmpeg" "$WORK/ffprobe" "$LOCAL_BIN/"
}

intel_gh() {
  local v file
  if [ "$MODE" = dry ]; then say "Would download GitHub's tool gh (github.com/cli/cli releases) into ~/.youcloned/tools/gh and link it in ~/.local/bin"; return 0; fi
  say "Installing GitHub's tool (gh)..."
  workdir
  v=$(latest_tag cli/cli)
  file="gh_${v}_macOS_amd64.zip"
  [ -n "$v" ] && fetch "https://github.com/cli/cli/releases/download/v$v/$file" "$WORK/$file" \
    && fetch "https://github.com/cli/cli/releases/download/v$v/gh_${v}_checksums.txt" "$WORK/gh.sums" \
    && sha_ok "$WORK/$file" "$(awk -v f="$file" '$2 == f { print $1; exit }' "$WORK/gh.sums")" \
    || fail "GitHub's tool didn't download cleanly. Check your internet, then run this step again."
  unzip -q -o "$WORK/$file" -d "$WORK" || fail "GitHub's tool didn't unpack. Run this step again."
  rm -rf "$YC_DIR/tools/gh"
  mkdir -p "$YC_DIR/tools" "$LOCAL_BIN"
  mv "$WORK/${file%.zip}" "$YC_DIR/tools/gh"
  ln -sf "$YC_DIR/tools/gh/bin/gh" "$LOCAL_BIN/gh"
}

intel_ytdlp() {
  local base="https://github.com/yt-dlp/yt-dlp/releases/latest/download"
  if [ "$MODE" = dry ]; then say "Would download yt-dlp (github.com/yt-dlp/yt-dlp releases) into ~/.local/bin"; return 0; fi
  say "Installing yt-dlp, the YouTube transcript tool..."
  workdir
  mkdir -p "$LOCAL_BIN"
  fetch "$base/yt-dlp_macos" "$WORK/yt-dlp" && fetch "$base/SHA2-256SUMS" "$WORK/yt.sums" \
    && sha_ok "$WORK/yt-dlp" "$(awk '$2 == "yt-dlp_macos" { print $1; exit }' "$WORK/yt.sums")" \
    || fail "yt-dlp didn't download cleanly. Check your internet, then run this step again."
  chmod 755 "$WORK/yt-dlp"
  mv -f "$WORK/yt-dlp" "$LOCAL_BIN/yt-dlp"
}

intel_obsidian() {
  local v dest mnt
  dest="$APPS"
  [ -w "$APPS" ] || dest="$HOME/Applications"
  if [ "$MODE" = dry ]; then say "Would download Obsidian (github.com/obsidianmd/obsidian-releases) and copy it to $(short_path "$dest")"; return 0; fi
  say "Installing Obsidian..."
  workdir
  v=$(latest_tag obsidianmd/obsidian-releases)
  [ -n "$v" ] && fetch "https://github.com/obsidianmd/obsidian-releases/releases/download/v$v/Obsidian-$v.dmg" "$WORK/obsidian.dmg" \
    || fail "Obsidian didn't download. Check your internet, then run this step again."
  mnt="$WORK/mnt"
  mkdir -p "$mnt" "$dest"
  hdiutil attach -nobrowse -quiet -mountpoint "$mnt" "$WORK/obsidian.dmg" >>"$LOG" 2>&1 || fail "Obsidian's download didn't open. Run this step again."
  ditto "$mnt/Obsidian.app" "$dest/Obsidian.app" >>"$LOG" 2>&1 || { hdiutil detach -quiet "$mnt" || true; fail "Obsidian didn't copy into $(short_path "$dest"). Run this step again."; }
  hdiutil detach -quiet "$mnt" >>"$LOG" 2>&1 || true
  if ! codesign --verify "$dest/Obsidian.app" >>"$LOG" 2>&1; then
    rm -rf "$dest/Obsidian.app"
    fail "Obsidian's download didn't pass Apple's signature check, so it was removed. Run this step again."
  fi
}

install_tool() {
  local t="$1"
  if have "$t"; then skip_line "$t"; return 0; fi
  if is_arm; then
    case "$t" in
      git) brew_install git install git ;;
      node)
        brew_install node install "node@$NODE_MAJOR"
        # node@24 is keg-only in Homebrew: linking puts node, npm and npx in Homebrew's bin folder.
        brew_install node link --overwrite --force "node@$NODE_MAJOR" ;;
      python) brew_install python install python@3.12 ;;
      ffmpeg) brew_install ffmpeg install ffmpeg ;;
      gh) brew_install gh install gh ;;
      yt-dlp) brew_install yt-dlp install yt-dlp ;;
      obsidian) brew_install obsidian install --cask obsidian ;;
    esac
  else
    case "$t" in
      git) fail "Git comes with Apple's developer tools, and they aren't answering. Run this step again." ;;
      node) intel_node ;;
      python) intel_python ;;
      ffmpeg) intel_ffmpeg ;;
      gh) intel_gh ;;
      yt-dlp) intel_ytdlp ;;
      obsidian) intel_obsidian ;;
    esac
  fi
  if [ "$MODE" = install ]; then
    hash -r
    have "$t" || fail "$(label "$t") didn't install. Run this step again."
    say "$(label "$t") is ready ($(probe "$t"))."
  fi
}

# ---------- main ----------

if [ "$MODE" = check ]; then
  if report; then say "ALL TOOLS READY"; exit 0; fi
  say "Some tools are missing. Run install-tools.sh with no option to add them."
  exit 1
fi

[ "$MODE" = install ] && start_log
[ "$MODE" = dry ] && say "Dry run: nothing on this Mac changes."
if [ "$(uname -s 2>/dev/null || true)" != Darwin ]; then fail "This step is for a Mac. On a Windows PC use install-tools.ps1."; fi
if ! is_arm; then say "This Mac has an Intel chip, so each tool comes from its maker's own download (Homebrew no longer installs on Intel Macs)."; fi

step_devtools
if is_arm; then step_homebrew; else skip_line homebrew; fi
for t in git node python ffmpeg gh yt-dlp obsidian; do install_tool "$t"; done
if ! is_arm; then local_bin_profile; fi

if [ "$MODE" = dry ]; then say "Dry run done. Nothing was changed."; exit 0; fi
say ""
if report; then
  say "ALL TOOLS READY"
  exit 0
fi
fail "Some tools still aren't here. Run this step again."
