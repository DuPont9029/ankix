import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { cleanChoices } from "../cards";
import { hasCloze } from "../cloze";
import type { CardInput } from "../repo";
import { sanitizeField, sanitizeTags } from "../sanitize";
import type { GenerationOptions, Occlusion } from "../types";
import { mixCounts } from "./mix";

// Prompt, schemi JSON e pulizia dell'output condivisi da tutti i provider cloud.

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

export type JsonSchema = Record<string, unknown>;

/** Errore già comprensibile per lo studente: non va riformulato né ritentato. */
export class AiError extends Error {}

export const MAX_TEXT_CHARS = 800_000;

export function decodeText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

export function materialHeader(src: Pick<SourceFile, "title" | "filename">): string {
  return `\n=== MATERIAL: "${src.title}" (${src.filename}) ===`;
}

// Gli schemi sono scritti nella forma "strict" (additionalProperties: false, tutti i campi required)
// richiesta da Claude e OpenAI; per Gemini additionalProperties viene rimosso.
export const CARD_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["basic", "cloze", "mcq"] },
    front: { type: "string", description: "Question (basic, mcq) or text with {{c1::...}} deletions (cloze)" },
    back: { type: "string", description: "Answer (basic). Empty string for cloze and mcq cards." },
    extra: {
      type: "string",
      description: "Context, clinical correlation or mnemonic; for mcq a one-sentence explanation of the correct answer. May be empty.",
    },
    tags: { type: "array", items: { type: "string" }, description: "1-3 topic tags" },
    choices: { type: "array", items: { type: "string" }, description: "mcq only: exactly 4 options. Empty array for other types." },
    answer_index: { type: "integer", description: "mcq only: 0-based index of the correct option in choices. -1 for other types." },
  },
  required: ["type", "front", "back", "extra", "tags", "choices", "answer_index"],
  additionalProperties: false,
};

export const RESPONSE_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short, specific title for the deck" },
    description: { type: "string", description: "One or two sentences describing the topics covered" },
    cards: { type: "array", items: CARD_SCHEMA },
  },
  required: ["title", "description", "cards"],
  additionalProperties: false,
};

export function withoutAdditionalProperties(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutAdditionalProperties);
  if (schema && typeof schema === "object") {
    return Object.fromEntries(
      Object.entries(schema)
        .filter(([k]) => k !== "additionalProperties")
        .map(([k, v]) => [k, withoutAdditionalProperties(v)]),
    );
  }
  return schema;
}

export const RawCard = z.object({
  type: z.string().catch("basic"),
  front: z.string().catch(""),
  back: z.string().catch(""),
  extra: z.string().catch(""),
  tags: z.array(z.string()).catch([]),
  choices: z.array(z.string()).catch([]),
  answer_index: z.number().catch(-1),
});
export type RawCard = z.infer<typeof RawCard>;

export const ResponseSchema = z.object({
  title: z.string().catch(""),
  description: z.string().catch(""),
  cards: z.array(RawCard),
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
  mixed: "", // numeri esatti per tipo, calcolati in userPrompt
  mcq: 'Use ONLY "mcq" cards (multiple-choice questions with exactly 4 options and one correct answer).',
  image_occlusion: "", // generato con generateImageOcclusions
};

export function systemInstruction(language: GenerationOptions["language"]): string {
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
7. "mcq" cards: "front" = question, "choices" = exactly 4 options, "answer_index" = index of the only correct option, "back" = empty string, "extra" = one sentence explaining why the answer is correct. The wrong options must be plausible (same category as the correct one: other drugs, other nerves, other values…) but clearly wrong according to the material; never use "all of the above" or "none of the above". For "basic" and "cloze" cards use "choices": [] and "answer_index": -1.
8. "tags": 1-3 short topic tags, without spaces (use underscores), e.g. "Cardiac_cycle", "Nephron::Loop_of_Henle".
9. Formatting: plain text; you may only use the HTML tags <b>, <i>, <u>, <sub>, <sup>, <br>, <ul>, <li>. For chemical formulas use <sub>/<sup> (e.g. H<sub>2</sub>O, Ca<sup>2+</sup>). No Markdown.
10. No duplicate or near-duplicate cards.
11. Write everything ${lang}, regardless of the language of the material.`;
}

function mixedInstruction(total: number): string {
  const { basic, cloze, mcq } = mixCounts(total);
  return `Use exactly this mix: ${basic} "basic" cards for conceptual questions, ${cloze} "cloze" cards for definitions, short lists, values and terminology, and ${mcq} "mcq" cards for concepts that are easily confused with similar ones (drugs, structures, values, differential diagnoses). The ${mcq} "mcq" cards are mandatory.`;
}

export function userPrompt(opts: GenerationOptions, subject: string, sources: SourceFile[], existing: string[]): string {
  const list = sources.map((s, i) => `${i + 1}. "${s.title}" (${s.filename})`).join("\n");
  return `Subject: ${subject}
Attached materials:
${list}

Generate exactly ${opts.cardCount} flashcards (or fewer only if the material does not contain enough distinct content).
${opts.cardType === "mixed" ? mixedInstruction(opts.cardCount) : CARD_TYPE[opts.cardType]}
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

export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Alcuni modelli (es. via OpenRouter) aggiungono testo prima o dopo il JSON.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new AiError("The AI returned an invalid format.");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function normalizeKey(s: string): string {
  return s.replace(/<[^>]+>/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cleanCards(raw: RawCard[], opts: Pick<GenerationOptions, "cardCount">, existing: string[] = []): CardInput[] {
  const seen = new Set<string>(existing.map(normalizeKey));
  const out: CardInput[] = [];
  for (const c of raw) {
    const front = sanitizeField(c.front);
    const back = sanitizeField(c.back);
    const extra = sanitizeField(c.extra);
    const tags = sanitizeTags(c.tags);
    if (c.type === "mcq") {
      // I modelli tendono a mettere la risposta giusta sempre nella stessa posizione: le opzioni vengono mescolate.
      const choices = cleanChoices(shuffle(c.choices.map((text, i) => ({ text, correct: i === c.answer_index }))));
      const key = normalizeKey(front);
      if (!front || !choices || seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "mcq", front, back: choices.find((x) => x.correct)!.text, extra, tags, choices });
      if (out.length >= opts.cardCount) break;
      continue;
    }
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

// ---------- Image occlusion ----------

export type OcclusionImage = SourceFile & { materialId: string };

export const OCCLUSION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    header: { type: "string", description: "Short prompt shown above the image, e.g. 'Label the chambers and valves of the heart'" },
    back_extra: { type: "string", description: "Optional short note shown on the back. Can be empty." },
    tags: { type: "array", items: { type: "string" }, description: "1-3 topic tags" },
    masks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "The term hidden by the mask (the answer)" },
          box_2d: {
            type: "array",
            items: { type: "integer" },
            description: "Bounding box [ymin, xmin, ymax, xmax] normalized to 0-1000",
          },
        },
        required: ["label", "box_2d"],
        additionalProperties: false,
      },
    },
  },
  required: ["header", "back_extra", "tags", "masks"],
  additionalProperties: false,
};

export const OcclusionResponse = z.object({
  header: z.string().catch(""),
  back_extra: z.string().catch(""),
  tags: z.array(z.string()).catch([]),
  masks: z.array(z.object({ label: z.string().catch(""), box_2d: z.array(z.number()).catch([]) })).catch([]),
});

export function occlusionPrompt(opts: GenerationOptions, subject: string, image: OcclusionImage, maxMasks: number): string {
  const lang = opts.language === "it" ? "ITALIAN" : "ENGLISH";
  return `Subject: ${subject}
Image: "${image.title}" (${image.filename})

Create an Anki IMAGE OCCLUSION card for this medical image (anatomical plate, histology slide, diagram, chart…).
1. Find the text labels written on the image (names of structures, often connected by leader lines). For each one,
   return a mask whose box_2d tightly covers THAT TEXT LABEL, so that the student has to recall the term.
2. If the image has no written labels, instead mask the most important structures themselves (only if you are sure of their name).
3. Never mask legends, titles, scale bars or decorative elements. Masks must not overlap.
4. At most ${maxMasks} masks, choosing the most high-yield structures. Skip anything illegible or uncertain.
5. "label" = the exact term hidden by the mask, written in ${lang} with correct medical terminology (translate the label if needed).
6. "header" = a short task in ${lang}, e.g. "Identify the labelled structures of the brachial plexus".
7. "back_extra" = an optional one-line clinical or anatomical note in ${lang}; empty string if not useful.
8. box_2d = [ymin, xmin, ymax, xmax], integers normalized to 0-1000 relative to the image size.${
    opts.focus.trim() ? `\n\nAdditional instructions from the student (follow them if compatible with the rules):\n"""${opts.focus.trim()}"""` : ""
  }

Reply only with a JSON object matching the requested schema.`;
}

/** Converte i box (0-1000, [ymin, xmin, ymax, xmax]) in maschere relative 0-1 con un piccolo margine. */
export function boxesToOcclusions(masks: { label: string; box_2d: number[] }[], maxMasks: number): Occlusion[] {
  const out: Occlusion[] = [];
  const seen = new Set<string>();
  for (const m of masks) {
    if (m.box_2d.length !== 4) continue;
    let [ymin, xmin, ymax, xmax] = m.box_2d.map((v) => Math.min(Math.max(v, 0), 1000) / 1000);
    if (ymax < ymin) [ymin, ymax] = [ymax, ymin];
    if (xmax < xmin) [xmin, xmax] = [xmax, xmin];
    const pad = 0.004;
    const x = Math.max(0, xmin - pad);
    const y = Math.max(0, ymin - pad);
    const w = Math.min(1, xmax + pad) - x;
    const h = Math.min(1, ymax + pad) - y;
    if (w < 0.008 || h < 0.008 || w * h > 0.5) continue; // troppo piccola o grande quasi quanto l'immagine
    const label = sanitizeField(m.label).replace(/<[^>]+>/g, "").trim().slice(0, 200);
    if (!label) continue;
    const key = `${label.toLowerCase()}|${Math.round(x * 100)}|${Math.round(y * 100)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: randomUUID().slice(0, 8), label, x, y, w, h });
    if (out.length >= maxMasks) break;
  }
  return out;
}
