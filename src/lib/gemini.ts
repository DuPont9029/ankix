import "server-only";
import { ApiError, FileState, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { hasCloze } from "./cloze";
import { env } from "./env";
import { isTextMime } from "./files";
import type { CardInput } from "./repo";
import { sanitizeField, sanitizeTags } from "./sanitize";
import type { GenerationOptions } from "./types";

export type SourceFile = {
  title: string;
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

export type GenerationResult = {
  title: string;
  description: string;
  cards: CardInput[];
  model: string;
};

const INLINE_FILE_LIMIT = 8 * 1024 * 1024; // oltre questa soglia usa la Files API
const INLINE_TOTAL_LIMIT = 14 * 1024 * 1024; // la richiesta inline non può superare ~20 MB (base64)
const MAX_TEXT_CHARS = 800_000;

/** Client Gemini con la chiave personale dello studente (mai condivisa né salvata sul server). */
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

/** Verifica che la chiave sia valida e abbia accesso al modello configurato. */
export async function verifyApiKey(apiKey: string): Promise<void> {
  try {
    await createAi(apiKey).models.get({ model: env.geminiModel });
  } catch (err) {
    if (isInvalidKeyError(err)) throw new Error("Invalid key: make sure you copied it in full from Google AI Studio.");
    throw friendlyError(err);
  }
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short, specific title for the deck" },
    description: { type: "string", description: "One or two sentences describing the topics covered" },
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["basic", "cloze"] },
          front: { type: "string", description: "Question (basic) or text with {{c1::...}} deletions (cloze)" },
          back: { type: "string", description: "Answer (basic). Empty string for cloze cards." },
          extra: { type: "string", description: "Context, clinical correlation or mnemonic. May be empty." },
          tags: { type: "array", items: { type: "string" }, description: "1-3 topic tags" },
        },
        required: ["type", "front", "back", "extra", "tags"],
      },
    },
  },
  required: ["title", "description", "cards"],
};

const ResponseSchema = z.object({
  title: z.string().catch(""),
  description: z.string().catch(""),
  cards: z.array(
    z.object({
      type: z.string().catch("basic"),
      front: z.string().catch(""),
      back: z.string().catch(""),
      extra: z.string().catch(""),
      tags: z.array(z.string()).catch([]),
    }),
  ),
});

const DIFFICULTY: Record<GenerationOptions["difficulty"], string> = {
  base: "BASIC level: definitions, fundamental concepts and high-yield facts, suitable for a first study pass.",
  intermedio:
    "INTERMEDIATE level: mechanisms, cause-effect relationships, classifications and comparisons between concepts, as required in a university exam.",
  avanzato:
    "ADVANCED level: fine details, exceptions, numeric reference values, pathophysiological and clinical correlations, integrated reasoning as in residency exams.",
};

const CARD_TYPE: Record<GenerationOptions["cardType"], string> = {
  basic: 'Use ONLY "basic" cards (question/answer).',
  cloze: 'Use ONLY "cloze" cards (text with deletions).',
  mixed:
    'Use a mix: about 60% "basic" for conceptual questions and 40% "cloze" for definitions, short lists, values and terminology.',
};

function systemInstruction(language: GenerationOptions["language"]): string {
  const lang = language === "it" ? "in ITALIAN (correct Italian medical terminology)" : "in ENGLISH (correct English medical terminology)";
  return `You are a university Medicine lecturer and an expert in spaced-repetition learning (Anki).
Your task is to turn the provided study material into top-quality flashcards for Medicine and Surgery students.

Mandatory rules:
1. Rely EXCLUSIVELY on the provided material. Do not invent data, values or statements that are not present in or directly deducible from the text. If the material contains obvious errors, do not reproduce them.
2. Minimum information principle: each card tests ONE concept only. Short answers (ideally < 25 words). No long lists: split them into several cards.
3. Unambiguous, self-contained questions: each card must be understandable without the context of the others (always specify the organ, structure, drug or disease it refers to).
4. Favour high-yield exam content: mechanisms, classifications, signs and symptoms, differential diagnosis, drugs (mechanism, indications, adverse effects), reference values, anatomo-clinical correlations.
5. "basic" cards: "front" = question, "back" = answer. "cloze" cards: "front" = full sentence with 1-3 deletions in the format {{c1::text}} ({{c2::...}} for the second, etc.), optionally with a hint {{c1::text::hint}}; "back" = empty string. Never put the whole sentence inside a deletion.
6. "extra" (optional): short context, clinical correlation or useful mnemonic; leave it empty if it adds no value.
7. "tags": 1-3 short topic tags, without spaces (use underscores), e.g. "Cardiac_cycle", "Nephron::Loop_of_Henle".
8. Formatting: plain text; you may only use the HTML tags <b>, <i>, <u>, <sub>, <sup>, <br>, <ul>, <li>. For chemical formulas use <sub>/<sup> (e.g. H<sub>2</sub>O, Ca<sup>2+</sup>). No Markdown.
9. No duplicate or near-duplicate cards.
10. Write everything ${lang}, regardless of the language of the material.`;
}

function userPrompt(opts: GenerationOptions, subject: string, sources: SourceFile[], existing: string[]): string {
  const list = sources.map((s, i) => `${i + 1}. "${s.title}" (${s.filename})`).join("\n");
  return `Subject: ${subject}
Attached materials:
${list}

Generate exactly ${opts.cardCount} flashcards (or fewer only if the material does not contain enough distinct content).
${CARD_TYPE[opts.cardType]}
${DIFFICULTY[opts.difficulty]}
Spread the cards across all the main topics of the materials, following the logical order of the topics.${
    opts.focus.trim()
      ? `\n\nAdditional instructions from the student (follow them if compatible with the rules):\n"""${opts.focus.trim()}"""`
      : ""
  }${
    existing.length
      ? `\n\nThe deck already contains these cards: do NOT repeat them and cover different concepts:\n${existing
          .slice(0, 300)
          .map((f) => `- ${f.slice(0, 200)}`)
          .join("\n")}`
      : ""
  }

Also propose a concise title for the deck and a short description.
Reply only with a JSON object that matches the requested schema ({"title", "description", "cards": [...]}).`;
}

async function waitUntilActive(ai: GoogleGenAI, name: string): Promise<void> {
  const deadline = Date.now() + 3 * 60 * 1000;
  for (;;) {
    const file = await ai.files.get({ name });
    if (file.state === FileState.ACTIVE) return;
    if (file.state === FileState.FAILED) {
      throw new Error(`Gemini could not process the file: ${file.error?.message ?? "unknown error"}`);
    }
    if (Date.now() > deadline) throw new Error("Timed out while Gemini was processing the file.");
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function buildParts(ai: GoogleGenAI, sources: SourceFile[], uploaded: string[]): Promise<Part[]> {
  const parts: Part[] = [];
  let inlineTotal = 0;
  for (const src of sources) {
    parts.push({ text: `\n=== MATERIAL: "${src.title}" (${src.filename}) ===` });
    if (isTextMime(src.mimeType)) {
      let text = new TextDecoder("utf-8").decode(src.bytes);
      if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
      parts.push({ text });
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
    if (!file.name || !file.uri) throw new Error("Uploading the file to Gemini failed.");
    uploaded.push(file.name);
    await waitUntilActive(ai, file.name);
    parts.push({ fileData: { fileUri: file.uri, mimeType: file.mimeType ?? src.mimeType } });
  }
  return parts;
}

function friendlyError(err: unknown): Error {
  if (err instanceof ApiError) {
    if (err.status === 429) return new Error("Gemini request limit reached (quota). Try again in a few minutes.");
    if (isInvalidKeyError(err)) {
      return new Error("Your Gemini key is invalid or lacks the required permissions: update it in Settings.");
    }
    if (err.status === 404) return new Error(`Gemini model "${env.geminiModel}" not found: check GEMINI_MODEL.`);
    if (err.status === 400) return new Error(`Request rejected by Gemini: ${err.message}`);
    if (err.status >= 500) return new Error("The Gemini service is temporarily unavailable. Try again.");
  }
  if (err instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(`${err.message} ${String(err.cause ?? "")}`)) {
    return new Error("Could not reach Gemini: check the server connection.");
  }
  return err instanceof Error ? err : new Error(String(err));
}

function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true; // errore di rete transitorio
  return err instanceof ApiError && (err.status === 429 || err.status >= 500);
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function normalizeKey(s: string): string {
  return s.replace(/<[^>]+>/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export function cleanCards(
  raw: z.infer<typeof ResponseSchema>["cards"],
  opts: Pick<GenerationOptions, "cardCount">,
  existing: string[] = [],
): CardInput[] {
  const seen = new Set<string>(existing.map(normalizeKey));
  const out: CardInput[] = [];
  for (const c of raw) {
    const front = sanitizeField(c.front);
    const back = sanitizeField(c.back);
    const extra = sanitizeField(c.extra);
    const tags = sanitizeTags(c.tags);
    let type: CardInput["type"] = c.type === "cloze" ? "cloze" : "basic";
    if (type === "cloze" && !hasCloze(front)) {
      if (!back) continue; // cloze senza cancellature e senza risposta: inutilizzabile
      type = "basic";
    }
    if (type === "basic" && hasCloze(front) && !back) type = "cloze";
    if (!front || (type === "basic" && !back)) continue;
    const key = normalizeKey(front);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, front, back: type === "cloze" ? "" : back, extra, tags });
    if (out.length >= opts.cardCount) break;
  }
  return out;
}

// Limita le generazioni simultanee per chiave, per non esaurire la quota dello studente.
const MAX_CONCURRENT_PER_KEY = 2;
const globalForQueue = globalThis as unknown as {
  __ankixGenSlots?: Map<string, { active: number; waiters: (() => void)[] }>;
};

async function acquire(apiKey: string): Promise<() => void> {
  const slots = (globalForQueue.__ankixGenSlots ??= new Map());
  let slot = slots.get(apiKey);
  if (!slot) {
    slot = { active: 0, waiters: [] };
    slots.set(apiKey, slot);
  }
  while (slot.active >= MAX_CONCURRENT_PER_KEY) {
    await new Promise<void>((resolve) => slot!.waiters.push(resolve));
  }
  slot.active++;
  return () => {
    slot!.active--;
    const next = slot!.waiters.shift();
    if (next) next();
    else if (slot!.active === 0) slots.delete(apiKey);
  };
}

export async function generateFlashcards(
  sources: SourceFile[],
  opts: GenerationOptions,
  subject: string,
  apiKey: string,
  existingFronts: string[] = [],
): Promise<GenerationResult> {
  const release = await acquire(apiKey);
  const ai = createAi(apiKey);
  const model = env.geminiModel;
  const uploaded: string[] = [];
  try {
    const parts = await buildParts(ai, sources, uploaded);
    parts.push({ text: userPrompt(opts, subject, sources, existingFronts.map(normalizeKey)) });

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: systemInstruction(opts.language),
            responseMimeType: "application/json",
            responseJsonSchema: RESPONSE_SCHEMA,
            temperature: 0.4,
          },
        });

        const candidate = response.candidates?.[0];
        const reason = candidate?.finishReason;
        if (response.promptFeedback?.blockReason) {
          throw new Error(`Gemini blocked the request (${response.promptFeedback.blockReason}).`);
        }
        if (reason === "MAX_TOKENS") {
          throw new Error("Gemini's response was truncated: reduce the number of cards or split the material.");
        }
        if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "RECITATION") {
          throw new Error(`Gemini stopped the response (${reason}). Try a different material.`);
        }
        const text = response.text;
        if (!text) throw new Error("Gemini returned an empty response.");

        let parsed: z.infer<typeof ResponseSchema>;
        try {
          parsed = ResponseSchema.parse(extractJson(text));
        } catch {
          throw new Error("Gemini returned an invalid format.");
        }
        const cards = cleanCards(parsed.cards, opts, existingFronts);
        if (cards.length === 0) {
          throw new Error(
            existingFronts.length
              ? "No new flashcards: the material seems to be already covered by the deck."
              : "No valid flashcards could be generated from the material.",
          );
        }
        return {
          title: sanitizeField(parsed.title).replace(/<[^>]+>/g, "").slice(0, 120),
          description: sanitizeField(parsed.description).replace(/<[^>]+>/g, "").slice(0, 500),
          cards,
          model,
        };
      } catch (err) {
        lastError = err;
        const retry = isRetryable(err) || (err instanceof Error && err.message.includes("invalid format"));
        if (!retry || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      }
    }
    throw friendlyError(lastError);
  } catch (err) {
    throw friendlyError(err);
  } finally {
    release();
    for (const name of uploaded) {
      ai.files.delete({ name }).catch(() => undefined);
    }
  }
}
