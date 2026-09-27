import "server-only";
import { z } from "zod";
import { hasCloze } from "./cloze";
import { HttpError } from "./http";
import type { CardInput } from "./repo";
import { sanitizeField, sanitizeTags } from "./sanitize";

export const CardBody = z.object({
  type: z.enum(["basic", "cloze"]),
  front: z.string().max(5000),
  back: z.string().max(5000).optional().default(""),
  extra: z.string().max(5000).optional().default(""),
  tags: z.array(z.string().max(80)).max(20).optional().default([]),
});

export function toCardInput(body: z.infer<typeof CardBody>): CardInput {
  const front = sanitizeField(body.front);
  const back = sanitizeField(body.back);
  const extra = sanitizeField(body.extra);
  if (!front) throw new HttpError(400, body.type === "cloze" ? "The cloze text is required." : "The front is required.");
  if (body.type === "cloze" && !hasCloze(front)) {
    throw new HttpError(400, "A cloze card must contain at least one deletion, e.g. {{c1::answer}}.");
  }
  if (body.type === "basic" && !back) throw new HttpError(400, "The back is required.");
  return { type: body.type, front, back: body.type === "cloze" ? "" : back, extra, tags: sanitizeTags(body.tags) };
}
