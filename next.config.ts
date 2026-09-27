import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pacchetti caricati da node_modules a runtime (WASM)
  serverExternalPackages: ["@duckdb/duckdb-wasm", "sql.js"],
  // I file .wasm sono letti dal disco con percorsi calcolati a runtime: il tracing di Next/Vercel
  // non li vede da solo, quindi vanno inclusi esplicitamente nelle funzioni.
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm", "./node_modules/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm"],
    "/api/decks/[id]/export": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
  poweredByHeader: false,
};

export default nextConfig;
