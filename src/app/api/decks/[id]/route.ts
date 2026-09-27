import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadDeck } from "@/lib/decks";
import { handle, readJson, requireUser } from "@/lib/http";
import { deleteDeck, getDeck, listCards, updateDeckMeta } from "@/lib/repo";
import { isSubject } from "@/lib/subjects";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/decks/[id]">;

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const deck = await loadDeck(id, user, "view");
  return NextResponse.json({ deck, cards: await listCards(id) });
});

const PatchBody = z.object({
  title: z.string().trim().min(1, "The title cannot be empty").max(120).optional(),
  subject: z.string().refine(isSubject, "Invalid subject").optional(),
  description: z.string().trim().max(500).optional(),
  isPublic: z.boolean().optional(),
});

export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await loadDeck(id, user, "own");
  await updateDeckMeta(id, PatchBody.parse(await readJson(req)));
  return NextResponse.json({ deck: await getDeck(id) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await loadDeck(id, user, "own");
  await deleteDeck(id);
  return NextResponse.json({ ok: true });
});
