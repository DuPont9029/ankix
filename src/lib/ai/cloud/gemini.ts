import "server-only";
import { ApiError, FileState, GoogleGenAI, ThinkingLevel, type Part } from "@google/genai";
import { isTextMime } from "../../files";
import { AiError, decodeText, materialHeader, withoutAdditionalProperties, type SourceFile } from "../common";
import { httpErrorMessage, isNetworkError, type AudioRequest, type CloudBackend } from "./backend";

const INLINE_FILE_LIMIT = 8 * 1024 * 1024; // oltre questa soglia usa la Files API
const INLINE_TOTAL_LIMIT = 14 * 1024 * 1024; // la richiesta inline non può superare ~20 MB (base64)

function createAi(apiKey: string): GoogleGenAI {
  const baseUrl = process.env.GEMINI_BASE_URL?.trim();
  return new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) });
}

function isInvalidKeyError(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.status === 401 || err.status === 403 || (err.status === 400 && /API[_ ]key|API_KEY_INVALID/i.test(err.message)))
  );
}

async function waitUntilActive(ai: GoogleGenAI, name: string): Promise<void> {
  const deadline = Date.now() + 3 * 60 * 1000;
  for (;;) {
    const file = await ai.files.get({ name });
    if (file.state === FileState.ACTIVE) return;
    if (file.state === FileState.FAILED) {
      throw new AiError(`Gemini could not process the file: ${file.error?.message ?? "unknown error"}`);
    }
    if (Date.now() > deadline) throw new AiError("Timed out while Gemini was processing the file.");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function buildParts(ai: GoogleGenAI, sources: SourceFile[], uploaded: string[], headers = true): Promise<Part[]> {
  const parts: Part[] = [];
  let inlineTotal = 0;
  for (const src of sources) {
    if (headers) parts.push({ text: materialHeader(src) });
    if (isTextMime(src.mimeType)) {
      parts.push({ text: decodeText(src.bytes) });
      continue;
    }
    const size = src.bytes.byteLength;
    if (size <= INLINE_FILE_LIMIT && inlineTotal + size <= INLINE_TOTAL_LIMIT) {
      inlineTotal += size;
      parts.push({ inlineData: { mimeType: src.mimeType, data: Buffer.from(src.bytes).toString("base64") } });
      continue;
    }
    const blob = new Blob([src.bytes as Uint8Array<ArrayBuffer>], { type: src.mimeType });
    const file = await ai.files.upload({
      file: blob,
      config: { mimeType: src.mimeType, displayName: src.filename.slice(0, 100) },
    });
    if (!file.name || !file.uri) throw new AiError("Uploading the file to Gemini failed.");
    uploaded.push(file.name);
    await waitUntilActive(ai, file.name);
    parts.push({ fileData: { fileUri: file.uri, mimeType: file.mimeType ?? src.mimeType } });
  }
  return parts;
}

function transcriptionPrompt(req: AudioRequest): string {
  const lang = req.language === "it" ? "Italian" : "English";
  return `This is the recording of a university student's oral exam (spoken mostly in ${lang}). Transcribe it verbatim.
- Output only the transcript as plain paragraphs: no timestamps, speaker labels, headings or comments.
- Leave out filler sounds (ehm, uhm) and false starts, but NEVER correct what the student says: wrong statements must be transcribed as spoken.
- Write technical and medical terms correctly. Context of the exam: ${req.hint}
- If the recording contains no speech, output nothing.`;
}

export const gemini: CloudBackend = {
  async verify(apiKey, model) {
    try {
      await createAi(apiKey).models.get({ model });
    } catch (err) {
      if (isInvalidKeyError(err)) throw new Error("Invalid key: make sure you copied it in full from Google AI Studio.");
      throw gemini.friendlyError(err, model);
    }
  },

  async generateJson(apiKey, model, req) {
    const ai = createAi(apiKey);
    const uploaded: string[] = [];
    try {
      const parts = await buildParts(ai, req.sources, uploaded);
      parts.push({ text: req.prompt });
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          ...(req.system ? { systemInstruction: req.system } : {}),
          responseMimeType: "application/json",
          responseJsonSchema: withoutAdditionalProperties(req.schema),
          temperature: req.temperature,
          // Il livello di ragionamento esiste solo dai modelli Gemini 3.
          ...(req.effort && /^gemini-3/.test(model) ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        },
      });
      if (response.promptFeedback?.blockReason) {
        throw new AiError(`Gemini blocked the request (${response.promptFeedback.blockReason}).`);
      }
      const reason = response.candidates?.[0]?.finishReason;
      if (reason === "MAX_TOKENS") {
        throw new AiError("Gemini's response was truncated: reduce the number of cards or split the material.");
      }
      if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "RECITATION") {
        throw new AiError(`Gemini stopped the response (${reason}). Try a different material.`);
      }
      const text = response.text;
      if (!text) throw new AiError("Gemini returned an empty response.");
      return text;
    } finally {
      for (const name of uploaded) ai.files.delete({ name }).catch(() => undefined);
    }
  },

  async transcribe(apiKey, model, req) {
    const ai = createAi(apiKey);
    const uploaded: string[] = [];
    try {
      const parts = await buildParts(ai, [req.audio], uploaded, false);
      parts.push({ text: transcriptionPrompt(req) });
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: { temperature: 0 },
      });
      if (response.promptFeedback?.blockReason) {
        throw new AiError(`Gemini blocked the recording (${response.promptFeedback.blockReason}).`);
      }
      const reason = response.candidates?.[0]?.finishReason;
      if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "RECITATION") {
        throw new AiError(`Gemini stopped the transcription (${reason}). Try another transcription engine.`);
      }
      return response.text?.trim() ?? "";
    } finally {
      for (const name of uploaded) ai.files.delete({ name }).catch(() => undefined);
    }
  },

  friendlyError(err, model) {
    if (err instanceof ApiError) {
      if (isInvalidKeyError(err)) return new Error("Your Gemini key is invalid or lacks the required permissions: update it in Settings.");
      const mapped = httpErrorMessage("Gemini", err.status, err.message, model);
      if (mapped) return mapped;
    }
    if (isNetworkError(err)) return new Error("Could not reach Gemini: check the server connection.");
    return err instanceof Error ? err : new Error(String(err));
  },

  isRetryable(err) {
    if (err instanceof TypeError) return true; // errore di rete transitorio
    return err instanceof ApiError && (err.status === 429 || err.status >= 500);
  },
};
