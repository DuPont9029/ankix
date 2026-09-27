import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { deleteMaterial, getMaterial } from "@/lib/repo";
import { deleteObject } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const DELETE = handle(async (_req: NextRequest, ctx: RouteContext<"/api/materials/[id]">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material) throw new HttpError(404, "Material not found.");
  if (material.uploadedById !== user.id) {
    throw new HttpError(403, "You can only delete materials you uploaded.");
  }
  await deleteObject(material.s3Key).catch((err) => console.error("[s3] delete failed", err));
  await deleteMaterial(id);
  return NextResponse.json({ ok: true });
});
