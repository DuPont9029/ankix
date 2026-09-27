import "server-only";
import { z } from "zod";
import { hasCloze } from "./cloze";
import { HttpError } from "./http";
import { OCCLUSION_IMAGE_TYPES } from "./files";
import { getMaterial, type CardInput } from "./repo";
import { sanitizeField, sanitizeTags } from "./sanitize";
import type { Occlusion } from "./types";

const OcclusionBody = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(200),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().gt(0).max(1),
  h: z.number().gt(0).max(1),
});

export const CardBody = z.object({
  type: z.enum(["basic", "cloze", "image_occlusion"]),
  front: z.string().max(5000),
  back: z.string().max(5000).optional().default(""),
  extra: z.string().max(5000).optional().default(""),
  tags: z.array(z.string().max(80)).max(20).optional().default([]),
  imageMaterialId: z.uuid().nullable().optional(),
  occlusions: z.array(OcclusionBody).max(60).optional().default([]),
});

/** Maschere valide: dentro l'immagine, non microscopiche, etichette sanificate. */
export function cleanOcclusions(list: Occlusion[]): Occlusion[] {
  const out: Occlusion[] = [];
  for (const o of list) {
    const x = Math.min(Math.max(o.x, 0), 1);
    const y = Math.min(Math.max(o.y, 0), 1);
    const w = Math.min(o.w, 1 - x);
    const h = Math.min(o.h, 1 - y);
    if (w < 0.005 || h < 0.005) continue;
    const label = sanitizeField(o.label).replace(/<[^>]+>/g, "").slice(0, 200);
    out.push({ id: o.id.slice(0, 64), label, x, y, w, h });
  }
  return out.slice(0, 60);
}

export function toCardInput(body: z.infer<typeof CardBody>): CardInput {
  const front = sanitizeField(body.front);
  const back = sanitizeField(body.back);
  const extra = sanitizeField(body.extra);
  const tags = sanitizeTags(body.tags);
  if (body.type === "image_occlusion") {
    if (!body.imageMaterialId) throw new HttpError(400, "An image occlusion card needs an image.");
    const occlusions = cleanOcclusions(body.occlusions);
    if (occlusions.length === 0) throw new HttpError(400, "Add at least one mask to the image.");
    return { type: "image_occlusion", front, back: "", extra, tags, imageMaterialId: body.imageMaterialId, occlusions };
  }
  if (!front) throw new HttpError(400, body.type === "cloze" ? "The cloze text is required." : "The front is required.");
  if (body.type === "cloze" && !hasCloze(front)) {
    throw new HttpError(400, "A cloze card must contain at least one deletion, e.g. {{c1::answer}}.");
  }
  if (body.type === "basic" && !back) throw new HttpError(400, "The back is required.");
  return { type: body.type, front, back: body.type === "cloze" ? "" : back, extra, tags };
}

/** Per le card image occlusion: l'immagine deve esistere ed essere PNG, JPG o WEBP. */
export async function assertOcclusionImage(input: CardInput): Promise<void> {
  if (input.type !== "image_occlusion") return;
  const material = input.imageMaterialId ? await getMaterial(input.imageMaterialId) : null;
  if (!material) throw new HttpError(400, "The image for this card no longer exists.");
  if (!OCCLUSION_IMAGE_TYPES.includes(material.mimeType)) throw new HttpError(400, "Image occlusion works with PNG, JPG or WEBP images.");
}
