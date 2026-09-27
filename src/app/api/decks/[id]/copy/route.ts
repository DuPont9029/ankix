import { NextResponse, type NextRequest } from "next/server";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, requireUser } from "@/lib/http";
import { copyDeck } from "@/lib/repo";

export const dynamic = "force-dynamic";

// Salva una copia privata di un mazzo pubblico (o proprio) tra i propri mazzi.
export const POST = handle(async (_req: NextRequest, ctx: RouteContext<"/api/decks/[id]/copy">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "view");
  if (deck.status === "generating") throw new HttpError(409, "Wait for the generation to finish before copying the deck.");
  const newDeckId = await copyDeck(deck, user);
  return NextResponse.json({ id: newDeckId }, { status: 201 });
});
