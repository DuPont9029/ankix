# Trailer dall'app vera

Il trailer è girato sull'app vera, avviata in un ambiente isolato. Nessuna richiesta arriva a servizi reali.

- **Storage:** S3 finto in memoria (`mocks/s3.mjs`). Al riavvio è vuoto.
- **AI:** API Gemini finta con risposte preparate (`mocks/gemini.mjs`).
- **Login Google:** lo scambio del codice OAuth è simulato sul server (`mocks/preload.mjs`). Il browser non apre pagine di Google.
- **Sicurezza:** il preload blocca qualunque chiamata ai veri provider AI e a Upstash. La copia dell'app ha un `.env.local` con soli valori finti.
- **Storico dei ripassi:** viene seminato spostando l'orologio del server di prova, cioè `Date.now` tramite `work/clock.txt`.

## Come rifarlo

Servono macOS (`say`, cloni APFS), `ffmpeg`, `rsvg-convert` e il Chromium di Playwright.

```bash
cd docs/trailer/sandbox
npm i --no-save playwright-core
./setup.sh                      # copia l'app in work/app e genera i materiali di prova
./start.sh &                    # S3 :9100, Gemini :9200, app :3100
node record/record.mjs          # registra le scene in work/clips (le attese vengono marcate per il taglio)
python3 build_timeline.py       # taglia le attese e adatta ogni scena alle battute → work/timeline.js
node ../music.mjs compose.html work/music.wav
node record/render.mjs "$PWD/compose.html" work/video.mp4 30
ffmpeg -i work/video.mp4 -i work/music.wav -filter_complex "[1:a]aecho=0.8:0.6:70|140:0.22|0.12,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart ../ankix-trailer.mp4
```

`compose.html` si può anche aprire nel browser per vedere il montaggio dal vivo: spazio mette in pausa, le frecce saltano di 5 secondi. Per rifare una sola scena: `node record/record.mjs exam`. Prima riavvia `start.sh`, se la scena dipende da dati che esistono già.
