import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CLOUD_PROVIDERS } from "@/lib/ai/providers";
import { requireCredentials } from "@/lib/ai/settings";
import { runGeneration } from "@/lib/generation";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { OCCLUSION_IMAGE_TYPES } from "@/lib/files";
import { getMaterialsByIds, listCards, setDeckStatus } from "@/lib/repo";
import type { GenerationOptions } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Body = z.object({
  cardCount: z.number().int().min(5).max(100).optional(),
  focus: z.string().max(1000).optional(),
  // Il modello locale genera nel browser e salva con /cards/bulk: qui solo i provider cloud.
  provider: z.enum(CLOUD_PROVIDERS),
});

// Riprova una generazione fallita oppure aggiunge nuove card al mazzo.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/decks/[id]/generate">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "own");
  const body = Body.parse(await readJson(req));
  const cred = await requireCredentials(user, body.provider);
  if (deck.status === "generating") throw new HttpError(409, "A generation is already in progress for this deck.");

  const available = await getMaterialsByIds(deck.options.materialIds, user.id);
  if (available.length === 0) throw new HttpError(400, "The source materials have been deleted or made private.");

  if (deck.options.cardType === "image_occlusion") {
    const done = new Set((await listCards(id)).filter((c) => c.type === "image_occlusion").map((c) => c.imageMaterialId));
    const remaining = available.filter((m) => OCCLUSION_IMAGE_TYPES.includes(m.mimeType) && !done.has(m.id));
    if (remaining.length === 0) {
      throw new HttpError(400, "Every image of this deck already has an image occlusion card. Edit the masks or create a new deck with other images.");
    }
  }

  const options: GenerationOptions = {
    ...deck.options,
    materialIds: available.map((m) => m.id),
    cardCount: body.cardCount ?? deck.options.cardCount,
    focus: body.focus !== undefined ? body.focus.trim() : deck.options.focus,
    provider: body.provider,
  };
  await setDeckStatus(id, "generating");
  after(() => runGeneration(id, options, cred));
  return NextResponse.json({ ok: true }, { status: 202 });
});
