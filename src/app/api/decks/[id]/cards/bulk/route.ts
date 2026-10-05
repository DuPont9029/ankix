import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cleanLocalCards, LocalCardsBody } from "@/lib/ai/local-import";
import { LOCAL_MODEL_LABEL } from "@/lib/ai/providers";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { appendCards, listCards, setDeckStatus } from "@/lib/repo";

export const dynamic = "force-dynamic";

const Body = z.object({ cards: LocalCardsBody });

// Salva le card generate nel browser dal modello locale ("Generate more" / "Retry").
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/decks/[id]/cards/bulk">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "own");
  if (deck.status === "generating") throw new HttpError(409, "A generation is already in progress for this deck.");
  const { cards: raw } = Body.parse(await readJson(req));
  const existing = (await listCards(id)).map((c) => c.front);
  const cards = await cleanLocalCards(raw, existing, deck.options.materialIds);
  if (cards.length === 0) throw new HttpError(400, "No new valid cards: the material seems to be already covered by the deck.");
  const created = await appendCards(id, cards);
  await setDeckStatus(id, "ready", { model: LOCAL_MODEL_LABEL });
  return NextResponse.json({ cards: created }, { status: 201 });
});
