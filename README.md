# Ankix

Sito per una classe di Medicina che trasforma i materiali del corso (PDF, immagini, appunti) in **flashcard Anki** con l'intelligenza artificiale: di default un **modello locale** (Gemma 4 E4B via LiteRT-LM, eseguito nel browser su WebGPU), in alternativa **Gemini, Claude, OpenAI o OpenRouter** con la chiave dello studente.

- **Materiali condivisi**: gli studenti caricano i file su un bucket **S3 con endpoint personalizzato** (MinIO, Cloudflare R2, Wasabi, Ceph, Garage…).
- **Accesso con Google (o GitHub)** tramite [Better Auth](https://www.better-auth.com), con restrizione facoltativa ai domini email e codice di accesso TOTP (da qualsiasi app authenticator) al primo accesso.
- **Mazzi privati di default**: ogni mazzo è visibile solo a chi l'ha creato finché non lo rende pubblico; gli altri possono studiarlo, esportarlo o salvarne una copia privata.
- **AI locale di default**: Gemma 4 E4B gira nel browser dello studente (WebGPU, Chrome/Edge recenti): gratis, senza chiavi, e i materiali non vengono inviati a nessun provider AI. Il modello (~3 GB) si scarica una volta e resta nella cache del browser (OPFS).
- **Provider cloud facoltativi**: in *Impostazioni* ogni studente può inserire la propria chiave **Gemini**, **Claude** (Anthropic), **OpenAI** o **OpenRouter** (con modello personalizzabile), sceglierne uno come predefinito e cambiare motore a ogni generazione; le generazioni cloud consumano la sua quota.
- **Generazione AI**: l'AI legge i materiali e crea card *domanda/risposta* e *cloze* pensate per gli esami di Medicina, con livello, numero di card, lingua e istruzioni personalizzabili.
- **Image occlusion**: dalle immagini (tavole anatomiche, vetrini, schemi) l'AI individua etichette (con il modello locale: OCR delle etichette con Tesseract e scelta di quelle da coprire) e strutture e crea card con maschere; si possono correggere e disegnare a mano. L'export usa il note type *Image Occlusion* di Anki (serve Anki 23.10+ / AnkiMobile / AnkiDroid aggiornati) con le immagini incluse nel pacchetto.
- **Revisione**: si possono modificare, aggiungere ed eliminare card, generarne altre senza duplicati e fare un ripasso direttamente nel browser.
- **Export**: pacchetto `.apkg` pronto da importare in Anki (mazzo `Medicina::<Materia>::<Titolo>`, tag per argomento), oppure CSV.
- **Database sul bucket S3** (come nel progetto mailsender): tabelle Parquet in `<S3_PREFIX>/db/` lette con DuckDB, con lock distribuito per funzionare su più istanze Vercel in parallelo.

Stack: Next.js 16 (App Router) · Bun · Tailwind CSS 4 · Better Auth · DuckDB-WASM · AWS SDK v3 · LiteRT-LM (`@litert-lm/core`, da CDN) · `@google/genai` · `@anthropic-ai/sdk` · `openai`.
Design: sistema "Clinical Academic Notebook" dal progetto Google Stitch *Ankix Medical Redesign* (Newsreader + Plus Jakarta Sans, verde petrolio `#0f5b5c`, modalità chiara e scura automatiche).

## Avvio rapido

```bash
bun install
cp .env.example .env.local   # poi compila i valori
bun dev                      # http://localhost:3000
```

Produzione:

```bash
bun run build
bun run start
```

## Configurazione (`.env.local`)

| Variabile | Descrizione |
|---|---|
| `BETTER_AUTH_URL` | URL pubblico del sito: già impostato in `.env.development` (`http://localhost:3000`) e `.env.production` (da aggiornare con il dominio reale). Non metterlo in `.env.local`, che ha la precedenza su entrambi |
| `BETTER_AUTH_SECRET` | Segreto ≥ 32 caratteri (`openssl rand -base64 32`): firma la sessione e cifra le chiavi AI degli studenti. Se lo cambi, tutti devono rifare l'accesso e reinserire le chiavi |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Login con Google (vedi sotto) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | Facoltativo: login con GitHub |
| `ALLOWED_EMAIL_DOMAINS` | Facoltativo: domini ammessi, es. `studenti.unimi.it,unimi.it`. Vuoto = qualsiasi account |
| `CLASS_TOTP_SECRET` | Facoltativo: segreto **TOTP** (base32) della classe. Se impostato, al primo login ogni studente deve inserire il codice a 6 cifre che l'admin legge dalla sua app authenticator |
| `ADMIN_EMAILS` | Email degli amministratori: nella pagina *Codice di accesso* vedono il codice attuale e il QR da aggiungere all'app authenticator |
| `NEXT_PUBLIC_CLASS_NAME` | Nome del corso mostrato nell'interfaccia |
| `GEMINI_MODEL` | Modello Gemini predefinito (default `gemini-3.6-flash`) |
| `ANTHROPIC_MODEL` | Modello Claude predefinito (default `claude-opus-5-5`) |
| `OPENAI_MODEL` | Modello OpenAI predefinito (default `gpt-5`) |
| `OPENROUTER_MODEL` | Modello OpenRouter predefinito (default `openrouter/auto`) |
| `GEMINI_BASE_URL` | Facoltativo: endpoint alternativo/proxy per l'API Gemini |
| `AWS_S3_ENDPOINT` | Endpoint S3 personalizzato, es. `https://s3.cubbit.eu` |
| `AWS_REGION` | Regione del bucket |
| `AWS_S3_FORCE_PATH_STYLE` | `true` per la maggior parte degli S3-compatibili |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credenziali del bucket |
| `S3_BUCKET` / `S3_PREFIX` | Bucket e prefisso delle chiavi (`<prefisso>/materials/<id>/<file>`) |
| `MAX_UPLOAD_MB` | Dimensione massima per file (default 50) |

### Login con Google

1. Vai su [Google Cloud Console → Credenziali](https://console.cloud.google.com/apis/credentials) e crea un **ID client OAuth** di tipo *Applicazione web* (se richiesto, configura prima la schermata di consenso OAuth come "Esterno").
2. In **Origini JavaScript autorizzate** aggiungi `http://localhost:3000` e il dominio di produzione (es. `https://ankix.miodominio.it`).
3. In **URI di reindirizzamento autorizzati** aggiungi `<BETTER_AUTH_URL>/api/auth/callback/google`, ad esempio `http://localhost:3000/api/auth/callback/google` e quello di produzione.
4. Copia ID client e segreto in `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

GitHub è analogo (*Settings → Developer settings → OAuth Apps*, callback `<BETTER_AUTH_URL>/api/auth/callback/github`). Nella pagina di accesso compaiono solo i provider configurati.

### CORS del bucket (consigliato)

I file vengono caricati **direttamente dal browser al bucket** tramite URL prefirmati: così non passano dal server e non ci sono limiti di dimensione lato Next.js. Perché funzioni, il bucket deve consentire richieste `PUT` dall'origine del sito:

```json
[
  {
    "AllowedOrigins": ["https://ankix.miodominio.it", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

MinIO non usa il CORS per-bucket: di default accetta tutte le origini, e si può restringere con la variabile del server `MINIO_API_CORS_ALLOW_ORIGIN`. Per gli altri provider, con AWS CLI:
`aws s3api put-bucket-cors --endpoint-url $AWS_S3_ENDPOINT --bucket $S3_BUCKET --cors-configuration file://cors.json`
(il file deve avere la forma `{"CORSRules": [ ... ]}`).

Se il CORS non è configurato l'app **ripiega automaticamente** sul caricamento tramite server (`/api/materials/upload`), quindi funziona comunque; è solo meno efficiente per file grandi.

> L'SDK AWS è configurato con `requestChecksumCalculation: "WHEN_REQUIRED"`: le versioni recenti aggiungono di default checksum CRC32 che molti provider S3-compatibili rifiutano.

## Come funziona

1. **Accesso**: login OAuth con Better Auth in modalità *stateless* (sessione in un cookie cifrato JWE, nessun database per l'autenticazione). Al primo accesso l'utente viene registrato in DuckDB tramite l'email; se `CLASS_TOTP_SECRET` è impostato deve inserire, una volta sola, il codice **TOTP** della classe (RFC 6238: SHA-1, 6 cifre, 30 secondi, accettato con ±1 passo, cioè circa 60 secondi da quando compare). L'admin aggiunge il QR a qualsiasi app authenticator (Google/Microsoft Authenticator, Authy, 1Password…) e detta il codice a chi deve entrare. Ogni account ha al massimo 10 tentativi ogni 10 minuti; gli admin non devono inserirlo. Per revocare il QR basta cambiare il segreto. Il `proxy.ts` fa un controllo rapido del cookie, mentre pagine e API verificano davvero sessione, dominio e codice.
   **Privacy dei mazzi**: un mazzo nasce privato. Un mazzo privato di un altro utente risponde "non trovato" ovunque (pagina, API, export, ripasso, titolo della scheda). Solo il proprietario può modificarlo, generare altre card, renderlo pubblico/privato o eliminarlo; sui mazzi pubblici gli altri possono solo leggere, studiare, esportare e **salvare una copia** (che diventa un loro mazzo privato). I materiali restano una libreria condivisa dalla classe.
2. **Motore AI**: di default il **modello locale** (nessuna configurazione). Facoltativamente lo studente incolla in *Impostazioni* una chiave Gemini ([Google AI Studio](https://aistudio.google.com/apikey)), Claude ([Claude Console](https://platform.claude.com/settings/keys)), OpenAI o OpenRouter, e può indicare un modello diverso da quello predefinito. Il server verifica la chiave con il provider e salva chiavi, modelli e motore predefinito in un cookie `httpOnly` cifrato (AES-256-GCM, chiave derivata da `BETTER_AUTH_SECRET`) e legato all'utente: gli script della pagina non possono leggerlo e non finisce nel database. Le chiavi sono usate solo durante le generazioni avviate da quello studente e si cancellano all'uscita dall'account. Una chiave Gemini salvata con la versione precedente viene migrata automaticamente.
3. **Materiali**: formati accettati PDF, PNG, JPG, WEBP, HEIC/HEIF, TXT, MD. Ognuno ha titolo e materia; tutti vedono i materiali della classe, solo chi li ha caricati può eliminarli.
4. **Generazione con il modello locale**: tutto avviene nella scheda del browser (va lasciata aperta). I materiali vengono scaricati dal bucket (URL prefirmato, oppure tramite `/api/materials/[id]/content` se il CORS non lo consente), il testo estratto (pdf.js per i PDF, OCR Tesseract per le immagini) e diviso in blocchi da 8.000 caratteri, ognuno elaborato in una conversazione nuova (contesto di 8.192 token). Con molto materiale si leggono blocchi distribuiti su tutti i file, circa uno ogni 3 card richieste. Il modello scrive le card in un formato a righe (`Q:`/`A:`/`C:`) più robusto del JSON per un modello piccolo; si può interrompere tenendo le card già scritte. Le card finite vengono inviate al server, che le ripulisce come quelle dei provider cloud (sanificazione, cloze, duplicati).
   **Generazione con un provider cloud**: la richiesta crea subito il mazzo in stato *in generazione* e il lavoro prosegue in background (`after()`), quindi si può anche chiudere la pagina. PDF e immagini vengono passati al modello (con Gemini i file oltre 8 MB passano dalla Files API e vengono eliminati a fine generazione). L'output è JSON strutturato (structured output di ciascun provider), validato e ripulito:
   - HTML sanificato con whitelist (niente script/attributi),
   - cloze senza `{{c1::…}}` scartate o convertite,
   - duplicati rimossi (anche rispetto alle card già presenti quando si usa *Genera altre*),
   - tag normalizzati per Anki.
   Errori di quota (429) o temporanei vengono ritentati automaticamente, poi mostrati con un messaggio chiaro e il pulsante *Riprova*.
5. **Export `.apkg`**: note type dedicati *Ankix Base* (Fronte/Retro/Extra) e *Ankix Cloze* (Testo/Extra), con stile chiaro/scuro. I GUID sono stabili: reimportando un mazzo aggiornato Anki non crea duplicati.

## Database su S3

Il database sta sul bucket, come nel progetto mailsender: ogni tabella è un file Parquet letto con DuckDB.
È progettato per più istanze serverless in parallelo (Vercel):

```
<S3_PREFIX>/db/manifest.json                    versione corrente: quale file contiene ogni tabella
<S3_PREFIX>/db/data/<tabella>-<versione>-<id>.parquet   file immutabili (users, materials, decks, cards)
<S3_PREFIX>/db/lock.json                        lock di scrittura (solo se non usi Redis)
<S3_PREFIX>/materials/<id>/<file>               materiali caricati
```

- **Letture**: ogni istanza tiene una copia in un DuckDB in memoria; prima di leggere controlla il manifest (al massimo ogni 200 ms) e ricarica solo le tabelle cambiate. Se un elemento cercato non c'è (es. appena creato su un'altra istanza) rilegge subito il bucket.
- **Scritture**: lock distribuito → rilettura del manifest → transazione → upload dei nuovi Parquet → nuovo manifest → commit. Le scritture sono serializzate fra **tutte** le istanze: nessuna può sovrascriverne un'altra. Se qualcosa fallisce si fa rollback e resta la versione precedente, sempre coerente fra le tabelle.
- **Lock**:
  - con `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_URL` / `KV_REST_API_TOKEN` dell'integrazione Vercel) usa Redis: atomico e veloce (**consigliato su Vercel**);
  - altrimenti usa un *lease* su S3 (`db/lock.json`). Serve perché molti provider S3-compatibili, Cubbit compreso, **ignorano le scritture condizionali** (`If-Match` / `If-None-Match`). Funziona senza servizi esterni, ma ogni scrittura richiede circa 1–2 secondi.
- I file sostituiti vengono cancellati dopo 10 minuti, così un'istanza che sta leggendo la versione precedente non trova file mancanti.
- I Parquet **non vengono mai mandati al browser**: contengono i mazzi privati di tutti, quindi li legge solo il server.
- Migrazione automatica: al primo avvio senza manifest vengono importati i Parquet della versione precedente (`<S3_PREFIX>/db/<tabella>.parquet`).
- Backup: copia la cartella `<S3_PREFIX>/db/` o attiva il versioning del bucket.

## Deploy su Vercel

1. Importa il repository su Vercel (rileva Next.js e `bun.lock`).
2. In *Settings → Environment Variables* imposta tutte le variabili del `.env.local` (i file `.env*` non vengono caricati su git), in particolare:
   - `BETTER_AUTH_URL` = l'URL di produzione (es. `https://ankix.vercel.app`) e `BETTER_AUTH_SECRET`;
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` e, su Google Cloud, l'origine `https://<dominio>` e il redirect `https://<dominio>/api/auth/callback/google`;
   - le variabili S3 (`AWS_S3_ENDPOINT`, `AWS_REGION`, `AWS_S3_FORCE_PATH_STYLE`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PREFIX`), facoltativamente `GEMINI_MODEL` / `ANTHROPIC_MODEL` / `OPENAI_MODEL` / `OPENROUTER_MODEL`, `NEXT_PUBLIC_CLASS_NAME`, `ADMIN_EMAILS`, `CLASS_TOTP_SECRET`.
3. Consigliato: aggiungi **Upstash Redis** dal Marketplace di Vercel (piano gratuito) e collegalo al progetto; le variabili `KV_REST_API_URL` / `KV_REST_API_TOKEN` vengono riconosciute automaticamente.
4. Durata delle funzioni: la generazione delle flashcard gira in background fino a 300 s (`maxDuration`); su Vercel serve Fluid compute (attivo di default) per questo limite.
5. DuckDB gira come **DuckDB-WASM** (nessun binario nativo): i file `.wasm` di DuckDB e di sql.js (export Anki) sono inclusi nelle funzioni tramite `outputFileTracingIncludes` in `next.config.ts`.
6. L'estensione **parquet** di DuckDB-WASM non è inclusa nel `.wasm` e normalmente verrebbe scaricata e salvata in `~/.duckdb` (di sola lettura su Vercel). Per questo l'estensione ufficiale è inclusa nel repository in `vendor/duckdb-extensions/<versione>/<piattaforma>/` e caricata da lì all'avvio, senza rete. Se aggiorni `@duckdb/duckdb-wasm`, scarica i file della nuova versione di DuckDB:
   `curl -o vendor/duckdb-extensions/<v>/wasm_eh/parquet.duckdb_extension.wasm https://extensions.duckdb.org/<v>/wasm_eh/parquet.duckdb_extension.wasm` (e lo stesso per `wasm_mvp`).

Note:
- Il caricamento dei materiali avviene direttamente dal browser al bucket (URL prefirmati): il limite di 4,5 MB del body delle funzioni Vercel non si applica. Serve il CORS del bucket (su Cubbit è già aperto).
- Sviluppo e produzione possono usare lo stesso bucket in sicurezza (le scritture sono serializzate), ma condividono i dati: per un ambiente di prova separato usa un altro `S3_PREFIX`.

## Struttura

```
src/
  proxy.ts                 protezione delle route
  app/(app)/               dashboard, materiali, genera, mazzi, studio
  app/api/                 API (auth, materiali, mazzi, card, export)
  lib/db.ts                DuckDB-WASM in memoria + tabelle Parquet versionate sul bucket (manifest)
  lib/duckdb-engine.ts     avvio di DuckDB-WASM (modalità blocking per Node)
  lib/lock.ts              lock distribuito per le scritture (Redis/Upstash o lease su S3)
  lib/s3.ts                client S3 con endpoint personalizzato
  lib/ai/providers.ts      motori AI disponibili (condiviso client/server)
  lib/ai/settings.ts       chiavi, modelli e motore predefinito nel cookie cifrato
  lib/ai/common.ts         prompt, schemi JSON e pulizia delle card (provider cloud)
  lib/ai/cloud/            Gemini, Claude, OpenAI/OpenRouter
  lib/ai/local/            modello locale nel browser: motore LiteRT-LM, lettura materiali, generazione
  lib/anki.ts              generatore .apkg (SQLite via sql.js) e CSV
```
