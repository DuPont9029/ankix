import "server-only";
import { randomUUID } from "node:crypto";
import { createEngine, type Engine, type SqlValue } from "./duckdb-engine";
import { env } from "./env";
import { acquireWriteLock, LockTimeoutError } from "./lock";
import { deleteObject, getObjectBytesIfExists, putObject } from "./s3";
import { LEGACY_SUBJECTS } from "./subjects";

/*
 * Database sul bucket S3, come nel progetto mailsender: le tabelle sono file Parquet letti con DuckDB-WASM.
 * Progettato per più istanze serverless in parallelo (es. Vercel):
 *
 *   <S3_PREFIX>/db/manifest.json          versione corrente: quale file Parquet contiene ogni tabella
 *   <S3_PREFIX>/db/data/<tabella>-<v>-<id>.parquet   file immutabili, uno per versione
 *   <S3_PREFIX>/db/lock.json              lock di scrittura (se non si usa Redis, vedi lock.ts)
 *
 * - Ogni istanza tiene una copia in un DuckDB in memoria e, prima di leggere, controlla il manifest
 *   (al massimo ogni READ_SYNC_MS): se è cambiato ricarica solo le tabelle modificate.
 * - Ogni scrittura: lock distribuito → rilettura del manifest (dati sempre aggiornati) → transazione →
 *   upload dei nuovi Parquet → nuovo manifest → COMMIT. Nessuna scrittura può sovrascriverne un'altra.
 *   Se qualcosa fallisce si fa ROLLBACK e il manifest resta quello precedente (versione coerente).
 * - I file sostituiti vengono cancellati dopo GC_AFTER_MS, così un'istanza che sta ancora leggendo
 *   la versione precedente non trova file mancanti.
 * I Parquet non vengono mai inviati al browser: contengono anche i mazzi privati di tutti gli utenti.
 */

export type SqlParam = string | number | boolean | null | undefined;
export type Row = Record<string, unknown>;

const TABLES = ["users", "materials", "decks", "cards", "card_states", "review_log", "study_prefs", "mind_maps", "oral_exams"] as const;
type Table = (typeof TABLES)[number];

type Manifest = {
  format: 1;
  version: number;
  updatedAt: number;
  /** Le tabelle aggiunte dopo la creazione del bucket mancano finché non vengono scritte la prima volta (= vuote). */
  tables: Partial<Record<Table, string>>;
  garbage: { key: string; at: number }[];
};

type DbState = {
  connection: Engine;
  manifest: Manifest | null;
  lastSync: number;
};

const READ_SYNC_MS = 200;
const GC_AFTER_MS = 10 * 60 * 1000;

// Singleton condiviso tra hot-reload e moduli delle route.
const globalForDb = globalThis as unknown as {
  __ankixDb?: Promise<DbState>;
  __ankixDbQueue?: Promise<unknown>;
};

const SCHEMA = [
  `CREATE TABLE users (
    id VARCHAR PRIMARY KEY,
    email VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    image VARCHAR,
    joined_at BIGINT,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE materials (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    subject VARCHAR NOT NULL,
    filename VARCHAR NOT NULL,
    mime_type VARCHAR NOT NULL,
    size_bytes BIGINT NOT NULL,
    s3_key VARCHAR NOT NULL,
    uploaded_by VARCHAR NOT NULL,
    uploaded_by_id VARCHAR,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE decks (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    subject VARCHAR NOT NULL,
    description VARCHAR NOT NULL DEFAULT '',
    status VARCHAR NOT NULL,
    error VARCHAR,
    options VARCHAR NOT NULL,
    sources VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    created_by VARCHAR NOT NULL,
    created_by_id VARCHAR,
    is_public BOOLEAN NOT NULL DEFAULT false,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE cards (
    id VARCHAR PRIMARY KEY,
    deck_id VARCHAR NOT NULL,
    position INTEGER NOT NULL,
    type VARCHAR NOT NULL,
    front VARCHAR NOT NULL,
    back VARCHAR NOT NULL DEFAULT '',
    extra VARCHAR NOT NULL DEFAULT '',
    tags VARCHAR NOT NULL DEFAULT '[]',
    image_material_id VARCHAR,
    occlusions VARCHAR NOT NULL DEFAULT '[]',
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  // Ripetizione dilazionata: stato FSRS di ogni elemento studiato (card, singola cloze o maschera) per utente.
  // Niente PRIMARY KEY: gli upsert sono gestiti nel codice (vedi study.ts).
  `CREATE TABLE card_states (
    user_id VARCHAR NOT NULL,
    item_key VARCHAR NOT NULL,
    card_id VARCHAR NOT NULL,
    deck_id VARCHAR NOT NULL,
    state VARCHAR NOT NULL,
    step INTEGER NOT NULL DEFAULT 0,
    due BIGINT NOT NULL,
    stability DOUBLE NOT NULL,
    difficulty DOUBLE NOT NULL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_review BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE review_log (
    id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL,
    item_key VARCHAR NOT NULL,
    card_id VARCHAR NOT NULL,
    deck_id VARCHAR NOT NULL,
    rating INTEGER NOT NULL,
    state VARCHAR NOT NULL,
    elapsed_days DOUBLE NOT NULL,
    scheduled_days DOUBLE NOT NULL,
    duration_ms INTEGER NOT NULL,
    reviewed_at BIGINT NOT NULL
  )`,
  `CREATE TABLE study_prefs (
    user_id VARCHAR NOT NULL,
    data VARCHAR NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE mind_maps (
    id VARCHAR NOT NULL,
    deck_id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    data VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  // Esami orali simulati: trascrizione, valutazione e card riprogrammate (in "data", JSON).
  `CREATE TABLE oral_exams (
    id VARCHAR NOT NULL,
    user_id VARCHAR NOT NULL,
    title VARCHAR NOT NULL,
    grade INTEGER NOT NULL,
    data VARCHAR NOT NULL,
    model VARCHAR NOT NULL,
    created_at BIGINT NOT NULL
  )`,
];

export class StorageError extends Error {}

// ---------- chiavi e file ----------

function dbKey(name: string): string {
  const prefix = env.s3Prefix ? `${env.s3Prefix}/` : "";
  return `${prefix}db/${name}`;
}
const MANIFEST_KEY = () => dbKey("manifest.json");

/** Nome di un file virtuale (in memoria, dentro DuckDB-WASM). */
function memFile(label: string): string {
  return `${label}-${randomUUID()}.parquet`;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Tabella scritta da un'istruzione SQL (INSERT/UPDATE/DELETE), se presente. */
function writtenTable(sql: string): Table | null {
  const m = sql.match(/^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?([a-z_]+)"?/i);
  const name = m?.[1]?.toLowerCase();
  return name && (TABLES as readonly string[]).includes(name) ? (name as Table) : null;
}

async function readManifest(): Promise<Manifest | null> {
  const bytes = await getObjectBytesIfExists(MANIFEST_KEY());
  if (!bytes) return null;
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as Manifest;
  if (manifest.format !== 1 || !manifest.tables) throw new Error("manifest.json non valido");
  return manifest;
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await putObject(MANIFEST_KEY(), new TextEncoder().encode(JSON.stringify(manifest)), "application/json");
}

/** Sostituisce il contenuto di una tabella con un file Parquet (dentro la transazione corrente). */
async function loadTableFile(conn: Engine, table: Table, bytes: Uint8Array): Promise<void> {
  const file = memFile(table);
  conn.registerFile(file, bytes);
  try {
    await conn.run(`DELETE FROM ${table}`);
    await conn.run(`INSERT INTO ${table} BY NAME SELECT * FROM read_parquet(${sqlString(file)})`);
  } finally {
    conn.dropFile(file);
  }
}

/** Esporta una tabella (stato visibile alla transazione corrente) in un nuovo file immutabile sul bucket. */
async function uploadTable(conn: Engine, table: Table, version: number): Promise<string> {
  const file = conn.outputPath(memFile(table));
  const key = dbKey(`data/${table}-${version}-${randomUUID().slice(0, 8)}.parquet`);
  await conn.run(`COPY (SELECT * FROM ${table}) TO ${sqlString(file)} (FORMAT parquet, COMPRESSION zstd)`);
  await putObject(key, conn.takeOutput(file), "application/vnd.apache.parquet");
  return key;
}

// ---------- sincronizzazione con il bucket ----------

/** Porta la copia in memoria alla versione del manifest indicato (ricarica solo le tabelle cambiate). */
async function applyManifest(state: DbState, manifest: Manifest): Promise<void> {
  const changed = TABLES.filter((t) => state.manifest?.tables[t] !== manifest.tables[t]);
  if (changed.length === 0) {
    state.manifest = manifest;
    return;
  }
  const files: [Table, Uint8Array | null][] = [];
  for (const table of changed) {
    const key = manifest.tables[table];
    if (!key) {
      files.push([table, null]);
      continue;
    }
    const bytes = await getObjectBytesIfExists(key);
    if (!bytes) throw new Error(`File mancante per la tabella ${table}: ${key}`);
    files.push([table, bytes]);
  }
  const conn = state.connection;
  await conn.run("BEGIN TRANSACTION");
  try {
    for (const [table, bytes] of files) {
      if (bytes) await loadTableFile(conn, table, bytes);
      else await conn.run(`DELETE FROM ${table}`);
    }
    await conn.run("COMMIT");
  } catch (err) {
    await conn.run("ROLLBACK").catch(() => undefined);
    throw err;
  }
  state.manifest = manifest;
}

async function sync(state: DbState, force: boolean, haveLock = false): Promise<void> {
  if (!force && Date.now() - state.lastSync < READ_SYNC_MS) return;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const manifest = await readManifest();
      if (!manifest) {
        await bootstrap(state, haveLock);
      } else if (manifest.version !== state.manifest?.version) {
        await applyManifest(state, manifest);
      }
      state.lastSync = Date.now();
      return;
    } catch (err) {
      // Es. un file appena rimosso da un'altra istanza: si rilegge il manifest e si riprova.
      lastError = err;
    }
  }
  if (!force && state.manifest) {
    // Lettura: meglio dati di pochi istanti fa che un errore.
    console.error("[db] sincronizzazione con S3 non riuscita, uso la copia in memoria", lastError);
    return;
  }
  console.error("[db] sincronizzazione con S3 non riuscita", lastError);
  throw new StorageError("Storage is temporarily unavailable. Please try again.");
}

// ---------- primo avvio / migrazione ----------

async function changed(conn: Engine, sql: string, params: SqlValue[] = []): Promise<boolean> {
  return (await conn.all(`${sql} RETURNING 1`, params)).length > 0;
}

/** Dati della versione precedente: un Parquet per tabella, senza manifest. */
async function importLegacy(conn: Engine): Promise<void> {
  let found = false;
  for (const table of TABLES) {
    const bytes = await getObjectBytesIfExists(dbKey(`${table}.parquet`));
    if (!bytes) continue;
    found = true;
    const file = memFile(table);
    conn.registerFile(file, bytes);
    try {
      await conn.run(`INSERT INTO ${table} BY NAME SELECT * FROM read_parquet(${sqlString(file)})`);
    } finally {
      conn.dropFile(file);
    }
  }
  if (found) console.log("[db] importati i Parquet della versione precedente");
}

/** Nessun manifest sul bucket: lo crea (una sola istanza, sotto lock), importando i dati precedenti. */
async function bootstrap(state: DbState, haveLock: boolean): Promise<void> {
  const lock = haveLock ? { assertValid: () => undefined, release: async () => undefined } : await acquireWriteLock();
  const conn = state.connection;
  const uploaded: string[] = [];
  try {
    const existing = await readManifest();
    if (existing) {
      await applyManifest(state, existing);
      return;
    }
    for (const table of TABLES) await conn.run(`DELETE FROM ${table}`);
    await importLegacy(conn);

    await conn.run("BEGIN TRANSACTION");
    try {
      for (const [legacy, current] of Object.entries(LEGACY_SUBJECTS)) {
        await changed(conn, `UPDATE materials SET subject = $1 WHERE subject = $2`, [current, legacy]);
        await changed(conn, `UPDATE decks SET subject = $1 WHERE subject = $2`, [current, legacy]);
      }
      await changed(conn, `DELETE FROM cards WHERE deck_id NOT IN (SELECT id FROM decks)`);
      const tables: Partial<Record<Table, string>> = {};
      for (const table of TABLES) {
        const key = await uploadTable(conn, table, 1);
        tables[table] = key;
        uploaded.push(key);
      }
      lock.assertValid();
      const manifest: Manifest = { format: 1, version: 1, updatedAt: Date.now(), tables, garbage: [] };
      await writeManifest(manifest);
      await conn.run("COMMIT");
      state.manifest = manifest;
      console.log("[db] creato il database sul bucket (manifest v1)");
    } catch (err) {
      await conn.run("ROLLBACK").catch(() => undefined);
      for (const key of uploaded) await deleteObject(key).catch(() => undefined);
      throw err;
    }
  } finally {
    await lock.release();
  }
}

// ---------- istanza e coda locale ----------

async function init(): Promise<DbState> {
  const connection = await createEngine();
  for (const statement of SCHEMA) await connection.run(statement);
  return { connection, manifest: null, lastSync: 0 };
}

function getDb(): Promise<DbState> {
  if (!globalForDb.__ankixDb) {
    globalForDb.__ankixDb = init().catch((err) => {
      globalForDb.__ankixDb = undefined;
      throw err;
    });
  }
  return globalForDb.__ankixDb;
}

/** Serializza l'accesso alla connessione in questa istanza (una operazione alla volta). */
function withLocalLock<T>(fn: (state: DbState) => Promise<T>): Promise<T> {
  const previous = globalForDb.__ankixDbQueue ?? Promise.resolve();
  const run = previous.then(async () => fn(await getDb()));
  globalForDb.__ankixDbQueue = run.catch(() => undefined);
  return run;
}

function normalize(params: SqlParam[]): SqlValue[] {
  return params.map((p) => (p === undefined ? null : p));
}

export type Tx = {
  query: <T extends Row = Row>(sql: string, params?: SqlParam[]) => Promise<T[]>;
  exec: (sql: string, params?: SqlParam[]) => Promise<void>;
};

function makeTx(conn: Engine, dirty: Set<Table>): Tx {
  const track = (sql: string) => {
    const table = writtenTable(sql);
    if (table) dirty.add(table);
  };
  return {
    async query<T extends Row = Row>(sql: string, params: SqlParam[] = []) {
      track(sql);
      return (await conn.all(sql, normalize(params))) as T[];
    },
    async exec(sql: string, params: SqlParam[] = []) {
      track(sql);
      await conn.run(sql, normalize(params));
    },
  };
}

async function collectGarbage(entries: { key: string; at: number }[]): Promise<void> {
  for (const { key } of entries) await deleteObject(key).catch(() => undefined);
}

/**
 * Transazione di scrittura (o di sola lettura, se non modifica nulla).
 * Le scritture sono serializzate fra TUTTE le istanze tramite il lock distribuito.
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withLocalLock(async (state) => {
    await sync(state, false);
    const conn = state.connection;

    // 1) prova "a secco": se la funzione non scrive nulla non serve il lock distribuito
    const probe = new Set<Table>();
    await conn.run("BEGIN TRANSACTION");
    let result: T;
    try {
      result = await fn(makeTx(conn, probe));
    } catch (err) {
      await conn.run("ROLLBACK").catch(() => undefined);
      throw err;
    }
    if (probe.size === 0) {
      await conn.run("COMMIT");
      return result;
    }
    await conn.run("ROLLBACK");

    // 2) scrittura vera: lock → dati aggiornati → transazione → upload → manifest → commit
    let lock;
    try {
      lock = await acquireWriteLock();
    } catch (err) {
      if (err instanceof LockTimeoutError) throw new StorageError("The server is busy saving other changes. Please try again.");
      throw new StorageError("Could not save your changes to storage. Please try again.");
    }
    const uploaded: string[] = [];
    let expired: { key: string; at: number }[] = [];
    try {
      await sync(state, true, true);
      const base = state.manifest!;
      const dirty = new Set<Table>();
      await conn.run("BEGIN TRANSACTION");
      try {
        result = await fn(makeTx(conn, dirty));
      } catch (err) {
        await conn.run("ROLLBACK").catch(() => undefined);
        throw err;
      }
      if (dirty.size === 0) {
        // Sui dati aggiornati non c'è più nulla da cambiare (es. riga già creata da un'altra istanza).
        await conn.run("COMMIT");
        return result;
      }
      try {
        const version = base.version + 1;
        const tables = { ...base.tables };
        const now = Date.now();
        const garbage = [...base.garbage];
        for (const table of TABLES) {
          if (!dirty.has(table)) continue;
          const key = await uploadTable(conn, table, version);
          uploaded.push(key);
          const previous = tables[table];
          if (previous) garbage.push({ key: previous, at: now });
          tables[table] = key;
        }
        expired = garbage.filter((g) => now - g.at > GC_AFTER_MS);
        const manifest: Manifest = {
          format: 1,
          version,
          updatedAt: now,
          tables,
          garbage: garbage.filter((g) => now - g.at <= GC_AFTER_MS),
        };
        lock.assertValid();
        await writeManifest(manifest);
        await conn.run("COMMIT");
        state.manifest = manifest;
        state.lastSync = Date.now();
      } catch (err) {
        await conn.run("ROLLBACK").catch(() => undefined);
        for (const key of uploaded) await deleteObject(key).catch(() => undefined);
        state.lastSync = 0;
        console.error("[db] salvataggio su S3 non riuscito", err);
        throw new StorageError("Could not save your changes to storage. Please try again.");
      }
    } finally {
      await lock.release();
    }
    await collectGarbage(expired);
    return result;
  });
}

export function query<T extends Row = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  if (writtenTable(sql)) return transaction((tx) => tx.query<T>(sql, params));
  return withLocalLock(async (state) => {
    await sync(state, false);
    return makeTx(state.connection, new Set()).query<T>(sql, params);
  });
}

export function exec(sql: string, params: SqlParam[] = []): Promise<void> {
  return transaction((tx) => tx.exec(sql, params));
}

/** Forza la rilettura del manifest (es. un elemento appena creato su un'altra istanza). */
export function refresh(): Promise<void> {
  return withLocalLock((state) => sync(state, true));
}
