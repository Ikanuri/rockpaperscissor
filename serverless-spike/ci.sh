#!/usr/bin/env bash
# SPIKE (TEMPORARY, branch serverless-spike only) — drives the Telegram Serverless probes from GitHub Actions.
# Reads serverless-spike/spike-request.txt: one action per line, executed in order.
#   status | deploy | probe <name...> | hit <N> | restore
# Secrets never reach the chat: tokens come from GitHub Secrets and webhook URL paths are masked in output.
set -u
cd "$(dirname "$0")"
OWNER=582589514

# `target prod` as a line in spike-request.txt switches this whole run to @GubakeBot's credentials.
# In that mode only read-only actions are allowed (status, inspect, kv export) until cutover is approved.
TARGET=beta
if grep -qE '^target[[:space:]]+prod[[:space:]]*$' spike-request.txt; then
  TARGET=prod
  TGCLOUD_TOKEN="${TGCLOUD_TOKEN_PROD:-}"
  BOT_TOKEN="${BOT_TOKEN_PROD:-}"
  export TGCLOUD_TOKEN BOT_TOKEN
  if [ -z "$TGCLOUD_TOKEN" ] || [ -z "$BOT_TOKEN" ]; then
    echo "TGCLOUD_TOKEN_PROD / BOT_TOKEN_PROD belum ada di GitHub Secrets (atau kosong)."
    exit 1
  fi
fi

if [ -z "${TGCLOUD_TOKEN:-}" ]; then
  echo "TGCLOUD_TOKEN_BETA belum ada di GitHub Secrets (atau kosong) - tidak bisa lanjut."
  exit 1
fi

mkdir -p .tgcloud
if [ ! -d node_modules/@tgcloud/cli ]; then
  npm init -y >/dev/null 2>&1
  npm install --silent @tgcloud/cli@0.2.0 2>&1 | tail -3
fi
TG="npx --no-install tgcloud"

mask() { sed -E 's#(https?://[^/[:space:]]+)/[^[:space:]]*#\1/<path-hidden>#g'; }

run_msg() { # $1 = command text, e.g. "/sl_env"
  $TG run handlers/message "{ quiet: true, from: { id: $OWNER }, chat: { id: $OWNER, type: 'private' }, text: \"$1\" }" \
    --ctx '{ update: { update_id: 1 } }' 2>&1
}

webhook_info() {
  curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | jq '{
    host: ((.result.url // "") | sub("^https?://"; "") | split("/")[0]),
    pending: .result.pending_update_count,
    last_error: .result.last_error_message,
    allowed_updates: .result.allowed_updates }'
}

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  # shellcheck disable=SC2086
  set -- $line
  action="$1"; shift
  [ "$action" = target ] && continue
  echo
  echo "################ ACTION: $line"
  if [ "$TARGET" = prod ]; then
    case "$action:${1:-}" in
      status:*|inspect:*|kv:export) ;;
      *) echo "DITOLAK: mode prod hanya mengizinkan status, inspect, kv export (belum ada persetujuan cutover)."; continue ;;
    esac
  fi
  case "$action" in
    status)
      $TG status 2>&1 | tail -n 25
      $TG webhook 2>&1 | mask
      webhook_info
      ;;
    deploy)
      envname="${1:-beta}"
      echo "---- build (${envname})"
      ( cd .. && node scripts/build-platform.mjs --env "$envname" --out serverless-spike/tgcloud ) 2>&1 | tail -n 20
      echo "---- push"
      $TG push --force 2>&1 | mask | tail -n 40
      echo "---- migrate"
      $TG migrate --safe 2>&1 | tail -n 40
      echo "---- webhook after deploy"
      $TG webhook 2>&1 | mask
      ;;
    cmd)
      echo "---- $*"
      run_msg "$*"
      ;;
    kv)
      sub="${1:-}"; shift || true
      case "$sub" in
        export)
          envname="${1:-beta}"
          if [ "$envname" = "prod" ]; then NS="c8e5c7ebf6264fe9b450f6794d234d8e"; else NS="0475907e01f74cb5bc215856bd1753a6"; fi
          ( cd .. && node scripts/kv-migrate.mjs export --namespace "$NS" --out serverless-spike/kv-export ) 2>&1 ;;
        import) ( cd .. && node scripts/kv-migrate.mjs import --dir serverless-spike/kv-export ) 2>&1 ;;
        verify) ( cd .. && node scripts/kv-migrate.mjs verify --dir serverless-spike/kv-export ) 2>&1 ;;
        wipe) run_msg "/sl_kvwipe CONFIRM" ;;
        *) echo "kv: aksi tidak dikenal: $sub" ;;
      esac
      ;;
    inspect)
      APPID="${TGCLOUD_TOKEN%%:*}"
      curl -s -H "Authorization: Bearer ${TGCLOUD_TOKEN}" "https://cloud.telegram.org/${APPID}/manage/get" | jq '{
        top_keys: keys,
        revision: (.result.revision // .revision),
        modules: (((.result.canonical_modules // .canonical_modules) // {}) | to_entries
          | map({name: .key, type: (.value | type), length: (if (.value | type) == "string" then (.value | length) else null end)})) }'
      ;;
    probe)
      for p in "$@"; do
        case "$p" in
          wait=*) echo "---- wait ${p#wait=}s"; sleep "${p#wait=}"; continue ;;
        esac
        name="${p%%=*}"
        arg=""
        if [ "$p" != "$name" ]; then arg="${p#*=}"; fi
        echo "---- /sl_${name} ${arg}"
        run_msg "/sl_${name} ${arg}"
      done
      ;;
    hit)
      n="${1:-12}"
      run_msg "/sl_reset" >/dev/null
      for i in $(seq 1 "$n"); do
        ( run_msg "/sl_hit" > "hit_$i.out" ) &
        ( run_msg "/sl_claim" > "claim_$i.out" ) &
      done
      wait
      echo "---- /sl_counts"
      run_msg "/sl_counts"
      echo "---- sample single hit"
      head -c 700 hit_1.out
      echo
      ;;
    restore)
      SUB=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/subdomain" \
        -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" | jq -r '.result.subdomain')
      curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
        -d "url=https://rps-bot-beta.${SUB}.workers.dev" \
        -d 'allowed_updates=["inline_query","chosen_inline_result","callback_query","message","pre_checkout_query"]' \
        | jq '{ok, description}'
      webhook_info
      ;;
    *)
      echo "aksi tidak dikenal: $action"
      ;;
  esac
done < spike-request.txt
