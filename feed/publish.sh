#!/bin/zsh
# Publishes the YouCloned promo feed (the "New from Jon" card) to cdn.bnsn.ai. No add-on release needed:
# every YouCloned picks it up within 30 minutes, and keeps a copy for offline use.
#
#   1. Edit feed.json (first item with a title and a job is the one shown).
#   2. Put its thumbnail in thumbs/<id>.jpg: 360 pixels wide, under 17 KB, and point "thumb" at
#      https://cdn.bnsn.ai/pdfs/youcloned/feed/<id>.jpg
#   3. Run: ~/youcloned/feed/publish.sh
set -euo pipefail
HERE=${0:A:h}
VAULT="/Users/jonbenson/Documents/Obsidian Vault"
export PATH=$HOME/.nvm/versions/node/v24.14.1/bin:$PATH
python3 -c "import json,sys; f=json.load(open('$HERE/feed.json')); assert f['items'] and f['items'][0]['title'] and f['items'][0]['job']" \
  || { echo "feed.json is not valid: it needs items with a title and a job"; exit 1; }
set -a; . "$VAULT/.env" >/dev/null 2>&1; set +a   # Cloudflare key lives in the vault's git-ignored .env
export CLOUDFLARE_EMAIL=${CLOUDFLARE_EMAIL:-jb@jonbenson.com} CLOUDFLARE_API_KEY=${CLOUDFLARE_GLOBAL_API_KEY:-${CLOUDFLARE_API_KEY:-}}
cd "$VAULT/.youcloned-cdn-stage"
for t in "$HERE"/thumbs/*.jpg; do
  [ "$(stat -f %z "$t")" -le 17500 ] || { echo "$t is over 17 KB; the panel would leave it out"; exit 1; }
  npx -y wrangler@latest r2 object put "bnsn-pdfs/pdfs/youcloned/feed/${t:t}" --file="$t" --content-type=image/jpeg --remote >/dev/null
done
npx -y wrangler@latest r2 object put "bnsn-pdfs/pdfs/youcloned/feed.json" --file="$HERE/feed.json" --content-type=application/json --cache-control="no-cache, max-age=0" --remote >/dev/null
curl -s -o /dev/null -w "feed.json on the CDN: %{http_code}\n" "https://cdn.bnsn.ai/pdfs/youcloned/feed.json?$(date +%s)"
