import { NextResponse } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { currentClassTotp } from "@/lib/totp";

export const dynamic = "force-dynamic";

// Codice TOTP attuale della classe (solo amministratori).
export const GET = handle(async () => {
  const user = await requireUser();
  if (!user.isAdmin) throw new HttpError(403, "Administrators only.");
  return NextResponse.json({ totp: currentClassTotp() }, { headers: { "Cache-Control": "no-store" } });
});
