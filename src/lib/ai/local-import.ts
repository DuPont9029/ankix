import "server-only";
import { z } from "zod";
import { CardBody, cleanOcclusions } from "../cards";
import { OCCLUSION_IMAGE_TYPES } from "../files";
import { getMaterialsByIds, type CardInput } from "../repo";
import { sanitizeField, sanitizeTags } from "../sanitize";
import { cleanCards } from "./common";

// Le card generate dal modello locale arrivano dal browser: vengono ripulite come quelle dei provider cloud.

export const LocalCardsBody = z.array(CardBody).min(1, "No cards to save").max(500);

export async function cleanLocalCards(
  raw: z.infer<typeof LocalCardsBody>,
  existingFronts: string[],
  materialIds: string[],
): Promise<CardInput[]> {
  const textual = cleanCards(
    raw
      .filter((c) => c.type !== "image_occlusion")
      .map((c) => ({
        type: c.type,
        front: c.front,
        back: c.back,
        extra: c.extra,
        tags: c.tags,
        choices: c.choices.map((x) => x.text),
        answer_index: c.choices.findIndex((x) => x.correct),
      })),
    { cardCount: 500 },
    existingFronts,
  );

  // Image occlusion: l'immagine deve essere uno dei materiali del mazzo.
  const occlusionCards = raw.filter((c) => c.type === "image_occlusion" && c.imageMaterialId && materialIds.includes(c.imageMaterialId));
  const images = new Set(
    (await getMaterialsByIds([...new Set(occlusionCards.map((c) => c.imageMaterialId!))]))
      .filter((m) => OCCLUSION_IMAGE_TYPES.includes(m.mimeType))
      .map((m) => m.id),
  );
  const occlusions: CardInput[] = [];
  for (const c of occlusionCards) {
    const masks = cleanOcclusions(c.occlusions);
    if (!images.has(c.imageMaterialId!) || masks.length === 0) continue;
    occlusions.push({
      type: "image_occlusion",
      front: sanitizeField(c.front).replace(/<[^>]+>/g, "").slice(0, 300),
      back: "",
      extra: sanitizeField(c.extra),
      tags: sanitizeTags(c.tags),
      imageMaterialId: c.imageMaterialId!,
      occlusions: masks,
    });
  }
  return [...textual, ...occlusions];
}
