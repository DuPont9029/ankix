import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateConceptMap, generateMindMap } from "@/lib/ai/mindmap";
import { CLOUD_PROVIDERS } from "@/lib/ai/providers";
import { requireCredentials } from "@/lib/ai/settings";
import { MAX_CONCEPTS, MAX_PROPOSITIONS, normalizeConceptMap } from "@/lib/conceptmap";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { AUTO_MODEL, autoMap, MAX_LINKS, MAX_NODES, normalizeMap } from "@/lib/mindmap";
import { deleteMindMap, getMindMap, listCards, saveMindMap } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = RouteContext<"/api/decks/[id]/map">;

const Pos = { x: z.number().optional(), y: z.number().optional() };

const NodeBody = z.object({
  id: z.string().max(64),
  label: z.string().max(200),
  note: z.string().max(1000).optional().default(""),
  parent: z.string().max(64).nullable(),
  cards: z.array(z.string().max(64)).max(200).optional().default([]),
  ...Pos,
});

const ConceptBody = z.object({
  focus: z.string().max(400),
  concepts: z
    .array(
      z.object({
        id: z.string().max(64),
        label: z.string().max(200),
        note: z.string().max(1000).optional().default(""),
        level: z.number().int().min(0).max(20),
        cards: z.array(z.string().max(64)).max(200).optional().default([]),
        ...Pos,
      }),
    )
    .max(MAX_CONCEPTS),
  propositions: z
    .array(
      z.object({
        id: z.string().max(64),
        from: z.string().max(64),
        to: z.string().max(64),
        label: z.string().max(200),
        cross: z.boolean(),
        cards: z.array(z.string().max(64)).max(200).optional().default([]),
      }),
    )
    .max(MAX_PROPOSITIONS),
});

const SaveBody = z.object({
  title: z.string().max(200),
  /** Modello che ha generato la mappa (es. l'AI locale); assente = modifica a mano */
  model: z.string().max(100).optional(),
  nodes: z.array(NodeBody).min(1).max(MAX_NODES),
  links: z
    .array(z.object({ id: z.string().max(64), from: z.string().max(64), to: z.string().max(64), label: z.string().max(200) }))
    .max(MAX_LINKS)
    .optional()
    .default([]),
  concept: ConceptBody.nullable().optional(),
});

/** `kind`: quale mappa generare. Senza AI ("auto") si può creare solo la mappa mentale (dai tag). */
const GenerateBody = z.object({ provider: z.enum(["auto", ...CLOUD_PROVIDERS]), kind: z.enum(["mind", "concept", "both"]).default("both") });

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await loadDeck(id, user, "view");
  return NextResponse.json({ map: await getMindMap(user.id, id) });
});

/** Salva le mappe modificate a mano o generate dal modello locale nel browser. */
export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "view");
  const body = SaveBody.parse(await readJson(req));
  const valid = new Set((await listCards(id)).map((c) => c.id));
  const existing = await getMindMap(user.id, id);
  const map = await saveMindMap(user.id, id, {
    ...normalizeMap(body, valid, deck.title),
    concept: body.concept === undefined ? (existing?.concept ?? null) : body.concept && normalizeConceptMap(body.concept, valid),
    title: body.title.replace(/<[^>]+>/g, "").trim().slice(0, 120) || deck.title,
    model: body.model?.trim() || existing?.model || "Manual",
  });
  return NextResponse.json({ map });
});

/** Genera (o rigenera) la mappa mentale, quella concettuale o entrambe. */
export const POST = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "view");
  const { provider, kind } = GenerateBody.parse(await readJson(req));
  const cards = await listCards(id);
  if (cards.length === 0) throw new HttpError(400, "The deck has no cards yet.");
  const valid = new Set(cards.map((c) => c.id));
  const existing = await getMindMap(user.id, id);

  if (provider === "auto") {
    if (kind === "concept") throw new HttpError(400, "A concept map needs an AI engine: its relations cannot be derived from the tags.");
    const data = normalizeMap(autoMap(deck.title, cards), valid, deck.title);
    return NextResponse.json({
      map: await saveMindMap(user.id, id, { ...data, concept: existing?.concept ?? null, title: deck.title, model: AUTO_MODEL }),
    });
  }

  const cred = await requireCredentials(user, provider);
  try {
    const [mind, concept] = await Promise.all([
      kind === "concept" ? null : generateMindMap(deck, cards, cred),
      kind === "mind" ? null : generateConceptMap(deck, cards, cred),
    ]);
    const base = mind ?? (existing ? { nodes: existing.nodes, links: existing.links, title: existing.title } : { ...normalizeMap(autoMap(deck.title, cards), valid, deck.title), title: deck.title });
    return NextResponse.json({
      map: await saveMindMap(user.id, id, {
        nodes: base.nodes,
        links: base.links,
        title: base.title,
        concept: concept ?? existing?.concept ?? null,
        model: cred.model,
      }),
    });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("[mindmap]", err);
    throw new HttpError(502, err instanceof Error ? err.message : "The map could not be generated.");
  }
});

export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await loadDeck(id, user, "view");
  await deleteMindMap(user.id, id);
  return NextResponse.json({ ok: true });
});
