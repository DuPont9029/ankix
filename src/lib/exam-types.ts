// Modalità esame orale: tipi condivisi tra client e server.
import type { Card, DeckSource } from "./types";

/** Come lo studente ha esposto un argomento: bene, in modo incompleto, male (errori o confusione) o per niente. */
export type ExamCoverage = "good" | "partial" | "poor" | "missing";

export type ExamTopic = {
  topic: string;
  coverage: ExamCoverage;
  comment: string;
  /** Card esistenti sull'argomento (riprogrammate se l'esposizione non era buona) */
  cardIds: string[];
  /** Card create per l'argomento, se mancavano nei mazzi */
  newCardIds: string[];
};

export type ExamCriteria = {
  /** Correttezza dei contenuti */
  accuracy: number;
  /** Completezza rispetto ai materiali (o alla domanda) */
  completeness: number;
  /** Struttura e chiarezza dell'esposizione */
  clarity: number;
  /** Terminologia specifica */
  terminology: number;
};

export const CRITERIA_LABELS: Record<keyof ExamCriteria, string> = {
  accuracy: "Accuracy",
  completeness: "Completeness",
  clarity: "Clarity",
  terminology: "Terminology",
};

/** Una domanda dell'esame con la risposta trascritta (vuota se lo studente l'ha saltata). */
export type ExamAnswer = { question: string; transcript: string; durationSec: number };

/** "random": domande scelte dal prof (l'AI) sui materiali; "custom": domanda scelta dallo studente. */
export type ExamMode = "random" | "custom";

export type ExamResult = {
  /** Voto in trentesimi (0–30, 18 = sufficienza) */
  grade: number;
  /** 30 e lode */
  honors: boolean;
  summary: string;
  criteria: ExamCriteria;
  strengths: string[];
  improvements: string[];
  /** Affermazioni sbagliate dette all'esame, con la correzione */
  errors: { said: string; correction: string }[];
  /** Giudizio su ogni risposta, nello stesso ordine di `OralExam.answers` */
  answers: { coverage: ExamCoverage; feedback: string }[];
  topics: ExamTopic[];
};

export type ExamScheduling = {
  /** Elementi di studio (card, cloze, maschere) già esistenti messi in ripasso */
  rescheduled: number;
  /** Card nuove create per gli argomenti scoperti */
  newCards: number;
  /** Mazzo con le card nuove */
  deckId: string | null;
  /** Mazzi coinvolti, per i link nella pagina del risultato */
  decks: DeckSource[];
};

export type Transcriber = "local" | "browser" | "gemini" | "openai";

export const TRANSCRIBER_LABELS: Record<Transcriber, string> = {
  local: "Whisper (on this device)",
  browser: "Browser speech recognition",
  gemini: "Google Gemini",
  openai: "OpenAI",
};

export type OralExam = {
  id: string;
  title: string;
  mode: ExamMode;
  language: "it" | "en";
  materials: DeckSource[];
  answers: ExamAnswer[];
  /** Durata totale delle risposte */
  durationSec: number;
  transcriber: Transcriber;
  model: string;
  result: ExamResult;
  scheduling: ExamScheduling;
  createdAt: number;
};

export type OralExamSummary = Pick<OralExam, "id" | "title" | "createdAt" | "durationSec"> & { grade: number; honors: boolean };

export const PASS_GRADE = 18;
export const MAX_QUESTIONS = 5;
export const DEFAULT_QUESTIONS = 3;
export const MAX_GRADE = 30;
/** Durata massima della registrazione di una risposta (l'audio deve restare sotto i limiti dei provider e del server) */
export const MAX_RECORDING_SEC = 10 * 60;
export const MIN_TRANSCRIPT_WORDS = 25;

export function formatGrade(grade: number, honors: boolean): string {
  return honors ? "30 e lode" : `${grade}/30`;
}

/** Etichette dei giudizi su argomenti e risposte */
export const COVERAGE_LABELS: Record<ExamCoverage, string> = {
  good: "Well presented",
  partial: "Incomplete",
  poor: "Presented badly",
  missing: "Not answered",
};

/**
 * Valutazione scritta dal modello locale nel browser e inviata al server, che la ripulisce e la usa come
 * quella dei provider cloud. Le card esistenti sono indicate per id, quelle nuove come domanda/risposta.
 */
export type LocalEvaluation = Omit<ExamResult, "topics"> & {
  topics: { topic: string; coverage: ExamCoverage; comment: string; cardIds: string[]; newCards: { front: string; back: string }[] }[];
};

/** Contesto per l'esame con il modello locale: card dei mazzi collegati e domande già fatte. */
export type ExamContext = { cards: Card[]; avoid: string[] };

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Estrae a caso `count` domande dal gruppo proposto dall'AI, prima su argomenti diversi. */
export function pickQuestions(pool: { question: string; topic: string }[], count: number): string[] {
  const picked: string[] = [];
  const topics = new Set<string>();
  const shuffled = shuffle(pool.filter((q) => q.question.trim()));
  for (const q of shuffled) {
    if (picked.length >= count) break;
    const topic = q.topic.trim().toLowerCase();
    if (topic && topics.has(topic)) continue;
    topics.add(topic);
    picked.push(q.question.trim());
  }
  for (const q of shuffled) {
    if (picked.length >= count) break;
    if (!picked.includes(q.question.trim())) picked.push(q.question.trim());
  }
  return picked;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
