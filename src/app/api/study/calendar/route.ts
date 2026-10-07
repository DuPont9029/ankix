import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { buildCalendar } from "@/lib/study";

export const dynamic = "force-dynamic";

/** Storico e previsione giorno per giorno: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (al massimo 63 giorni). */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const params = req.nextUrl.searchParams;
  return NextResponse.json(await buildCalendar(user.id, params.get("from") ?? "", params.get("to") ?? ""));
});
