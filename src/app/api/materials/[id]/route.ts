import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { canUseMaterial, deleteDecks, deleteMaterial, getMaterial, listDecksUsingMaterial, setMaterialVisibility } from "@/lib/repo";
import { deleteObject } from "@/lib/s3";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/materials/[id]">;

/** Mazzi generati dal materiale: quelli dell'utente (eliminabili insieme al materiale) e quanti sono di altri. */
export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material || !canUseMaterial(material, user.id)) throw new HttpError(404, "Material not found.");
  const decks = await listDecksUsingMaterial(id);
  const mine = decks.filter((d) => d.createdById === user.id);
  return NextResponse.json({
    decks: mine.map((d) => ({ id: d.id, title: d.title, cardCount: d.cardCount })),
    othersCount: decks.length - mine.length,
  });
});

const PatchBody = z.object({ isPublic: z.boolean() });

/** Rende il materiale condiviso con la classe o privato: solo chi l'ha caricato. */
export const PATCH = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material || !canUseMaterial(material, user.id)) throw new HttpError(404, "Material not found.");
  if (material.uploadedById !== user.id) throw new HttpError(403, "Only the person who uploaded a material can change its visibility.");
  const { isPublic } = PatchBody.parse(await readJson(req));
  await setMaterialVisibility(id, isPublic);
  const { s3Key: _key, ...updated } = { ...material, isPublic };
  void _key;
  return NextResponse.json({ material: updated });
});

/** `?withDecks=1` elimina anche i mazzi dell'utente generati da questo materiale (con storico e mappe). */
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material || !canUseMaterial(material, user.id)) throw new HttpError(404, "Material not found.");
  if (material.uploadedById !== user.id) {
    throw new HttpError(403, "You can only delete materials you uploaded.");
  }
  let deletedDecks = 0;
  if (req.nextUrl.searchParams.get("withDecks") === "1") {
    const mine = (await listDecksUsingMaterial(id)).filter((d) => d.createdById === user.id);
    await deleteDecks(mine.map((d) => d.id));
    deletedDecks = mine.length;
  }
  await deleteObject(material.s3Key).catch((err) => console.error("[s3] delete failed", err));
  await deleteMaterial(id);
  return NextResponse.json({ ok: true, deletedDecks });
});
