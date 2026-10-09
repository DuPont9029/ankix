#!/bin/bash
# Prepara la cartella di lavoro: copia dell'app senza segreti, .env.local finto e asset di prova.
set -euo pipefail
S="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$S/../../.." && pwd)"
W="${TRAILER_WORK:-$S/work}"
mkdir -p "$W/assets" "$W/app/data"

# Copia dell'app: niente .env, niente dati locali. node_modules clonati copy-on-write su APFS.
rsync -a --delete --exclude node_modules --exclude .next --exclude .git --exclude docs --exclude '.env*' --exclude env --exclude data "$REPO/" "$W/app/"
mkdir -p "$W/app/data"
[ -e "$W/app/node_modules" ] || cp -cR "$REPO/node_modules" "$W/app/node_modules" 2>/dev/null || cp -R "$REPO/node_modules" "$W/app/node_modules"

cat > "$W/app/.env.local" <<EOF
# Sandbox del trailer: solo servizi finti in locale, nessuna credenziale reale.
BETTER_AUTH_URL=http://localhost:3100
BETTER_AUTH_SECRET=trailer-sandbox-secret-0123456789abcdef0123456789
GOOGLE_CLIENT_ID=trailer-sandbox.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=trailer-sandbox
ALLOWED_EMAIL_DOMAINS=students.example.edu
CLASS_TOTP_SECRET=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
NEXT_PUBLIC_CLASS_NAME=Medicine and Surgery
GEMINI_MODEL=gemini-3.6-flash
GEMINI_BASE_URL=http://127.0.0.1:9200
AWS_S3_ENDPOINT=http://127.0.0.1:9100
AWS_REGION=us-east-1
AWS_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=trailer
AWS_SECRET_ACCESS_KEY=trailer-secret
S3_BUCKET=trailer
S3_PREFIX=ankix
MAX_UPLOAD_MB=50
EOF

# Materiali di prova: tavola del nefrone (con le coordinate delle etichette), slide in PDF, riassunto, risposta parlata.
python3 "$S/assets/gen_plate.py" "$W/assets"
rsvg-convert -w 1200 "$W/assets/nephron.svg" -o "$W/assets/Nephron_plate.png"
node "$S/assets/mkpdf.mjs" "$S/assets/slides.html" "$W/assets/Renal_physiology_lecture7.pdf"
cp "$S/assets/ADH_summary.md" "$W/assets/"
say -v Daniel -o "$W/assets/answer.aiff" "So, urine concentration depends on the loop of Henle, which builds an osmotic gradient in the medulla through countercurrent multiplication. The descending limb is permeable to water, while the thick ascending limb is not, and pumps out sodium and chloride. Then antidiuretic hormone acts on the collecting duct and inserts aquaporin two channels, so water is reabsorbed and the urine becomes more concentrated."
ffmpeg -hide_banner -loglevel error -y -i "$W/assets/answer.aiff" -ar 48000 -ac 1 -c:a pcm_s16le "$W/assets/answer.wav"
echo "pronto: $W"
