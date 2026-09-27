import { NextResponse } from "next/server";
import { z } from "zod";
import { joinCodeRequired } from "@/lib/access";
import { markJoined } from "@/lib/current-user";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { verifyClassTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(1, "Enter the access code").max(20) });

// Tentativi falliti per utente (in memoria): 10 ogni 10 minuti
const attempts = new Map<string, { count: number; resetAt: number }>();

export const POST = handle(async (req: Request) => {
  const user = await requireUser({ allowUnjoined: true });
  if (!joinCodeRequired() || user.joined) return NextResponse.json({ ok: true });

  const now = Date.now();
  const entry = attempts.get(user.id);
  if (entry && entry.resetAt > now && entry.count >= 10) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");

  const { code } = Body.parse(await readJson(req));
  if (!verifyClassTotp(code)) {
    const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + 10 * 60 * 1000 };
    current.count++;
    attempts.set(user.id, current);
    throw new HttpError(400, "Invalid or expired code. Ask the administrator for the current code.");
  }
  attempts.delete(user.id);
  await markJoined(user.id);
  return NextResponse.json({ ok: true });
});
