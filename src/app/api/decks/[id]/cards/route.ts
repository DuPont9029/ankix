import { NextResponse, type NextRequest } from "next/server";
import { assertOcclusionImage, CardBody, toCardInput } from "@/lib/cards";
import { loadDeck } from "@/lib/decks";
import { handle, readJson, requireUser } from "@/lib/http";
import { appendCards } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/decks/[id]/cards">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await loadDeck(id, user, "own");
  const input = toCardInput(CardBody.parse(await readJson(req)));
  await assertOcclusionImage(input);
  const [card] = await appendCards(id, [input]);
  return NextResponse.json({ card }, { status: 201 });
});
