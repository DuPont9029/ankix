import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { HttpError } from "./http";
import type { User } from "./current-user";

// La chiave Gemini di ogni studente vive solo nel suo browser, in un cookie httpOnly cifrato
// (AES-256-GCM, chiave derivata da BETTER_AUTH_SECRET): il JavaScript della pagina non può leggerla
// e il server non la salva mai. È legata all'id dell'utente.
import { GEMINI_KEY_COOKIE } from "./cookie-names";

export { GEMINI_KEY_COOKIE };
const MAX_AGE = 60 * 60 * 24 * 180; // 180 giorni

function encryptionKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("BETTER_AUTH_SECRET is missing or too short (at least 32 characters)");
  return Buffer.from(hkdfSync("sha256", secret, "ankix", "gemini-api-key", 32));
}

type Payload = { k: string; n: string };

export function encryptKey(apiKey: string, owner: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload: Payload = { k: apiKey, n: owner };
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

function decryptKey(token: string, owner: string): string | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const text = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const payload = JSON.parse(text) as Payload;
    // La chiave è legata allo studente che l'ha inserita: un altro accesso sullo stesso browser non la usa.
    if (payload.n !== owner || typeof payload.k !== "string" || !payload.k) return null;
    return payload.k;
  } catch {
    return null;
  }
}

export async function getGeminiKey(user: Pick<User, "id">): Promise<string | null> {
  const store = await cookies();
  const token = store.get(GEMINI_KEY_COOKIE)?.value;
  return token ? decryptKey(token, user.id) : null;
}

export async function requireGeminiKey(user: Pick<User, "id">): Promise<string> {
  const key = await getGeminiKey(user);
  if (!key) {
    throw new HttpError(
      400,
      "To generate flashcards you first need to add your Gemini key in Settings.",
      "missing_gemini_key",
    );
  }
  return key;
}

export function maskKey(key: string): string {
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export function setGeminiKeyCookie(res: NextResponse, token: string, secure: boolean) {
  res.cookies.set(GEMINI_KEY_COOKIE, token, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: MAX_AGE });
}

export function clearGeminiKeyCookie(res: NextResponse) {
  res.cookies.set(GEMINI_KEY_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}
