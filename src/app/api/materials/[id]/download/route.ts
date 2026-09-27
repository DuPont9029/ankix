import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { getMaterial } from "@/lib/repo";
import { presignGet } from "@/lib/s3";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/materials/[id]/download">) => {
  await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material) throw new HttpError(404, "Material not found.");
  const url = await presignGet(material.s3Key, material.filename);
  return NextResponse.redirect(url, 302);
});
