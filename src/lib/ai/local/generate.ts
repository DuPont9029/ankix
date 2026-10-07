// Generazione di flashcard e image occlusion con il modello locale, interamente nel browser.
// Un modello piccolo con contesto di 8192 token: il materiale è diviso in blocchi, ognuno elaborato
// in una conversazione nuova, e l'output usa un formato a righe ("Q:/A:/C:") più robusto del JSON.

import { OCCLUSION_IMAGE_TYPES } from "../../files";
import type { Choice, GenerationOptions, Occlusion } from "../../types";
import { mixCounts } from "../mix";
import { AbortedError, ensureEngine, runPrompt } from "./engine";
import { fetchMaterial, imageToCanvas, materialText, ocr, type LocalMaterial, type OcrBox } from "./extract";

export type LocalCard = {
  type: "basic" | "cloze" | "mcq" | "image_occlusion";
  front: string;
  back: string;
  extra: string;
  tags: string[];
  imageMaterialId?: string;
  occlusions?: Occlusion[];
  choices?: Choice[];
};

export type LocalProgress = {
  /** Fase corrente, per l'interfaccia */
  phase: "model" | "reading" | "generating";
  message: string;
  step: number;
  steps: number;
  cards: number;
};

export type LocalRunResult = { cards: LocalCard[]; stopped: boolean; warnings: string[] };

type RunArgs = {
  materials: LocalMaterial[];
  options: Pick<GenerationOptions, "cardCount" | "cardType" | "difficulty" | "language" | "focus">;
  subject: string;
  /** Solo image occlusion: immagini che hanno già una card nel mazzo */
  skipImageIds?: string[];
  onProgress: (p: LocalProgress) => void;
  /** Testo generato dal modello, in streaming */
  onText: (chunk: string, reset: boolean) => void;
  signal: AbortSignal;
};

const CHUNK_CHARS = 8000;
const MAX_PER_CHUNK = 15;

/** Oltre questa lunghezza la risposta non sta più scrivendo card utili (un quiz completo è ~400 caratteri). */
const maxOutputChars = (cards: number) => 1500 + cards * 550;

const LANGUAGE = { it: "ITALIAN", en: "ENGLISH" } as const;

const DIFFICULTY: Record<GenerationOptions["difficulty"], string> = {
  base: "Level: BASIC — definitions, fundamental concepts and high-yield facts.",
  intermedio: "Level: INTERMEDIATE — mechanisms, cause-effect relationships, classifications and comparisons, as in a university exam.",
  avanzato: "Level: ADVANCED — fine details, exceptions, reference values, clinical correlations.",
};

function systemPrompt(language: GenerationOptions["language"]): string {
  return `You are a university Medicine lecturer who writes excellent Anki flashcards for Medicine and Surgery students. You follow the output format exactly.
Rules:
- Use ONLY facts from the material. Never invent data or values.
- One concept per card; short answers (under 25 words).
- Every card must make sense on its own: always name the organ, structure, drug or disease it refers to.
- No duplicate cards.
- Write every card in ${LANGUAGE[language]}, whatever the language of the material.`;
}

const QUIZ_FORMAT = `Q: <question>
A) <option>
B) <option>
C) <option>
D) <option>
Answer: <letter of the correct option>
Explanation: <one short sentence>`;
const QUIZ_RULES = `The wrong options of a quiz question must be plausible (same category as the right one) but clearly wrong according to the material. Never use "all of the above" or "none of the above".`;

function formatInstructions(type: GenerationOptions["cardType"], count: number): string {
  const qa = `Q: <question>\nA: <short answer>`;
  const cloze = `C: <a self-contained sentence where the key term is wrapped like {{c1::term}}>`;
  switch (type) {
    case "basic":
      return `Write about ${count} question/answer flashcards. Use exactly this format, with a blank line between cards:\n${qa}`;
    case "mcq":
      return `Write about ${count} multiple-choice quiz questions, each with exactly four options and one correct answer.
Use exactly this format, with a blank line between questions:
${QUIZ_FORMAT}
${QUIZ_RULES}`;
    case "cloze":
      return `Write about ${count} cloze (fill-in-the-blank) flashcards. Use exactly this format, one card per line:\n${cloze}\nYou may hide up to three terms in a sentence with {{c1::...}}, {{c2::...}}. Never hide the whole sentence.`;
    default: {
      // Numeri esatti e in sezioni ordinate: con le percentuali il modello piccolo salta quasi sempre i quiz.
      const n = mixCounts(count);
      const sections = [
        n.basic && `${n.basic} question/answer ${n.basic === 1 ? "card" : "cards"} in this format:\n${qa}`,
        n.cloze && `${n.cloze} cloze ${n.cloze === 1 ? "card" : "cards"} in this format:\n${cloze}`,
        `${n.mcq} multiple-choice quiz ${n.mcq === 1 ? "question" : "questions"} (four options, exactly one correct) in this format:\n${QUIZ_FORMAT}\n${QUIZ_RULES}`,
      ].filter(Boolean);
      return `Write exactly ${n.basic + n.cloze + n.mcq} cards, in this order, with a blank line between cards:
${sections.map((sec, i) => `${i + 1}. ${sec}`).join("\n")}
Do not skip the last section: the quiz ${n.mcq === 1 ? "question is" : "questions are"} required.`;
    }
  }
}

function flashcardPrompt(args: RunArgs, count: number, title: string, material: string): string {
  const { options } = args;
  const focus = options.focus.trim();
  return `<material source="${title}">
${material}
</material>

Subject: ${args.subject}
Create Anki ${args.options.cardType === "mcq" ? "quiz questions" : "flashcards"} from the material above.
${formatInstructions(options.cardType, count)}
${DIFFICULTY[options.difficulty]}${focus ? `\nStudent's instructions (follow them if compatible with the rules): ${focus}` : ""}
Write the cards in ${LANGUAGE[options.language]}.
Output ONLY the cards: no introduction, no numbering, no commentary.`;
}

function chunkText(text: string, size: number): string[] {
  const chunks: string[] = [];
  let cur = "";
  for (let p of text.split(/\n\s*\n/)) {
    while (p.length > size) {
      // un paragrafo enorme (tipico del testo estratto dai PDF): taglio netto
      if (cur) {
        chunks.push(cur);
        cur = "";
      }
      chunks.push(p.slice(0, size));
      p = p.slice(size);
    }
    if (cur && cur.length + p.length + 2 > size) {
      chunks.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.filter((c) => /\p{L}{3}/u.test(c));
}

/** Sceglie `n` elementi distribuiti uniformemente, per coprire tutto il materiale senza leggerlo tutto. */
function spread<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  return Array.from({ length: n }, (_, i) => items[Math.floor((i * items.length) / n)]);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
const hasCloze = (s: string) => /\{\{c\d+::[\s\S]+?\}\}/.test(s);

/** Estrae card Q:/A: e cloze dall'output del modello. Tollera **grassetto**, elenchi puntati e numerazione. */
export function parseCards(text: string): { type: "basic" | "cloze"; front: string; back: string }[] {
  const cards: { type: "basic" | "cloze"; front: string; back: string }[] = [];
  let cur: { front: string; back: string; field: "front" | "back" } | null = null;
  const flush = () => {
    if (cur && cur.front.trim() && cur.back.trim()) cards.push({ type: "basic", front: cur.front.trim(), back: cur.back.trim() });
    cur = null;
  };
  const fixCloze = (s: string) => s.replace(/\{\{\s*c(\d+)\s*:(?!:)/gi, "{{c$1::").replace(/\{\{\s*C(\d+)::/g, "{{c$1::");
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (line.startsWith("```")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(?:Q|Question|Domanda|Front|Fronte)\s*[:：]\s*(.*)$/i))) {
      flush();
      cur = { front: m[1], back: "", field: "front" };
    } else if ((m = line.match(/^(?:A|Answer|Risposta|Back|Retro)\s*[:：]\s*(.*)$/i))) {
      if (cur) {
        cur.back = cur.back ? `${cur.back}\n${m[1]}` : m[1];
        cur.field = "back";
      }
    } else if ((m = line.match(/^(?:C|Cloze)\s*[:：]\s*(.*)$/i)) || /\{\{\s*c\d+\s*::?/i.test(line)) {
      flush();
      const t = fixCloze(m ? m[1] : line);
      if (hasCloze(t)) cards.push({ type: "cloze", front: t, back: "" });
    } else if (!line) {
      if (cur?.back) flush();
    } else if (cur) {
      cur[cur.field] += `\n${line}`;
    }
  }
  flush();
  return cards;
}

/** Estrae domande a scelta multipla (4 opzioni). Le opzioni vengono mescolate: i modelli tendono a mettere prima quella giusta. */
export function parseQuiz(text: string): { question: string; choices: Choice[]; explanation: string }[] {
  type Draft = { question: string; options: string[]; correct: number; explanation: string };
  const out: { question: string; choices: Choice[]; explanation: string }[] = [];
  let cur: Draft | null = null;
  // Letto anche dalle funzioni interne: il tipo esplicito evita il narrowing del flusso di controllo.
  let field = null as "question" | "option" | "answer" | "explanation" | null;
  const complete = (q: Draft | null): q is Draft =>
    !!q && !!q.question.trim() && q.options.length === 4 && q.options.every((o) => o.trim()) && q.correct >= 0;
  const flush = () => {
    if (complete(cur)) {
      const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
      out.push({
        question: cur.question.trim(),
        choices: order.map((i) => ({ text: cur!.options[i].trim(), correct: i === cur!.correct })),
        explanation: cur.explanation.trim(),
      });
    }
    cur = null;
    field = null;
  };
  const start = (q: string) => {
    flush();
    cur = { question: q, options: [], correct: -1, explanation: "" };
    field = "question";
  };
  const CORRECT_MARK = /\((?:correct|corretta|giusta)\)|[✓✔]/i;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim();
    if (line.startsWith("```")) continue;
    const q = cur as Draft | null;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(?:Q|Question|Domanda)\s*\d*\s*[:：.)]\s*(.*)$/i))) {
      start(m[1]);
    } else if (q && q.options.length < 4 && (m = line.match(/^\(?([A-Da-d])\s*[).:\]]\s*(.+)$/))) {
      let opt = m[2];
      if (CORRECT_MARK.test(opt)) {
        q.correct = q.options.length;
        opt = opt.replace(new RegExp(CORRECT_MARK.source, "gi"), "");
      }
      q.options.push(opt.trim());
      field = "option";
    } else if (q && (m = line.match(/^(?:Answer|Correct(?: answer)?|Risposta(?: corretta| esatta)?|Soluzione)\s*[:：]\s*\(?([A-Da-d])\b/i))) {
      q.correct = "ABCD".indexOf(m[1].toUpperCase());
      field = "answer";
    } else if (q && (m = line.match(/^(?:Explanation|Spiegazione|Motivazione|Why|Perch[eé])\s*[:：]\s*(.*)$/i))) {
      q.explanation = m[1];
      field = "explanation";
    } else if (line.endsWith("?") && (!q || complete(q))) {
      start(line); // una domanda senza il prefisso "Q:"
    } else if (line && q && field === "question" && !q.options.length) {
      q.question += `\n${line}`;
    } else if (line && q && field === "explanation") {
      q.explanation += ` ${line}`;
    }
  }
  flush();
  return out;
}

const QUIZ_OPTION_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?\(?[A-Da-d]\s*[).\]](?:\*\*)?\s+\S/m;

/** Card scritte dal modello nel formato richiesto; con "mixed" ogni blocco è riconosciuto come quiz o come Q/A e cloze. */
export function parseOutput(text: string, type: GenerationOptions["cardType"]): Omit<LocalCard, "tags">[] {
  type Parsed = Omit<LocalCard, "tags">;
  const quiz = (t: string): Parsed[] =>
    parseQuiz(t).map((q) => ({
      type: "mcq" as const,
      front: escapeHtml(q.question),
      back: "",
      extra: escapeHtml(q.explanation),
      choices: q.choices.map((c) => ({ text: escapeHtml(c.text), correct: c.correct })),
    }));
  const flashcards = (t: string): Parsed[] =>
    parseCards(t)
      .filter((c) => type === "mixed" || c.type === type)
      .map((c) => ({ type: c.type, front: escapeHtml(c.front), back: escapeHtml(c.back), extra: "" }));
  if (type === "mcq") return quiz(text);
  if (type !== "mixed") return flashcards(text);
  // Un quiz letto come Q/A diventerebbe una card con le opzioni nella domanda: i blocchi con opzioni A)…D) vanno al parser dei quiz.
  return text.split(/\n\s*\n/).flatMap((block): Parsed[] => (QUIZ_OPTION_LINE.test(block) ? quiz(block) : flashcards(block)));
}

const topicTag = (title: string) => title.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 40);

async function ready(args: RunArgs, steps: number) {
  args.onProgress({ phase: "model", message: "Loading the local model…", step: 0, steps, cards: 0 });
  await ensureEngine();
}

async function generateFlashcards(args: RunArgs): Promise<LocalRunResult> {
  const { options, signal } = args;
  const warnings: string[] = [];
  await ready(args, 0);

  const jobs: { title: string; text: string }[] = [];
  for (const [i, m] of args.materials.entries()) {
    if (signal.aborted) throw new AbortedError();
    args.onProgress({ phase: "reading", message: `Reading "${m.title}"…`, step: i + 1, steps: args.materials.length, cards: 0 });
    try {
      const text = await materialText(m, await fetchMaterial(m.id));
      for (const chunk of chunkText(text, CHUNK_CHARS)) jobs.push({ title: m.title, text: chunk });
    } catch (err) {
      warnings.push(`"${m.title}" skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (jobs.length === 0) throw new Error(warnings[0] ?? "No text found in the selected materials.");

  // Almeno ~3 card per blocco: con molto materiale si leggono blocchi distribuiti su tutti i file.
  const selected = spread(jobs, Math.max(1, Math.ceil(options.cardCount / 3)));
  const perChunk = Math.min(MAX_PER_CHUNK, Math.ceil(options.cardCount / selected.length));
  const cards: LocalCard[] = [];
  const seen = new Set<string>();
  let stopped = false;
  for (const [i, job] of selected.entries()) {
    if (cards.length >= options.cardCount) break;
    args.onProgress({ phase: "generating", message: `Writing cards from "${job.title}"`, step: i + 1, steps: selected.length, cards: cards.length });
    args.onText("", true);
    let out: string;
    try {
      out = await runPrompt(flashcardPrompt(args, perChunk, job.title, job.text), {
        system: systemPrompt(options.language),
        onText: (t) => args.onText(t, false),
        signal,
        maxChars: maxOutputChars(perChunk),
      });
    } catch (err) {
      if (err instanceof AbortedError) {
        stopped = true;
        break;
      }
      throw err;
    }
    let parsed = parseOutput(out, options.cardType);
    // Formato misto senza quiz in questo blocco: una seconda richiesta breve solo per i quiz mancanti.
    if (options.cardType === "mixed" && !parsed.some((c) => c.type === "mcq")) {
      const missing = mixCounts(perChunk).mcq;
      args.onProgress({ phase: "generating", message: `Writing quiz questions from "${job.title}"`, step: i + 1, steps: selected.length, cards: cards.length });
      args.onText("\n\n", false);
      try {
        const extra = await runPrompt(flashcardPrompt({ ...args, options: { ...options, cardType: "mcq" } }, missing, job.title, job.text), {
          system: systemPrompt(options.language),
          onText: (t) => args.onText(t, false),
          signal,
          maxChars: maxOutputChars(missing),
        });
        parsed = [...parsed, ...parseOutput(extra, "mcq")];
      } catch (err) {
        if (!(err instanceof AbortedError)) throw err;
        stopped = true;
      }
    }
    for (const c of parsed) {
      const key = c.front.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push({ ...c, tags: [topicTag(job.title)] });
    }
    if (cards.length === 0 && i === selected.length - 1) warnings.push("The model did not write any card in the expected format.");
    if (stopped) break;
  }
  return { cards: options.cardType === "mixed" ? trimMixed(cards, options.cardCount) : cards.slice(0, options.cardCount), stopped, warnings };
}

/** Riduce al numero richiesto rispettando la ripartizione del formato misto (i quiz non vengono tagliati per primi). */
function trimMixed(cards: LocalCard[], total: number): LocalCard[] {
  if (cards.length <= total) return cards;
  const quota: Record<string, number> = { ...mixCounts(total) };
  const keep = new Set<LocalCard>();
  for (const c of cards) {
    if ((quota[c.type] ?? 0) > 0) {
      quota[c.type]--;
      keep.add(c);
    }
  }
  // Se un tipo non ha raggiunto la sua quota, i posti liberi vanno alle card rimaste, nell'ordine originale.
  for (const c of cards) {
    if (keep.size >= total) break;
    keep.add(c);
  }
  return cards.filter((c) => keep.has(c));
}

// ---------- Image occlusion: OCR delle etichette, il modello sceglie quali coprire ----------

/** Unisce le parole vicine sulla stessa riga in un'unica etichetta ("left ventricle"). */
function mergeWords(words: OcrBox[]): Omit<OcrBox, "conf">[] {
  const sorted = [...words].sort((a, b) => a.x0 - b.x0);
  const labels: (OcrBox & { lastX1: number; confSum: number; n: number })[] = [];
  for (const w of sorted) {
    const h = w.y1 - w.y0;
    const cy = (w.y0 + w.y1) / 2;
    const target = labels.find((l) => {
      const lh = l.y1 - l.y0;
      const gap = w.x0 - l.lastX1;
      return Math.abs((l.y0 + l.y1) / 2 - cy) < 0.5 * Math.max(h, lh) && gap > -0.3 * h && gap < 0.9 * Math.max(h, lh);
    });
    if (target) {
      target.text += (w.x0 - target.lastX1 > 0.15 * h ? " " : "") + w.text;
      target.x0 = Math.min(target.x0, w.x0);
      target.y0 = Math.min(target.y0, w.y0);
      target.x1 = Math.max(target.x1, w.x1);
      target.y1 = Math.max(target.y1, w.y1);
      target.lastX1 = w.x1;
      target.confSum += w.conf;
      target.n++;
    } else {
      labels.push({ ...w, lastX1: w.x1, confSum: w.conf, n: 1 });
    }
  }
  // Prima si unisce, poi si scartano le etichette incerte: una parola dubbia non spezza l'etichetta.
  return labels
    .filter((l) => l.confSum / l.n >= 55)
    .map(({ text, x0, y0, x1, y1 }) => ({ text: text.replace(/\s+/g, " ").trim(), x0, y0, x1, y1 }));
}

const looksLikeLabel = (t: string) => /\p{L}/u.test(t) && t.length >= 2 && t.length <= 40 && t.split(" ").length <= 5;

function pickPrompt(labels: { text: string }[], title: string, subject: string): string {
  return `Below are the text labels detected on a ${subject} image titled "${title}" (an anatomical plate, histology slide, diagram or slide), numbered:
${labels.map((l, i) => `${i + 1}. ${l.text}`).join("\n")}

A medical student will study this image with image-occlusion flashcards: each chosen label gets covered and must be recalled.
Choose the labels worth memorizing: names of structures and parts, key terms, important values.
Do NOT choose titles, headings, captions, figure or page numbers, sources/citations, long sentences or filler words.
Reply ONLY with the chosen numbers separated by commas, for example: 2, 5, 7`;
}

async function generateOcclusions(args: RunArgs): Promise<LocalRunResult> {
  const { options, signal } = args;
  const skip = new Set(args.skipImageIds ?? []);
  const images = args.materials.filter((m) => OCCLUSION_IMAGE_TYPES.includes(m.mimeType) && !skip.has(m.id));
  if (images.length === 0) throw new Error("Image occlusion needs at least one image (PNG, JPG or WEBP) without an occlusion card.");
  const perImage = Math.max(3, Math.min(30, Math.ceil(options.cardCount / images.length)));
  const header = options.language === "it" ? "Identifica le strutture indicate" : "Identify the labelled structures";
  const warnings: string[] = [];
  const cards: LocalCard[] = [];
  let stopped = false;
  await ready(args, images.length);

  for (const [i, image] of images.entries()) {
    if (signal.aborted) {
      stopped = true;
      break;
    }
    args.onProgress({ phase: "reading", message: `Reading the labels on "${image.title}" (OCR)…`, step: i + 1, steps: images.length, cards: cards.length });
    args.onText("", true);
    let canvas: HTMLCanvasElement;
    let labels: Omit<OcrBox, "conf">[];
    try {
      canvas = await imageToCanvas(await fetchMaterial(image.id));
      labels = mergeWords((await ocr(canvas)).words).filter((l) => /[\p{L}\p{N}]/u.test(l.text));
    } catch (err) {
      warnings.push(`"${image.title}" skipped: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (labels.length === 0) {
      warnings.push(`"${image.title}": no text labels found. Draw the masks by hand in the card editor.`);
      continue;
    }
    // Pagine piene di testo: il prompt resta piccolo scartando prima le righe lunghe.
    if (labels.length > 80) labels = labels.filter((l) => l.text.length <= 40).slice(0, 80);

    args.onProgress({ phase: "generating", message: `Choosing the labels to hide on "${image.title}"`, step: i + 1, steps: images.length, cards: cards.length });
    let chosen: typeof labels;
    try {
      const out = await runPrompt(pickPrompt(labels, image.title, args.subject), { onText: (t) => args.onText(t, false), signal, maxChars: 1500 });
      const picked = [...new Set([...out.matchAll(/\d+/g)].map((m) => Number(m[0]) - 1))].filter((n) => n >= 0 && n < labels.length);
      chosen = picked.map((n) => labels[n]);
      if (chosen.length === 0) chosen = labels.filter((l) => looksLikeLabel(l.text));
    } catch (err) {
      if (err instanceof AbortedError) {
        stopped = true;
        break;
      }
      throw err;
    }

    const W = canvas.width;
    const H = canvas.height;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const occlusions: Occlusion[] = chosen.slice(0, perImage).map((l, n) => {
      const pad = 0.2 * (l.y1 - l.y0);
      const x0 = clamp(l.x0 - pad, 0, W);
      const y0 = clamp(l.y0 - pad, 0, H);
      const x1 = clamp(l.x1 + pad, 0, W);
      const y1 = clamp(l.y1 + pad, 0, H);
      return { id: `m${n + 1}${Math.random().toString(36).slice(2, 7)}`, label: l.text, x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
    });
    if (occlusions.length === 0) continue;
    cards.push({ type: "image_occlusion", front: `${header}: ${image.title}`, back: "", extra: "", tags: [topicTag(image.title)], imageMaterialId: image.id, occlusions });
  }
  return { cards, stopped, warnings };
}

export function generateLocally(args: RunArgs): Promise<LocalRunResult> {
  return args.options.cardType === "image_occlusion" ? generateOcclusions(args) : generateFlashcards(args);
}
