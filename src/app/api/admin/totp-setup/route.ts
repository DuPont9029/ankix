import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handle, HttpError, requireUser } from "@/lib/http";
import { classTotpSetup } from "@/lib/totp";

export const dynamic = "force-dynamic";

// QR e segreto per aggiungere il codice della classe a un'app authenticator (solo amministratori).
export const GET = handle(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new HttpError(403, "Administrators only.");
  const setup = await classTotpSetup(env.className);
  if (!setup) throw new HttpError(404, "CLASS_TOTP_SECRET is not configured.");
  return NextResponse.json(setup, { headers: { "Cache-Control": "no-store" } });
});
