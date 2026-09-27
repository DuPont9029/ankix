import type { NextRequest } from "next/server";
import { buildApkg, buildCsv } from "@/lib/anki";
import { loadDeck } from "@/lib/decks";
import { handle, HttpError, requireUser } from "@/lib/http";
import { getMaterial, listCards } from "@/lib/repo";
import { getObjectBytesIfExists } from "@/lib/s3";
import { contentDisposition } from "@/lib/s3";

export const dynamic = "force-dynamic";

function fileBase(title: string): string {
  return title.replace(/[\\/:*?"<>|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "deck";
}

export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/decks/[id]/export">) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const format = req.nextUrl.searchParams.get("format") ?? "apkg";
  const deck = await loadDeck(id, user, "view");
  const cards = await listCards(id);
  if (cards.length === 0) throw new HttpError(400, "The deck has no cards to export.");

  if (format === "csv") {
    return new Response(buildCsv(deck, cards), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition(`${fileBase(deck.title)}.csv`),
        "Cache-Control": "no-store",
      },
    });
  }
  if (format !== "apkg") throw new HttpError(400, "Unsupported export format.");

  const data = await buildApkg(deck, cards, async (materialId) => {
    const material = await getMaterial(materialId);
    if (!material) return null;
    const bytes = await getObjectBytesIfExists(material.s3Key);
    return bytes ? { bytes, mimeType: material.mimeType } : null;
  });
  return new Response(data as Uint8Array<ArrayBuffer>, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": contentDisposition(`${fileBase(deck.title)}.apkg`),
      "Content-Length": String(data.byteLength),
      "Cache-Control": "no-store",
    },
  });
});
