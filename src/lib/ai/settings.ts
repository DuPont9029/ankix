import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { AI_SETTINGS_COOKIE, LEGACY_GEMINI_KEY_COOKIE } from "../cookie-names";
import { env } from "../env";
import { HttpError } from "../http";
import type { User } from "../current-user";
import { CLOUD_PROVIDERS, isAiProvider, PROVIDER_INFO, type AiProvider, type AiStatus, type CloudProvider } from "./providers";

// Le chiavi API di ogni studente vivono solo nel suo browser, in un cookie httpOnly cifrato
// (AES-256-GCM, chiave derivata da BETTER_AUTH_SECRET): il JavaScript della pagina non può leggerle
// e il server non le salva mai. Sono legate all'id dell'utente.
const MAX_AGE = 60 * 60 * 24 * 180; // 180 giorni

export type AiSettings = {
  provider: AiProvider;
  keys: Partial<Record<CloudProvider, string>>;
  /** Modello scelto dallo studente per ciascun provider (vuoto = predefinito del server) */
  models: Partial<Record<CloudProvider, string>>;
};

export type AiCredentials = { provider: CloudProvider; apiKey: string; model: string };

function encryptionKey(info: string): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET is missing or too short (at least 32 characters)");
  return Buffer.from(hkdfSync("sha256", secret, "ankix", info, 32));
}

function encrypt(payload: unknown, info: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(info), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function decrypt(token: string, info: string): unknown {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(info), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

type Payload = { n: string; p: string; k: Record<string, unknown>; m: Record<string, unknown> };

function pickStrings(obj: Record<string, unknown> | undefined): Partial<Record<CloudProvider, string>> {
  const out: Partial<Record<CloudProvider, string>> = {};
  for (const p of CLOUD_PROVIDERS) {
    const v = obj?.[p];
    if (typeof v === "string" && v) out[p] = v;
  }
  return out;
}

export function defaultModel(provider: CloudProvider): string {
  switch (provider) {
    case "gemini":
      return env.geminiModel;
    case "anthropic":
      return env.anthropicModel;
    case "openai":
      return env.openaiModel;
    case "openrouter":
      return env.openrouterModel;
  }
}

/** Impostazioni AI dello studente. Senza cookie il motore predefinito è quello locale. */
export async function getAiSettings(user: Pick<User, "id">): Promise<AiSettings> {
  const store = await cookies();
  const token = store.get(AI_SETTINGS_COOKIE)?.value;
  const payload = token ? (decrypt(token, "ai-settings") as Payload | null) : null;
  // La configurazione è legata allo studente che l'ha inserita: un altro accesso sullo stesso browser non la usa.
  if (payload && payload.n === user.id) {
    const keys = pickStrings(payload.k);
    const provider = isAiProvider(payload.p) && (payload.p === "local" || keys[payload.p]) ? payload.p : "local";
    return { provider, keys, models: pickStrings(payload.m) };
  }
  // Migrazione: la vecchia chiave Gemini resta disponibile come alternativa, ma il predefinito diventa il modello locale.
  const legacy = store.get(LEGACY_GEMINI_KEY_COOKIE)?.value;
  const old = legacy ? (decrypt(legacy, "gemini-api-key") as { k?: unknown; n?: unknown } | null) : null;
  if (old && old.n === user.id && typeof old.k === "string" && old.k) {
    return { provider: "local", keys: { gemini: old.k }, models: {} };
  }
  return { provider: "local", keys: {}, models: {} };
}

export function maskKey(key: string): string {
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function toStatus(settings: AiSettings): AiStatus {
  const cloud = {} as AiStatus["cloud"];
  for (const p of CLOUD_PROVIDERS) {
    const key = settings.keys[p];
    const def = defaultModel(p);
    cloud[p] = { configured: Boolean(key), masked: key ? maskKey(key) : null, model: settings.models[p] || def, defaultModel: def };
  }
  return { provider: settings.provider, cloud };
}

export async function getAiStatus(user: Pick<User, "id">): Promise<AiStatus> {
  return toStatus(await getAiSettings(user));
}

/** Chiave e modello per generare con un provider cloud; errore 400 se lo studente non ha inserito la chiave. */
export async function requireCredentials(user: Pick<User, "id">, provider: CloudProvider): Promise<AiCredentials> {
  const settings = await getAiSettings(user);
  const apiKey = settings.keys[provider];
  if (!apiKey) {
    throw new HttpError(
      400,
      `To generate with ${PROVIDER_INFO[provider].label} you first need to add your API key in Settings (or use the local AI).`,
      "missing_ai_key",
    );
  }
  return { provider, apiKey, model: settings.models[provider] || defaultModel(provider) };
}

export function saveAiSettings(res: NextResponse, settings: AiSettings, owner: string, secure: boolean) {
  const payload: Payload = { n: owner, p: settings.provider, k: settings.keys, m: settings.models };
  res.cookies.set(AI_SETTINGS_COOKIE, encrypt(payload, "ai-settings"), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE });
  // La chiave Gemini della versione precedente è stata migrata nel nuovo cookie.
  res.cookies.set(LEGACY_GEMINI_KEY_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function isSecureRequest(req: Request & { nextUrl?: URL }): boolean {
  return req.nextUrl?.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
}
