import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { getMaterial } from "@/lib/repo";
import { getObjectBytes, presignGet } from "@/lib/s3";

export const dynamic = "force-dynamic";

// Contenuto di un materiale per il modello locale, che lo legge nel browser.
// `?presign=1` restituisce un URL prefirmato per scaricarlo direttamente dal bucket (serve il CORS del bucket);
// altrimenti i byte passano dal server, come ripiego (sotto il limite di 4,5 MB delle funzioni Vercel).
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/materials/[id]/content">) => {
  await requireUser();
  const { id } = await ctx.params;
  const material = await getMaterial(id);
  if (!material) throw new HttpError(404, "Material not found.");
  if (req.nextUrl.searchParams.get("presign") === "1") {
    return NextResponse.json({ url: await presignGet(material.s3Key, material.filename) });
  }
  const bytes = await getObjectBytes(material.s3Key);
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: { "Content-Type": material.mimeType, "Cache-Control": "private, no-store" },
  });
});
