import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Moduli nativi / WASM che devono essere caricati da node_modules a runtime
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings", "sql.js"],
  // sql.js legge il proprio .wasm dal disco con un percorso calcolato a runtime: il tracing di
  // Next/Vercel non lo vede da solo, quindi va incluso esplicitamente nella funzione di export.
  outputFileTracingIncludes: {
    "/api/decks/[id]/export": ["./node_modules/sql.js/dist/sql-wasm.wasm"],
  },
  poweredByHeader: false,
};

export default nextConfig;
