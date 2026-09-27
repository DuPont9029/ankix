import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";

// TOTP standard (RFC 6238): SHA-1, 6 cifre, periodo 30 s — compatibile con qualsiasi app authenticator.
export const TOTP_PERIOD = 30;
const DIGITS = 6;
// Accetta il passo precedente e il successivo (tolleranza per orologi poco precisi):
// un codice resta valido circa 60 secondi da quando compare nell'app.
const WINDOW = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error("CLASS_TOTP_SECRET is not a valid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Segreto della classe (base32) da CLASS_TOTP_SECRET, o null se il codice di accesso è disattivato. */
export function classTotpSecret(): string | null {
  const secret = process.env.CLASS_TOTP_SECRET?.trim().toUpperCase().replace(/[\s=-]/g, "");
  return secret ? secret : null;
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return code.toString().padStart(DIGITS, "0");
}

export function totpAt(secret: string, timeMs: number): string {
  return hotp(base32Decode(secret), Math.floor(timeMs / 1000 / TOTP_PERIOD));
}

/** Verifica un codice a 6 cifre contro il segreto della classe (confronto a tempo costante). */
export function verifyClassTotp(input: string, nowMs = Date.now()): boolean {
  const secret = classTotpSecret();
  const candidate = input.replace(/\s+/g, "");
  if (!secret || !/^\d{6}$/.test(candidate)) return false;
  const key = base32Decode(secret);
  const step = Math.floor(nowMs / 1000 / TOTP_PERIOD);
  let ok = false;
  for (let i = -WINDOW; i <= WINDOW; i++) {
    const expected = hotp(key, step + i);
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) ok = true;
  }
  return ok;
}

/** Codice attuale e secondi rimanenti (per la pagina admin). */
export function currentClassTotp(nowMs = Date.now()) {
  const secret = classTotpSecret();
  if (!secret) return null;
  const elapsed = (nowMs / 1000) % TOTP_PERIOD;
  return { code: totpAt(secret, nowMs), remainingMs: Math.round((TOTP_PERIOD - elapsed) * 1000), periodMs: TOTP_PERIOD * 1000 };
}

/** URI otpauth:// e QR (SVG) per aggiungere il segreto a un'app authenticator. */
export async function classTotpSetup(label: string) {
  const secret = classTotpSecret();
  if (!secret) return null;
  const issuer = "Ankix";
  const uri =
    `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}` +
    `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${TOTP_PERIOD}`;
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { uri, secret, qrSvg };
}
