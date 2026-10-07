import { NextResponse, type NextRequest } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { buildPlan } from "@/lib/study";

export const dynamic = "force-dynamic";

/** Piano di studio di oggi (tutti i mazzi attivi, oppure solo `?deck=<id>`). */
export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const deckId = req.nextUrl.searchParams.get("deck") || undefined;
  return NextResponse.json(await buildPlan(user.id, { deckId }));
});
