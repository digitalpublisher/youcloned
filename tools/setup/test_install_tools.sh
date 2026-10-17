#!/bin/bash
# Tests youcloned/setup/install-tools.sh without touching the computer it runs on (#42).
# Every run gets a sandbox: HOME, TMPDIR and the fake /opt/homebrew, /usr/local and /Applications
# (YC_TOOLS_ROOT) sit in a temp folder, and PATH holds only stubs made here plus links to a few
# basic Unix commands. Stubs write every call to calls.log, so a test can prove nothing was installed.
#   bash tools/setup/test_install_tools.sh
# Set YC_TEST_TMP to keep the sandboxes in a folder of your choice.

# Each check runs its test text through eval, so variables in single quotes expand there.
# shellcheck disable=SC2016,SC2034
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO/youcloned/setup/install-tools.sh"
CONTRACT="$REPO/youcloned/setup/tools.json"
BASE="${YC_TEST_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/yc-tools-test.XXXXXX")}"
mkdir -p "$BASE"
PASS=0
FAIL=0

ok()  { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     | /'; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$OUT"; fi; }
has() { printf '%s\n' "$OUT" | grep -q -F -- "$1"; }
calls() { grep -c -E -- "$1" "$SB/calls.log" 2>/dev/null || true; }

# A stub that logs its call and prints one line for any arguments.
write_stub() { # path, name, line
  mkdir -p "$(dirname "$1")"
  printf '#!/bin/bash\necho "%s $*" >> "%s"\necho "%s"\n' "$2" "$SB/calls.log" "$3" >"$1"
  chmod 755 "$1"
}

new_sandbox() { # arch
  SB="$(mktemp -d "$BASE/sb.XXXXXX")"
  ARCH="$1"
  mkdir -p "$SB/home" "$SB/tmp" "$SB/stubs" "$SB/state" "$SB/lib" \
    "$SB/root/Applications" "$SB/root/opt" "$SB/root/usr/local/bin"
  : >"$SB/calls.log"
  local u p
  for u in awk sed grep tail mkdir rm mktemp chmod cat date ln mv cp tr env touch dirname sort shasum tar; do
    for p in /usr/bin/$u /bin/$u; do if [ -x "$p" ]; then ln -s "$p" "$SB/stubs/$u"; break; fi; done
  done
  cat >"$SB/stubs/uname" <<EOF
#!/bin/bash
echo "uname \$*" >> "$SB/calls.log"
case "\$1" in -m) echo "$ARCH" ;; *) echo Darwin ;; esac
EOF
  cat >"$SB/stubs/xcode-select" <<EOF
#!/bin/bash
echo "xcode-select \$*" >> "$SB/calls.log"
case "\$1" in
  -p) [ -f "$SB/state/devtools" ] && { echo /Library/Developer/CommandLineTools; exit 0; }; echo "xcode-select: error: unable to get active developer directory" >&2; exit 2 ;;
  --version) echo "xcode-select version 2416." ;;
  --install) exit 0 ;;
esac
EOF
  # brew: answers --version and shellenv, and an install drops the tool's stub where Homebrew would.
  # With state/brew-fails it fails and prints credential-looking lines, to prove the chat never shows them.
  cat >"$SB/lib/brew" <<EOF
#!/bin/bash
echo "brew \$*" >> "$SB/calls.log"
R="$SB/root"
mk() { mkdir -p "\$(dirname "\$1")"; printf '#!/bin/bash\necho "%s \$*" >> "%s"\necho "%s"\n' "\$2" "$SB/calls.log" "\$3" > "\$1"; chmod 755 "\$1"; }
case "\$1" in
  --version) echo "Homebrew 7.0.9" ;;
  shellenv) echo 'export PATH="/opt/homebrew/bin:\$PATH"' ;;
  install)
    shift
    if [ -f "$SB/state/brew-fails" ]; then echo "Error: download failed token=fakevalue4471"; echo "password: fakevalue8812"; exit 1; fi
    if [ "\$1" = --cask ]; then mkdir -p "\$R/Applications/Obsidian.app/Contents"; exit 0; fi
    case "\$1" in
      git) mk "\$R/opt/homebrew/bin/git" git "git version 2.56.0" ;;
      python@3.12) mk "\$R/opt/homebrew/bin/python3.12" python3.12 "Python 3.12.15" ;;
      ffmpeg) mk "\$R/opt/homebrew/bin/ffmpeg" ffmpeg "ffmpeg version 9.0.2 Copyright (c) the FFmpeg developers" ;;
      gh) mk "\$R/opt/homebrew/bin/gh" gh "gh version 2.102.0 (2026-10-01)" ;;
      yt-dlp) mk "\$R/opt/homebrew/bin/yt-dlp" yt-dlp "2026.10.10" ;;
      node@24) mk "\$R/opt/homebrew/opt/node@24/bin/node" node "v24.22.0" ;;
    esac ;;
  link) ln -sf "\$R/opt/homebrew/opt/node@24/bin/node" "\$R/opt/homebrew/bin/node" ;;
esac
EOF
  chmod 755 "$SB/lib/brew"
  # curl: only Homebrew's installer is served; that installer records what it was given and puts brew in place.
  cat >"$SB/stubs/curl" <<EOF
#!/bin/bash
echo "curl \$*" >> "$SB/calls.log"
out=""; url=""
while [ \$# -gt 0 ]; do case "\$1" in -o) out="\$2"; shift ;; http*) url="\$1" ;; esac; shift; done
case "\$url" in
  *Homebrew/install*)
    cat > "\$out" <<'INNER'
#!/bin/bash
echo "brew-installer NONINTERACTIVE=\${NONINTERACTIVE:-} askpass=\$([ -x "\${SUDO_ASKPASS:-}" ] && echo ready || echo none)" >> "$SB/calls.log"
mkdir -p "$SB/root/opt/homebrew/bin"
cp "$SB/lib/brew" "$SB/root/opt/homebrew/bin/brew"
INNER
    ;;
  *) exit 22 ;;
esac
EOF
  chmod 755 "$SB/stubs/uname" "$SB/stubs/xcode-select" "$SB/stubs/curl"
}

devtools() { touch "$SB/state/devtools"; }
brew_here() { mkdir -p "$SB/root/opt/homebrew/bin"; cp "$SB/lib/brew" "$SB/root/opt/homebrew/bin/brew"; }
tool() { # name, version line (a stub on PATH, like a tool already on the Mac)
  write_stub "$SB/stubs/$1" "$1" "$2"
}
all_tools() {
  devtools; brew_here
  tool git "git version 2.50.1 (Apple Git-155)"
  tool node "v24.14.1"
  tool python3.12 "Python 3.12.13"
  tool ffmpeg "ffmpeg version 8.1 Copyright (c) the FFmpeg developers"
  tool gh "gh version 2.91.0 (2026-09-01)"
  tool yt-dlp "2026.09.28"
  mkdir -p "$SB/home/Applications/Obsidian.app"
}

run_script() { # args...
  OUT="$(cd "$SB/home" && env -i HOME="$SB/home" PATH="$SB/stubs" TMPDIR="$SB/tmp" SHELL="${TEST_SHELL:-/bin/zsh}" \
    YC_TOOLS_ROOT="$SB/root" YC_FAKE_ENV="envvalue-fake-3390" /bin/bash "$SCRIPT" "$@" 2>&1)"
  CODE=$?
}

snapshot() { (cd "$SB" && find home root tmp -print | LC_ALL=C sort | while read -r f; do stat -f '%N %z %m' "$f"; done); }
missing_names() { printf '%s\n' "$OUT" | awk '/^MISSING / { print $2 }' | LC_ALL=C sort | tr '\n' ' '; }

# The owner's own files that a slip would touch first. Recorded, never changed.
own_stamp() { for f in "$HOME/.zprofile" "$HOME/.bash_profile" "$HOME/.youcloned/logs/install-tools.log"; do
  if [ -e "$f" ]; then stat -f '%N %z %m' "$f"; else echo "$f absent"; fi; done; }
OWN_BEFORE="$(own_stamp)"

echo "== static checks"
OUT="$(/bin/bash -n "$SCRIPT" 2>&1)"; check "bash -n with the Mac's own bash 3.2" '[ -z "$OUT" ]'
if command -v shellcheck >/dev/null 2>&1; then
  OUT="$(shellcheck -s bash -S warning "$SCRIPT" 2>&1)"; check "shellcheck install-tools.sh" '[ -z "$OUT" ]'
else
  echo "skip shellcheck (not installed here; the GitHub workflow runs it)"
fi
SHIPPED="$REPO/youcloned/setup $REPO/tools/setup $REPO/.github/workflows/night-one-tools.yml"
# shellcheck disable=SC2086
OUT="$(grep -rn "$(printf '\342\200\224\|\342\200\223')" $SHIPPED 2>/dev/null)"; check "no em or en dashes in the shipped files" '[ -z "$OUT" ]'
# shellcheck disable=SC2086
OUT="$(grep -rn "/Users/[a-z]" $SHIPPED 2>/dev/null)"; check "no /Users/ path in the shipped files" '[ -z "$OUT" ]'
OUT="$(LC_ALL=C grep -n "$(printf '[\200-\377]')" "$REPO/youcloned/setup/install-tools.ps1" "$REPO/tools/setup/test_install_tools.ps1" 2>&1)"
check "the PowerShell files are there and plain ASCII" '[ -z "$OUT" ]'
OUT="$(/usr/bin/python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$CONTRACT" 2>&1)"; check "tools.json is valid JSON" '[ -z "$OUT" ]'

echo "== --check with some tools missing"
new_sandbox arm64
devtools; brew_here
tool git "git version 2.50.1 (Apple Git-155)"
tool node "v24.14.1"
tool gh "gh version 2.91.0 (2026-09-01)"
BEFORE="$(snapshot)"
run_script --check
check "--check exits nonzero" '[ $CODE -ne 0 ]'
check "--check lists exactly the missing ones" '[ "$(missing_names)" = "ffmpeg obsidian python yt-dlp " ]'
check "--check prints OK name version for the rest" 'has "OK git 2.50.1" && has "OK node 24.14.1" && has "OK gh 2.91.0" && has "OK homebrew 7.0.9" && has "OK apple-developer-tools 2416"'
check "--check does not say ALL TOOLS READY" '! has "ALL TOOLS READY"'
check "--check changes nothing" '[ "$(snapshot)" = "$BEFORE" ]'
check "--check names match tools.json, in order" '[ "$(printf "%s\n" "$OUT" | awk "/^(OK|MISSING) / { print \$2 }" | tr "\n" " ")" = "$(sed -n "s/^ *\"name\": \"\(.*\)\",/\1/p" "$CONTRACT" | tr "\n" " ")" ]'

echo "== --dry-run with the same tools missing"
run_script --dry-run
B="$SB/root/opt/homebrew/bin/brew"
check "--dry-run exits 0" '[ $CODE -eq 0 ]'
check "--dry-run lists the right brew commands" 'has "Would run: $B install python@3.12" && has "Would run: $B install ffmpeg" && has "Would run: $B install yt-dlp" && has "Would run: $B install --cask obsidian"'
check "--dry-run skips what is there" 'has "Git is already here (2.50.1). Skipping." && ! has "install git" && ! has "install node@24" && ! has "install gh"'
check "--dry-run would add Homebrew to ~/.zprofile" 'has "Would add Homebrew to ~/.zprofile"'
check "--dry-run ran no install" '[ "$(calls "^brew (install|link)|xcode-select --install|^curl")" = 0 ]'
check "--dry-run changes nothing (no files, no log, no profile)" '[ "$(snapshot)" = "$BEFORE" ]'

echo "== --dry-run on a bare Apple silicon Mac"
new_sandbox arm64
BEFORE="$(snapshot)"
run_script --dry-run
check "bare: exits 0" '[ $CODE -eq 0 ]'
check "bare: would open the developer tools box" 'has "Would run: xcode-select --install"'
check "bare: would run Homebrew's own installer non-interactively" 'has "Would run: NONINTERACTIVE=1 bash Homebrew"'
check "bare: would install every formula and link node" 'has "install git" && has "install node@24" && has "link --overwrite --force node@24" && has "install python@3.12" && has "install ffmpeg" && has "install gh" && has "install yt-dlp" && has "install --cask obsidian"'
check "bare: nothing ran and nothing changed" '[ "$(calls "xcode-select --install|^curl|^brew")" = 0 ] && [ "$(snapshot)" = "$BEFORE" ]'

echo "== --check with everything here"
new_sandbox arm64
all_tools
run_script --check
check "all here: --check exits 0" '[ $CODE -eq 0 ]'
check "all here: --check prints ALL TOOLS READY last" '[ "$(printf "%s\n" "$OUT" | tail -n 1)" = "ALL TOOLS READY" ]'
check "all here: nine OK lines and no MISSING" '[ "$(printf "%s\n" "$OUT" | grep -c "^OK ")" = 9 ] && ! has MISSING'
check "all here: Obsidian in ~/Applications counts" 'has "OK obsidian installed"'
run_script
check "all here: install mode skips everything and is ready" '[ $CODE -eq 0 ] && has "ALL TOOLS READY" && [ "$(calls "^brew (install|link)")" = 0 ]'

echo "== developer tools missing"
new_sandbox arm64
brew_here
run_script
check "no devtools: exits 3" '[ $CODE -eq 3 ]'
check "no devtools: tells the person a box opened behind the Claude window" 'has "A box opened behind the Claude window"'
check "no devtools: asks for the box exactly once" '[ "$(calls "^xcode-select --install")" = 1 ]'
check "no devtools: stops before anything else installs" '[ "$(calls "^brew (install|link)|^curl")" = 0 ]'
run_script --check
check "no devtools: --check never opens the box" '[ "$(calls "^xcode-select --install")" = 1 ] && has "MISSING apple-developer-tools"'

echo "== install twice with Homebrew there (zsh and bash users)"
for SH in /bin/zsh /bin/bash; do
  new_sandbox arm64
  devtools; brew_here
  tool git "git version 2.50.1 (Apple Git-155)"
  TEST_SHELL=$SH run_script
  FIRST="$OUT"; FIRST_CODE=$CODE
  TEST_SHELL=$SH run_script
  OUT="$FIRST
$OUT"
  check "$SH: first run installs and ends with ALL TOOLS READY" '[ $FIRST_CODE -eq 0 ] && [ "$(printf "%s\n" "$FIRST" | tail -n 1)" = "ALL TOOLS READY" ]'
  check "$SH: second run exits 0" '[ $CODE -eq 0 ]'
  check "$SH: brew installed each missing tool once" '[ "$(calls "^brew install")" = 6 ] && [ "$(calls "^brew link")" = 1 ]'
  check "$SH: Homebrew line is in ~/.zprofile exactly once" '[ "$(grep -c "brew shellenv" "$SB/home/.zprofile")" = 1 ]'
  if [ "$SH" = /bin/bash ]; then
    check "$SH: and in ~/.bash_profile exactly once" '[ "$(grep -c "brew shellenv" "$SB/home/.bash_profile")" = 1 ]'
  else
    check "$SH: no ~/.bash_profile for a zsh user" '[ ! -e "$SB/home/.bash_profile" ]'
  fi
  check "$SH: tool output went to the log, not the chat" '[ -s "$SB/home/.youcloned/logs/install-tools.log" ] && ! has "Homebrew 7.0.9 "'
done

echo "== Homebrew from scratch"
new_sandbox arm64
devtools
tool git "git version 2.50.1 (Apple Git-155)"
run_script
check "scratch: ends with ALL TOOLS READY" '[ $CODE -eq 0 ] && has "ALL TOOLS READY"'
check "scratch: Homebrew's installer ran once, non-interactive, with the password box helper" '[ "$(calls "^brew-installer NONINTERACTIVE=1 askpass=ready")" = 1 ]'
check "scratch: tells the person about Homebrew's password box" 'has "If a box asks for your Mac password"'
check "scratch: its temp files are gone" '[ -z "$(ls -A "$SB/tmp")" ]'

echo "== Node too old"
new_sandbox arm64
all_tools
tool node "v18.20.0"
run_script --check
check "old node is MISSING with the reason" 'has "MISSING node (found 18.20.0, needs 20 or newer)" && [ $CODE -ne 0 ]'

echo "== nvm Node counts"
new_sandbox arm64
all_tools
rm -f "$SB/stubs/node"
write_stub "$SB/home/.nvm/versions/node/v22.1.0/bin/node" node "v22.1.0"
write_stub "$SB/home/.nvm/versions/node/v24.14.1/bin/node" node "v24.14.1"
run_script --check
check "the newest nvm Node is found" 'has "OK node 24.14.1" && [ $CODE -eq 0 ]'

echo "== a failure never shows a credential"
new_sandbox arm64
devtools; brew_here
tool git "git version 2.50.1 (Apple Git-155)"
touch "$SB/state/brew-fails"
run_script
check "failure: exits 1 with a plain STOPPED line" '[ $CODE -eq 1 ] && has "STOPPED: "'
check "failure: shows the log tail with values hidden" 'has "token=[hidden]" && has "password: [hidden]" && ! has fakevalue && ! has envvalue-fake'

echo "== Intel Mac"
new_sandbox x86_64
devtools
tool git "git version 2.50.1 (Apple Git-155)"
BEFORE="$(snapshot)"
run_script --dry-run
check "intel: dry run exits 0 and uses no Homebrew" '[ $CODE -eq 0 ] && ! printf "%s\n" "$OUT" | grep -q "Would run: .*brew"'
check "intel: says where each tool comes from" 'has "nodejs.org" && has "uv python install 3.12" && has "ffmpeg-static" && has "github.com/cli/cli" && has "github.com/yt-dlp/yt-dlp" && has "obsidianmd/obsidian-releases"'
check "intel: would add ~/.local/bin to ~/.zprofile" 'has "Would add your own tools folder (~/.local/bin) to ~/.zprofile"'
check "intel: dry run changes nothing" '[ "$(snapshot)" = "$BEFORE" ] && [ "$(calls "^curl")" = 0 ]'
run_script --check
check "intel: Homebrew is OK without being installed" 'has "OK homebrew (not needed on an Intel Mac)" && has "MISSING node"'

echo "== bad option"
new_sandbox arm64
run_script --frobnicate
check "unknown option exits 2" '[ $CODE -eq 2 ]'

echo "== the owner's own files"
OUT="$(own_stamp)"
check "this Mac's ~/.zprofile, ~/.bash_profile and install log untouched" '[ "$OUT" = "$OWN_BEFORE" ]'

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
