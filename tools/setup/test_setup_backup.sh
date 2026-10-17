#!/bin/bash
# Tests youcloned/setup/setup-backup.sh without touching the computer it runs on or any GitHub
# repository. Every case gets a sandbox: HOME, the Git config and the clone folder sit in a temp folder,
# and gh, launchctl and "git push" are stubs that log to calls.log (every other git command is the
# computer's own git, on the sandbox's files). Nothing is pushed anywhere and no launchd job is loaded.
#   bash tools/setup/test_setup_backup.sh
# Set YC_TEST_TMP to keep the sandboxes in a folder of your choice.

set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$REPO/youcloned/setup/setup-backup.sh"
BASE="${YC_TEST_TMP:-$(mktemp -d "${TMPDIR:-/tmp}/yc-backup-test.XXXXXX")}"
mkdir -p "$BASE"
SYS_GIT=$(PATH=/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin command -v git)
PASS=0
FAIL=0
OUT=""
RC=0

ok()  { PASS=$((PASS + 1)); printf 'ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     | /'; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "$OUT"; fi; }
has() { printf '%s\n' "$OUT" | grep -q -F -- "$1"; }
calls() { grep -c -E -- "$1" "$SB/calls.log" 2>/dev/null || true; }

new_sandbox() {
  SB="$(mktemp -d "$BASE/sb.XXXXXX")"
  mkdir -p "$SB/home/.youcloned/git-hooks" "$SB/stubs" "$SB/state/private" "$SB/state/public" "$SB/vault"
  : >"$SB/calls.log"
  : >"$SB/gitconfig"
  touch "$SB/home/.youcloned/git-hooks/pre-commit"
  printf 'a note\n' >"$SB/vault/note.md"
  printf 'PLACEHOLDER_VALUE=1\n' >"$SB/vault/.env"

  # gh: logged in; "repo view OWNER/REPO --json isPrivate" answers from state/private and state/public.
  cat >"$SB/stubs/gh" <<EOF
#!/bin/bash
echo "gh \$*" >> "$SB/calls.log"
case "\$1 \$2" in
  "auth status"|"auth setup-git") exit 0 ;;
  "repo view")
    f=\$(printf '%s' "\$3" | tr '/' '_')
    [ "\${4:-}" = --json ] || exit 1
    if [ -f "$SB/state/private/\$f" ]; then echo true; exit 0; fi
    if [ -f "$SB/state/public/\$f" ]; then echo false; exit 0; fi
    exit 1 ;;
  "repo create")
    "$SYS_GIT" remote add origin "https://github.com/tester/\$3.git"
    touch "$SB/state/private/tester_\$3"
    exit 0 ;;
esac
exit 1
EOF
  # git: the computer's git, except "push", which is only logged (state/push-fails makes it fail).
  cat >"$SB/stubs/git" <<EOF
#!/bin/bash
args=("\$@"); i=0
while [ \$i -lt \${#args[@]} ]; do
  case "\${args[\$i]}" in -c|-C) i=\$((i + 2)) ;; -*) i=\$((i + 1)) ;; *) break ;; esac
done
if [ "\${args[\$i]:-}" = push ]; then
  echo "git push \${args[*]:\$((i + 1))}" >> "$SB/calls.log"
  [ -f "$SB/state/push-fails" ] && exit 1
  exit 0
fi
exec "$SYS_GIT" "\$@"
EOF
  # launchctl: state/launchctl-fails makes every call fail; otherwise bootstrap "loads" the job.
  cat >"$SB/stubs/launchctl" <<EOF
#!/bin/bash
echo "launchctl \$*" >> "$SB/calls.log"
[ -f "$SB/state/launchctl-fails" ] && exit 5
case "\$1" in
  bootstrap|load) touch "$SB/state/loaded" ;;
  bootout) rm -f "$SB/state/loaded" ;;
  print) [ -f "$SB/state/loaded" ] || exit 113 ;;
esac
exit 0
EOF
  chmod 755 "$SB/stubs/gh" "$SB/stubs/git" "$SB/stubs/launchctl"
}

sbgit() { (cd "$SB/vault" && HOME="$SB/home" GIT_CONFIG_GLOBAL="$SB/gitconfig" GIT_CONFIG_NOSYSTEM=1 "$SYS_GIT" "$@"); }
private() { touch "$SB/state/private/$1"; }
public() { touch "$SB/state/public/$1"; }

run_backup() { # [extra env assignments...]
  OUT=$(cd "$SB" && env -i HOME="$SB/home" TMPDIR="$SB" GIT_CONFIG_GLOBAL="$SB/gitconfig" GIT_CONFIG_NOSYSTEM=1 \
    PATH="$SB/stubs:/usr/bin:/bin:/usr/sbin:/sbin" "$@" /bin/bash "$SCRIPT" "$SB/vault" 2>&1)
  RC=$?
}

marker() { [ -f "$SB/vault/.git/youcloned-backup-private" ]; }

# 1. No address: a private repository is made, the first backup is pushed, the marker is written.
new_sandbox
run_backup YOUCLONED_NO_SCHEDULE=1
check "fresh folder: BACKUP READY" '[ "$RC" = 0 ] && has "BACKUP READY"'
check "fresh folder: the first backup was pushed" '[ "$(calls "^git push")" = 1 ]'
check "fresh folder: marker written" 'marker'
check "fresh folder: no launchd call in a test run" '[ "$(calls "^launchctl")" = 0 ]'
check "fresh folder: env file not committed" '! sbgit ls-files | grep -qx .env'

# 2. Private fetch address, public push address (remote.origin.pushurl): refused.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
sbgit config remote.origin.pushurl https://github.com/tester/pub.git
private tester_priv; public tester_pub
run_backup YOUCLONED_NO_SCHEDULE=1
check "public push address: refused" '[ "$RC" != 0 ] && has "PUBLIC" && ! has "BACKUP READY"'
check "public push address: nothing pushed" '[ "$(calls "^git push")" = 0 ]'
check "public push address: no marker" '! marker'

# 3. Private fetch address, push rewritten to a public one by url.*.pushInsteadOf: refused.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
"$SYS_GIT" config --file "$SB/gitconfig" url.https://github.com/tester/pub.git.pushInsteadOf https://github.com/tester/priv.git
private tester_priv; public tester_pub
run_backup YOUCLONED_NO_SCHEDULE=1
check "pushInsteadOf to a public repository: refused" '[ "$RC" != 0 ] && has "PUBLIC" && [ "$(calls "^git push")" = 0 ]'

# 4. Private fetch address, push address somewhere other than GitHub: refused.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
sbgit config --add remote.origin.pushurl https://github.com/tester/priv.git
sbgit config --add remote.origin.pushurl https://example.com/tester/elsewhere.git
private tester_priv
run_backup YOUCLONED_NO_SCHEDULE=1
check "non-GitHub second push address: refused" '[ "$RC" != 0 ] && has "a GitHub repository" && [ "$(calls "^git push")" = 0 ]'

# 5. A public push address holding a login in it: refused, and the address is never printed.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
sbgit config remote.origin.pushurl "https://tester:madeuplogin4471@github.com/tester/pub.git"
private tester_priv; public tester_pub
run_backup YOUCLONED_NO_SCHEDULE=1
check "address with a login: refused without printing it" '[ "$RC" != 0 ] && ! has "madeuplogin4471"'

# 6. Fetch and push both private: backed up.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
sbgit config remote.origin.pushurl git@github.com:tester/priv2.git
private tester_priv; private tester_priv2
run_backup YOUCLONED_NO_SCHEDULE=1
check "both addresses private: BACKUP READY" '[ "$RC" = 0 ] && has "BACKUP READY" && marker'

# 7. The scheduler fails: not reported ready, no marker (and an older marker is cleared).
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
private tester_priv
touch "$SB/vault/.git/youcloned-backup-private" "$SB/state/launchctl-fails"
run_backup
check "scheduler failure: not reported ready" '[ "$RC" != 0 ] && ! has "BACKUP READY" && has "could not be scheduled"'
check "scheduler failure: no marker, older one cleared" '! marker'
check "scheduler failure: only the stub launchctl was called" '[ "$(calls "^launchctl print")" -ge 1 ]'

# 8. The scheduler works (stub): ready, after launchctl print proved the job is loaded.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
private tester_priv
run_backup
check "scheduler loaded: BACKUP READY and marker" '[ "$RC" = 0 ] && has "BACKUP READY" && marker'
check "scheduler loaded: checked with launchctl print" '[ "$(calls "^launchctl print gui/[0-9]+/ai.bnsn.youcloned.backup")" = 1 ]'

# 9. The first push fails: not ready, no marker.
new_sandbox
sbgit init -q -b main
sbgit remote add origin https://github.com/tester/priv.git
private tester_priv
touch "$SB/state/push-fails"
run_backup YOUCLONED_NO_SCHEDULE=1
check "first push fails: not ready, no marker" '[ "$RC" != 0 ] && ! has "BACKUP READY" && ! marker'

# 10. A file over 50MB stays out of the first backup.
new_sandbox
dd if=/dev/zero of="$SB/vault/recording.mov" bs=1048576 count=0 seek=60 2>/dev/null
run_backup YOUCLONED_NO_SCHEDULE=1
check "large file: excluded from the first backup" '[ "$RC" = 0 ] && grep -qx recording.mov "$SB/vault/.git/info/exclude" && ! sbgit ls-files | grep -qx recording.mov'

# 11. The nightly job: has the Intel tool folder, finds gh there with launchd's bare PATH, and re-checks
#     every push address before each push.
new_sandbox
run_backup YOUCLONED_NO_SCHEDULE=1
JOB="$SB/home/.youcloned/backup-nightly.sh"
OUT=$(cat "$JOB" 2>&1)
check "nightly job: PATH includes ~/.local/bin" 'grep -q "^export PATH=.*\$HOME/.local/bin" "$JOB"'
check "nightly job: PATH includes /opt/homebrew/bin and /usr/local/bin" 'grep -q "^export PATH=.*/opt/homebrew/bin.*/usr/local/bin" "$JOB"'
check "nightly job: passes bash -n" 'bash -n "$JOB"'
mkdir -p "$SB/home/.local/bin" "$SB/gitonly"
mv "$SB/stubs/gh" "$SB/home/.local/bin/gh"
cp "$SB/stubs/git" "$SB/gitonly/git"
printf 'more\n' >>"$SB/vault/note.md"
nightly() {
  OUT=$(env -i HOME="$SB/home" TMPDIR="$SB" GIT_CONFIG_GLOBAL="$SB/gitconfig" GIT_CONFIG_NOSYSTEM=1 \
    PATH="$SB/gitonly:/usr/bin:/bin:/usr/sbin:/sbin" /bin/bash "$JOB" 2>&1)
  RC=$?
}
before=$(calls "^git push")
nightly
check "nightly job: finds gh in ~/.local/bin and backs up" '[ "$RC" = 0 ] && has "backed up" && [ "$(calls "^git push")" = $((before + 1)) ]'
sbgit config remote.origin.pushurl https://github.com/tester/pub.git
public tester_pub
before=$(calls "^git push")
nightly
check "nightly job: public push address added later is refused" '[ "$RC" != 0 ] && has "nothing pushed" && [ "$(calls "^git push")" = "$before" ]'

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ]
