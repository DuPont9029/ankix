import { NextResponse } from "next/server";
import { z } from "zod";
import { TRANSCRIBE_PROVIDERS } from "@/lib/ai/providers";
import { MAX_AUDIO_BYTES, transcribeRecording } from "@/lib/exams";
import { handle, HttpError, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const Fields = z.object({
  provider: z.enum(TRANSCRIBE_PROVIDERS),
  language: z.enum(["it", "en"]),
  hint: z.string().max(1000).optional().default(""),
});

// Esclusa dal proxy (vedi proxy.ts), che bufferizza e tronca i body grandi: la sessione si verifica qui.
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Invalid upload request.");
  }
  const audio = form.get("audio");
  if (!(audio instanceof File)) throw new HttpError(400, "No recording received.");
  if (audio.size > MAX_AUDIO_BYTES) throw new HttpError(413, "The recording is too large to be transcribed.");
  const fields = Fields.parse({ provider: form.get("provider"), language: form.get("language"), hint: form.get("hint") ?? undefined });
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.byteLength !== audio.size) throw new HttpError(400, "The recording arrived incomplete. Please try again.");
  try {
    const transcript = await transcribeRecording(user, fields.provider, { bytes, mimeType: audio.type }, fields.language, fields.hint);
    return NextResponse.json({ transcript });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error("[transcribe]", err);
    throw new HttpError(502, err instanceof Error ? err.message : "The recording could not be transcribed.");
  }
});
