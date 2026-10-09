// Caricato con NODE_OPTIONS=--import nel server isolato del trailer.
// 1. Simula lo scambio del codice OAuth con Google (nessuna chiamata a Google).
// 2. Blocca ogni chiamata ai veri provider AI.
// 3. Orologio spostabile: il file TRAILER_CLOCK_FILE contiene lo scarto in ms (per seminare lo storico dei ripassi).
import { readFileSync, watchFile, existsSync } from "node:fs";

const USER = { sub: "100000000000000000001", email: "emma.wilson@students.example.edu", name: "Emma Wilson", given_name: "Emma", family_name: "Wilson" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

const realFetch = globalThis.fetch;
const BLOCKED = /(^|\.)(anthropic\.com|openai\.com|openrouter\.ai|generativelanguage\.googleapis\.com|upstash\.io)$/;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "oauth2.googleapis.com" && url.pathname === "/token") {
    const now = Math.floor(Date.now() / 1000);
    const idToken = `${b64({ alg: "RS256", kid: "trailer", typ: "JWT" })}.${b64({ iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, picture: "", ...USER })}.c2ln`;
    return new Response(JSON.stringify({ access_token: "ya29.trailer", expires_in: 3599, token_type: "Bearer", scope: "openid email profile", id_token: idToken }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (BLOCKED.test(url.hostname)) {
    console.error(`[trailer] chiamata esterna bloccata: ${url.hostname}`);
    return new Response(JSON.stringify({ error: "blocked in trailer sandbox" }), { status: 503 });
  }
  return realFetch(input, init);
};

const clockFile = process.env.TRAILER_CLOCK_FILE;
if (clockFile) {
  // Solo Date.now: sostituire il costruttore di Date rompe l'SDK AWS.
  const realNow = Date.now.bind(Date);
  let offset = 0;
  const read = () => { try { offset = existsSync(clockFile) ? Number(readFileSync(clockFile, "utf8").trim()) || 0 : 0; } catch { offset = 0; } };
  read();
  watchFile(clockFile, { interval: 100 }, read);
  Date.now = () => realNow() + offset;
}
