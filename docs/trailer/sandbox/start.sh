#!/bin/bash
# Avvia S3 finto (:9100), Gemini finto (:9200) e la copia dell'app (:3100). Ogni avvio parte da dati vuoti.
S="$(cd "$(dirname "$0")" && pwd)"
W="${TRAILER_WORK:-$S/work}"
export TRAILER_WORK="$W"
echo 0 > "$W/clock.txt"
trap 'kill 0' EXIT
node "$S/mocks/s3.mjs" > "$W/logs-s3.txt" 2>&1 &
node "$S/mocks/gemini.mjs" > "$W/logs-gemini.txt" 2>&1 &
cd "$W/app"
env -u UPSTASH_REDIS_REST_URL -u UPSTASH_REDIS_REST_TOKEN -u KV_REST_API_URL -u KV_REST_API_TOKEN -u GITHUB_CLIENT_ID -u GITHUB_CLIENT_SECRET \
  TRAILER_CLOCK_FILE="$W/clock.txt" NODE_OPTIONS="--import $S/mocks/preload.mjs" \
  ./node_modules/.bin/next dev -p 3100 > "$W/logs-next.txt" 2>&1 &
wait
