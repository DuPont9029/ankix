import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireGeminiKey } from "@/lib/gemini-key";
import { runGeneration } from "@/lib/generation";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { getMaterialsByIds, setDeckStatus } from "@/lib/repo";
import type { GenerationOptions } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  cardCount: z.number().int().min(5).max(100).optional(),
  focus: z.string().max(1000).optional(),
});

// Riprova una generazione fallita oppure aggiunge nuove card al mazzo.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/decks/[id]/generate">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "own");
  const apiKey = await requireGeminiKey(user);
  if (deck.status === "generating") throw new HttpError(409, "A generation is already in progress for this deck.");
  const body = Body.parse(await readJson(req));

  const available = await getMaterialsByIds(deck.options.materialIds);
  if (available.length === 0) throw new HttpError(400, "The source materials have been deleted.");

  const options: GenerationOptions = {
    ...deck.options,
    materialIds: available.map((m) => m.id),
    cardCount: body.cardCount ?? deck.options.cardCount,
    focus: body.focus !== undefined ? body.focus.trim() : deck.options.focus,
  };
  await setDeckStatus(id, "generating");
  after(() => runGeneration(id, options, apiKey));
  return NextResponse.json({ ok: true }, { status: 202 });
});
