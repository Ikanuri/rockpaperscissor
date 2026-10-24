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
      status:*|inspect:*|whoami:*|kv:export|cutover:*) ;;
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
    whoami)
      # Read-only: which bots do the secrets point at? Prints usernames/ids and a same/different verdict, never tokens.
      who() { curl -s "https://api.telegram.org/bot$1/getMe" | jq -c '{ok, id: .result.id, username: .result.username}'; }
      hook() { curl -s "https://api.telegram.org/bot$1/getWebhookInfo" | jq -c '{host: ((.result.url // "") | sub("^https?://"; "") | split("/")[0]), pending: .result.pending_update_count, last_error: .result.last_error_message}'; }
      echo "BOT_TOKEN_PROD:"; who "$BOT_TOKEN_PROD"; hook "$BOT_TOKEN_PROD"
      if [ -n "${BOT_TOKEN_WORKER:-}" ]; then
        echo "BOT_TOKEN (secret yang dipakai deploy.yml):"; who "$BOT_TOKEN_WORKER"; hook "$BOT_TOKEN_WORKER"
        [ "${BOT_TOKEN_PROD%%:*}" = "${BOT_TOKEN_WORKER%%:*}" ] && echo "VERDICT: bot yang sama" || echo "VERDICT: BOT BERBEDA"
      else
        echo "BOT_TOKEN_WORKER kosong"
      fi
      ;;
    cutover)
      # PRODUCTION CUTOVER (prod target only). Order matters: the platform must not receive updates until its
      # database holds the migrated data, so handlers are pushed only AFTER import + verify succeeded.
      [ "$TARGET" = prod ] || { echo "cutover hanya untuk target prod"; continue; }
      # Never re-run over a live database: the import would overwrite everything written since cutover.
      PRE=$(run_msg "/sl_ping" 2>&1 | grep -o 'kv:{n:[0-9]*' | grep -o '[0-9]*$' | tail -n1)
      if [ -n "$PRE" ] && [ "$PRE" != 0 ]; then echo "ABORT: database platform sudah berisi $PRE key - cutover hanya untuk database kosong."; continue; fi
      echo "---- 1/7 build (prod)"
      ( cd .. && node scripts/build-platform.mjs --env prod --out serverless-spike/tgcloud ) 2>&1 | tail -n 3
      echo "---- 2/7 export KV production (read-only)"
      EXP=$( cd .. && node scripts/kv-migrate.mjs export --namespace c8e5c7ebf6264fe9b450f6794d234d8e --out serverless-spike/kv-export 2>&1 ) || { echo "$EXP"; echo "ABORT: export gagal"; continue; }
      echo "$EXP" | head -n 3
      echo "$EXP" | grep -q ' 0 oversize' || { echo "ABORT: ada nilai oversize"; continue; }
      echo "---- 3/7 push schema saja (tanpa handler, belum ada update yang masuk)"
      mv tgcloud/handlers ./handlers_stash
      $TG push --force 2>&1 | mask | tail -n 5
      $TG migrate --safe 2>&1 | tail -n 5
      mv ./handlers_stash tgcloud/handlers
      echo "---- 4/7 import ke database platform"
      ( cd .. && node scripts/kv-migrate.mjs import --dir serverless-spike/kv-export --allow-prod ) 2>&1 | tail -n 5
      echo "---- 5/7 verifikasi"
      VER=$( cd .. && node scripts/kv-migrate.mjs verify --dir serverless-spike/kv-export 2>&1 ); VRC=$?
      echo "$VER" | tail -n 18
      [ "$VRC" = 0 ] && echo "$VER" | grep -q 'VERIFY OK' || { echo "ABORT: verifikasi gagal, handler TIDAK di-deploy, webhook tidak disentuh"; continue; }
      echo "---- 6/7 push handler lengkap + webhook"
      $TG push --force 2>&1 | mask | tail -n 8
      $TG migrate --safe 2>&1 | tail -n 3
      if ! $TG webhook 2>&1 | grep -q 'in sync with your deployed handlers'; then $TG webhook sync 2>&1 | mask | tail -n 8; fi
      $TG webhook 2>&1 | mask
      echo "---- 7/7 smoke test"
      run_msg "/sl_ping"
      run_msg "/sl_kvstats"
      webhook_info
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
