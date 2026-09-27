import "server-only";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import * as duckdb from "@duckdb/duckdb-wasm/blocking";

/*
 * DuckDB-WASM (come nel progetto mailsender), eseguito sul server in modalità "blocking" per Node.
 * Nessun binario nativo: su Vercel basta il file .wasm (incluso via outputFileTracingIncludes).
 */

export type SqlValue = string | number | boolean | null;
export type EngineRow = Record<string, unknown>;

export type Engine = {
  run: (sql: string, params?: SqlValue[]) => Promise<void>;
  all: (sql: string, params?: SqlValue[]) => Promise<EngineRow[]>;
  /** File virtuale in memoria, leggibile con read_parquet(name). */
  registerFile: (name: string, bytes: Uint8Array) => void;
  dropFile: (name: string) => void;
  /**
   * Percorso per l'output di COPY ... TO. Nel runtime Node di DuckDB-WASM i COPY scrivono sul
   * filesystem reale: si usa la cartella temporanea (/tmp è l'unica scrivibile su Vercel).
   */
  outputPath: (name: string) => string;
  /** Legge e cancella un file scritto con COPY ... TO outputPath(...). */
  takeOutput: (filePath: string) => Uint8Array;
};

function distDir(): string {
  // 1) percorso rispetto alla root del progetto (anche nella funzione Vercel, dove i file sono tracciati)
  const fromCwd = path.join(process.cwd(), "node_modules", "@duckdb", "duckdb-wasm", "dist");
  if (existsSync(path.join(fromCwd, "duckdb-eh.wasm"))) return fromCwd;
  // 2) risoluzione del modulo
  const req = createRequire(path.join(process.cwd(), "package.json"));
  return path.dirname(req.resolve("@duckdb/duckdb-wasm/dist/duckdb-eh.wasm"));
}

export async function createEngine(): Promise<Engine> {
  const dist = distDir();
  const bundles: duckdb.DuckDBBundles = {
    mvp: { mainModule: path.join(dist, "duckdb-mvp.wasm"), mainWorker: path.join(dist, "duckdb-node-mvp.worker.cjs") },
    eh: { mainModule: path.join(dist, "duckdb-eh.wasm"), mainWorker: path.join(dist, "duckdb-node-eh.worker.cjs") },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  // BIGINT → number: gli id numerici e i timestamp in millisecondi stanno comodamente in un double.
  db.open({ path: ":memory:", query: { castBigIntToDouble: true } });
  const conn = db.connect();
  const tmp = path.join(os.tmpdir(), "ankix-duckdb");
  mkdirSync(tmp, { recursive: true });
  // Eventuali file temporanei di DuckDB fuori dalla cartella del progetto (di sola lettura su Vercel).
  conn.query(`SET temp_directory = '${tmp.replace(/'/g, "''")}'`);

  const execute = (sql: string, params: SqlValue[]) => {
    if (params.length === 0) return conn.query(sql);
    const stmt = conn.prepare(sql);
    try {
      return stmt.query(...params);
    } finally {
      stmt.close();
    }
  };

  return {
    async run(sql, params = []) {
      execute(sql, params);
    },
    async all(sql, params = []) {
      return execute(sql, params)
        .toArray()
        .map((row) => row.toJSON() as EngineRow);
    },
    registerFile(name, bytes) {
      db.registerFileBuffer(name, bytes);
    },
    dropFile(name) {
      try {
        db.dropFile(name);
      } catch {
        /* già rimosso */
      }
    },
    outputPath(name) {
      return path.join(tmp, name);
    },
    takeOutput(filePath) {
      try {
        return new Uint8Array(readFileSync(filePath));
      } finally {
        try {
          unlinkSync(filePath);
        } catch {
          /* già rimosso */
        }
      }
    },
  };
}
