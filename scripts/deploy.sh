#!/usr/bin/env bash
# End-to-end Cloudflare deployment for the USAFA schedule builder.
#
# Reads credentials from cloudflare.txt (gitignored) in the repo root:
#   account_id: <32-hex account id>
#   api_token:  <account-owned API token, full cfat_... string>
# (api_token_2 is preferred over api_token when present.)
#
# Token needs: Account > Cloudflare Pages: Edit, Account > Turnstile: Edit,
#              Zone > DNS: Edit and Zone > Zone: Read for the custom domain's zone.
#
# Idempotent: safe to re-run; existing widget/project/domain/DNS are reused.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_NAME="usafa-academic-calendar"
CUSTOM_DOMAIN="${CUSTOM_DOMAIN:-usafa-calendar.benslab.dev}"
API="https://api.cloudflare.com/client/v4"

ACCOUNT_ID=$(awk '/^account_id:/{print $2}' cloudflare.txt)
# api_token_2 carries Pages+Turnstile permissions; api_token carries Zone DNS.
API_TOKEN=$(awk '/^api_token_2:/{print $2}' cloudflare.txt)
[ -n "$API_TOKEN" ] || API_TOKEN=$(awk '/^api_token:/{print $2}' cloudflare.txt)
DNS_TOKEN=$(awk '/^api_token:/{print $2}' cloudflare.txt)
[ -n "$DNS_TOKEN" ] || DNS_TOKEN=$API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" CLOUDFLARE_API_TOKEN="$API_TOKEN"

cf() { # method path [json-body]
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $API_TOKEN" \
      -H "Content-Type: application/json" -d "$body" "$API$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $API_TOKEN" "$API$path"
  fi
}

cfdns() { # method path [json-body] — DNS ops use the token that has Zone DNS: Edit
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: Bearer $DNS_TOKEN" \
      -H "Content-Type: application/json" -d "$body" "$API$path"
  else
    curl -sS -X "$method" -H "Authorization: Bearer $DNS_TOKEN" "$API$path"
  fi
}

fail() { echo "ERROR: $*" >&2; exit 1; }

echo "==> Verifying API token"
cf GET "/accounts/$ACCOUNT_ID/tokens/verify" | jq -e '.success' >/dev/null \
  || fail "API token is invalid (cloudflare.txt)"

echo "==> Turnstile widget for $CUSTOM_DOMAIN"
WIDGETS=$(cf GET "/accounts/$ACCOUNT_ID/challenges/widgets")
SITEKEY=$(echo "$WIDGETS" | jq -r --arg d "$CUSTOM_DOMAIN" \
  '.result[]? | select(.domains | index($d)) | .sitekey' | head -1)
if [ -z "$SITEKEY" ]; then
  CREATED=$(cf POST "/accounts/$ACCOUNT_ID/challenges/widgets" "$(jq -n \
    --arg d "$CUSTOM_DOMAIN" --arg n "$PROJECT_NAME" \
    '{name: $n, domains: [$d, ($n + ".pages.dev")], mode: "managed"}')")
  echo "$CREATED" | jq -e '.success' >/dev/null \
    || fail "Turnstile widget creation failed: $(echo "$CREATED" | jq -c .errors)"
  SITEKEY=$(echo "$CREATED" | jq -r '.result.sitekey')
fi
SECRET=$(cf GET "/accounts/$ACCOUNT_ID/challenges/widgets/$SITEKEY" | jq -r '.result.secret')
[ -n "$SECRET" ] && [ "$SECRET" != "null" ] || fail "could not read Turnstile secret"
echo "    sitekey: $SITEKEY"

echo "==> Pages project $PROJECT_NAME"
if ! cf GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME" | jq -e '.success' >/dev/null; then
  npx wrangler pages project create "$PROJECT_NAME" --production-branch main
fi

echo "==> Setting TURNSTILE_SECRET_KEY secret"
printf '%s' "$SECRET" | npx wrangler pages secret put TURNSTILE_SECRET_KEY \
  --project-name "$PROJECT_NAME"

echo "==> Building with real Turnstile sitekey"
VITE_TURNSTILE_SITE_KEY="$SITEKEY" npm run build

echo "==> Deploying dist/ (+ functions/) to Cloudflare Pages"
npx wrangler pages deploy dist --project-name "$PROJECT_NAME" --branch main

echo "==> Custom domain $CUSTOM_DOMAIN"
DOMAINS=$(cf GET "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/domains")
if ! echo "$DOMAINS" | jq -e --arg d "$CUSTOM_DOMAIN" '.result[]? | select(.name == $d)' >/dev/null; then
  ADDED=$(cf POST "/accounts/$ACCOUNT_ID/pages/projects/$PROJECT_NAME/domains" \
    "$(jq -n --arg d "$CUSTOM_DOMAIN" '{name: $d}')")
  echo "$ADDED" | jq -e '.success' >/dev/null \
    || fail "adding custom domain failed: $(echo "$ADDED" | jq -c .errors)"
fi

ZONE_NAME=$(echo "$CUSTOM_DOMAIN" | awk -F. '{print $(NF-1)"."$NF}')
ZONE_ID=$(cf GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || ZONE_ID=$(cfdns GET "/zones?name=$ZONE_NAME" | jq -r '.result[0].id // empty')
[ -n "$ZONE_ID" ] || fail "zone $ZONE_NAME not found in this account — is the domain on Cloudflare?"
RECORD=$(cfdns GET "/zones/$ZONE_ID/dns_records?name=$CUSTOM_DOMAIN" | jq -c '.result[0] // empty')
TARGET="$PROJECT_NAME.pages.dev"
if [ -z "$RECORD" ]; then
  echo "    creating CNAME $CUSTOM_DOMAIN -> $TARGET"
  CREATED_DNS=$(cfdns POST "/zones/$ZONE_ID/dns_records" "$(jq -n --arg n "$CUSTOM_DOMAIN" --arg t "$TARGET" \
    '{type: "CNAME", name: $n, content: $t, proxied: true}')")
  echo "$CREATED_DNS" | jq -e '.success' >/dev/null \
    || fail "DNS record creation failed: $(echo "$CREATED_DNS" | jq -c .errors)"
elif [ "$(echo "$RECORD" | jq -r '.content')" != "$TARGET" ]; then
  echo "    NOTE: $CUSTOM_DOMAIN already has a $(echo "$RECORD" | jq -r '.type') record" \
       "pointing at $(echo "$RECORD" | jq -r '.content') — not touching it." \
       "Point it at $TARGET to serve the app."
fi

# The edge can cache the SPA-fallback response for a brand-new asset URL hit
# during the propagation window — even a purge can be re-poisoned by a request
# landing before propagation finishes (seen live twice). So: purge, then poll
# an asset until the edge provably serves this deploy's bytes, re-purging on
# each mismatch.
echo "==> Purging edge cache and verifying the edge serves this deploy"
PURGE_FILES=$(ls dist/assets | jq -R -s --arg d "$CUSTOM_DOMAIN" \
  '{files: ((split("\n") | map(select(length > 0) | "https://\($d)/assets/\(.)")) + ["https://\($d)/"])}')
CHECK_ASSET=$(ls dist/assets | head -1)
WANT=$(wc -c < "dist/assets/$CHECK_ASSET")
GOT=""
for attempt in 1 2 3 4 5 6; do
  cfdns POST "/zones/$ZONE_ID/purge_cache" "$PURGE_FILES" | jq -e '.success' >/dev/null \
    || echo "    (purge request failed on attempt $attempt)"
  sleep 5
  GOT=$(curl -s -o /dev/null -w '%{size_download}' "https://$CUSTOM_DOMAIN/assets/$CHECK_ASSET")
  if [ "$GOT" = "$WANT" ]; then
    echo "    edge OK: $CHECK_ASSET served $GOT bytes"
    break
  fi
  echo "    attempt $attempt: edge served $GOT bytes (want $WANT) — purging again"
done
[ "$GOT" = "$WANT" ] || echo "    WARNING: edge still stale after 6 attempts — check manually"

echo
echo "Done. App: https://$CUSTOM_DOMAIN  (also https://$TARGET)"
