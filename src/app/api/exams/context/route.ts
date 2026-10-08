import { NextResponse, type NextRequest } from "next/server";
import { examContext } from "@/lib/exams";
import { handle, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Card dei mazzi collegati ai materiali e domande già fatte, per l'esame con il modello locale. */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const ids = (req.nextUrl.searchParams.get("materials") ?? "").split(",").filter(Boolean);
  return NextResponse.json(await examContext(user.id, ids));
});
