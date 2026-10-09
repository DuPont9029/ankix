import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { canSeeMaterial, getMaterial } from "@/lib/repo";
import { presignGet } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/materials/[id]/download">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  // Anche le immagini private usate nelle card di un mazzo che l'utente può aprire (image occlusion).
  if (!material || !(await canSeeMaterial(material, user.id))) throw new HttpError(404, "Material not found.");
  const url = await presignGet(material.s3Key, material.filename);
  return NextResponse.redirect(url, 302);
});
