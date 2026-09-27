import "server-only";
import { z } from "zod";
import { env } from "./env";
import { resolveMimeType } from "./files";
import { HttpError } from "./http";
import { isSubject } from "./subjects";

export const MaterialMeta = z.object({
  title: z.string().trim().min(1, "Enter a title").max(150),
  subject: z.string().refine(isSubject, "Invalid subject"),
});

export function validateFile(filename: string, declaredType: string | null | undefined, size: number): string {
  const mime = resolveMimeType(filename, declaredType);
  if (!mime) throw new HttpError(415, "Unsupported format. Use PDF, images (PNG, JPG, WEBP, HEIC) or text (TXT, MD).");
  if (!Number.isFinite(size) || size <= 0) throw new HttpError(400, "The file is empty.");
  if (size > env.maxUploadBytes) {
    throw new HttpError(413, `File too large: the limit is ${Math.round(env.maxUploadBytes / 1024 / 1024)} MB.`);
  }
  return mime;
}
