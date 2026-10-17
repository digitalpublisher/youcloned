#!/usr/bin/env bash
# Runs the library end to end on a local Supabase (Docker + the Supabase CLI), then feed.py's checks.
# Usage: bash run-local.sh SCRATCH_DIR
# When Docker isn't up and colima is installed, it starts colima and stops it again at the end.
# The transcribe check uses the local transcriber on 127.0.0.1:2022 (YOUCLONED_WHISPER_URL to change it).
# SCRATCH_DIR is an empty working folder outside any git repository. Nothing in it is kept.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
lib="$(cd "$here/.." && pwd)"
scratch="${1:?give a scratch folder}"
mkdir -p "$scratch"
scratch="$(cd "$scratch" && pwd)"
project="$scratch/yc-library-test"
log="$scratch/functions-serve.log"
envfile="$scratch/test.env"

started_colima=""
if ! docker info >/dev/null 2>&1; then
  if command -v colima >/dev/null 2>&1; then
    echo "== colima start (Docker was not running)"
    colima start >/dev/null 2>&1 && started_colima=1
  fi
  docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }
fi

rm -rf "$project"
mkdir -p "$project"
cd "$project"
supabase init >/dev/null
pid="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml)"
db="supabase_db_$pid"

mkdir -p supabase/migrations supabase/functions/library
cp "$lib/schema.sql" supabase/migrations/20261017000000_youcloned_library.sql
cp "$lib/functions/library/index.ts" supabase/functions/library/index.ts
printf '\n[functions.library]\nverify_jwt = false\n' >> supabase/config.toml

cleanup() {
  [ -n "${serve_pid:-}" ] && kill "$serve_pid" 2>/dev/null || true
  supabase stop --no-backup >/dev/null 2>&1 || true
  if [ -n "$started_colima" ]; then echo "== colima stop"; colima stop >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

echo "== supabase start (applies schema.sql as a migration)"
supabase start -x imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector >/dev/null

echo "== apply schema.sql a second time (must be safe to re-run)"
docker exec -i "$db" psql -U postgres -v ON_ERROR_STOP=1 -q < "$lib/schema.sql" && echo "PASS schema re-run"

echo "== public API roles cannot read the library"
anon_check="$(docker exec -i "$db" psql -U postgres -At -c "set role anon; select count(*) from youcloned.settings;" 2>&1 || true)"
case "$anon_check" in *"permission denied"*) echo "PASS anon is refused";; *) echo "FAIL anon was not refused: $anon_check";; esac
rls="$(docker exec -i "$db" psql -U postgres -At -c "select count(*) from pg_tables where schemaname='youcloned' and rowsecurity;")"
[ "$rls" = "4" ] && echo "PASS row level security on all 4 tables" || echo "FAIL row level security on $rls tables"

echo "== functions serve"
supabase functions serve --no-verify-jwt >"$log" 2>&1 &
serve_pid=$!
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:54321/functions/v1/library || true)"
  [ "$code" = "401" ] && break
  sleep 2
done

echo "== token"
rm -f "$envfile"
hash="$(python3 "$lib/make-token.py" "$envfile" --project-url http://127.0.0.1:54321)"
hash_again="$(python3 "$lib/make-token.py" "$envfile" --project-url http://127.0.0.1:54321)"
[ "$hash" = "$hash_again" ] && echo "PASS make-token keeps the saved token on a re-run" || echo "FAIL make-token changed the token"
[ "$(stat -f %Lp "$envfile" 2>/dev/null || stat -c %a "$envfile")" = "600" ] && echo "PASS env file mode 600" || echo "FAIL env file mode"
docker exec -i "$db" psql -U postgres -v ON_ERROR_STOP=1 -q -c \
  "insert into youcloned.settings (k, v) values ('token_sha256', '$hash') on conflict (k) do update set v = excluded.v;"

echo "== smoke test"
python3 "$lib/smoke-test.py" "$envfile" || true

echo "== end to end"
status=0
python3 "$here/e2e.py" "$envfile" --db-container "$db" || status=$?

echo "== feed.py"
rm -rf "$scratch/feed" "$scratch/Library"
python3 "$here/feed-e2e.py" "$envfile" "$scratch/feed" --whisper "${YOUCLONED_WHISPER_URL:-http://127.0.0.1:2022}" || status=$?
if [ "$status" != "0" ]; then echo "-- functions serve log (last 40 lines)"; tail -40 "$log"; fi
exit "$status"
