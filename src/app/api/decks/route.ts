import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cleanLocalCards, LocalCardsBody } from "@/lib/ai/local-import";
import { LOCAL_MODEL_LABEL } from "@/lib/ai/providers";
import { requireCredentials } from "@/lib/ai/settings";
import { GenerationBody } from "@/lib/decks";
import { runGeneration } from "@/lib/generation";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { appendCards, getMaterialsByIds, insertDeck, listDecks, newId } from "@/lib/repo";
import { isSubject } from "@/lib/subjects";
import type { GenerationOptions } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const scope = req.nextUrl.searchParams.get("scope") === "public" ? "public" : "mine";
  return NextResponse.json({ decks: await listDecks(user.id, scope) });
});

const Body = GenerationBody.extend({
  title: z.string().trim().max(120).optional().default(""),
  subject: z.string().refine(isSubject, "Invalid subject"),
  /** Solo per il modello locale: card già generate nel browser */
  cards: LocalCardsBody.optional(),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const body = Body.parse(await readJson(req));
  const local = body.provider === "local";
  const cred = local ? null : await requireCredentials(user, body.provider as Exclude<typeof body.provider, "local">);
  if (local && !body.cards) throw new HttpError(400, "The local AI generates the cards in your browser: no cards were received.");

  const materialIds = [...new Set(body.materialIds)];
  const materials = await getMaterialsByIds(materialIds, user.id);
  if (materials.length !== materialIds.length) throw new HttpError(400, "Some of the selected materials no longer exist or are private.");

  const cards = local ? await cleanLocalCards(body.cards!, [], materialIds) : [];
  if (local && cards.length === 0) throw new HttpError(400, "None of the generated cards is valid: try again or use another AI engine.");

  const options: GenerationOptions = {
    cardCount: body.cardCount,
    cardType: body.cardType,
    difficulty: body.difficulty,
    language: body.language,
    focus: body.focus.trim(),
    materialIds,
    autoTitle: !body.title,
    provider: body.provider,
  };
  const now = Date.now();
  const id = newId();
  await insertDeck({
    id,
    title: body.title || (materials.length === 1 ? materials[0].title : `${body.subject} – ${materials.length} materials`),
    subject: body.subject,
    description: "",
    status: local ? "ready" : "generating",
    error: null,
    options,
    sources: materials.map((m) => ({ id: m.id, title: m.title })),
    model: cred ? cred.model : LOCAL_MODEL_LABEL,
    createdBy: user.name,
    createdById: user.id,
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  });

  if (local) {
    await appendCards(id, cards);
    return NextResponse.json({ id, cardCount: cards.length }, { status: 201 });
  }
  after(() => runGeneration(id, options, cred!));
  return NextResponse.json({ id }, { status: 202 });
});
