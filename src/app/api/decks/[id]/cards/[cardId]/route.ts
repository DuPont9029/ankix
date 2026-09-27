import { NextResponse, type NextRequest } from "next/server";
import { CardBody, toCardInput } from "@/lib/cards";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { deleteCard, getCard, updateCard } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/decks/[id]/cards/[cardId]">;

export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id, cardId } = await ctx.params;
  await loadDeck(id, user, "own");
  if (!(await getCard(id, cardId))) throw new HttpError(404, "Card not found.");
  const input = toCardInput(CardBody.parse(await readJson(req)));
  await updateCard(id, cardId, input);
  return NextResponse.json({ card: await getCard(id, cardId) });
});

export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id, cardId } = await ctx.params;
  await loadDeck(id, user, "own");
  if (!(await getCard(id, cardId))) throw new HttpError(404, "Card not found.");
  await deleteCard(id, cardId);
  return NextResponse.json({ ok: true });
});
