// Tipi del piano di studio condivisi tra client e server.
import type { ItemState } from "./srs";
import type { Card } from "./types";

export type StudyPrefs = {
  /** Tempo che lo studente vuole dedicare ogni giorno (minuti) */
  dailyMinutes: number;
  /** Nuove card al giorno a regime */
  newPerDay: number;
  /** Probabilità di ricordo desiderata (0.75–0.97) */
  desiredRetention: number;
  /** Giorni di studio della settimana (0 = domenica) */
  studyDays: number[];
  /** Avvio graduale: le nuove card al giorno crescono nei primi giorni di studio */
  gradualStart: boolean;
  /** Fuso orario per i giorni di studio (rilevato dal browser) */
  timezone: string;
  /** Mazzi esclusi dal piano giornaliero */
  pausedDecks: string[];
  /** Data d'esame (YYYY-MM-DD) per mazzo */
  exams: Record<string, string>;
  /** Primo giorno di studio con il piano (ms) */
  startedAt: number | null;
};

export const DEFAULT_PREFS: StudyPrefs = {
  dailyMinutes: 20,
  newPerDay: 15,
  desiredRetention: 0.9,
  studyDays: [0, 1, 2, 3, 4, 5, 6],
  gradualStart: true,
  timezone: "Europe/Rome",
  pausedDecks: [],
  exams: {},
  startedAt: null,
};

export type StageKey = "warmup" | "review" | "new" | "consolidate";

export const STAGES: { key: StageKey; title: string; description: string }[] = [
  { key: "warmup", title: "Warm-up", description: "A few cards you know well, to get going" },
  { key: "review", title: "Reviews", description: "Due cards, from the easiest to the hardest" },
  { key: "new", title: "New cards", description: "Today's share of new material" },
  { key: "consolidate", title: "Consolidation", description: "Cards still being learned come back until they stick" },
];

export type PlanItem = {
  key: string;
  cloze: number | null;
  card: Card;
  deckId: string;
  deckTitle: string;
  subject: string;
  stage: StageKey;
  state: ItemState | null;
  /** Data d'esame del mazzo (ms), per non programmare ripetizioni oltre */
  capDue: number | null;
};

export type PlanDeck = { id: string; title: string; subject: string; due: number; fresh: number; exam: string | null; paused: boolean };

export type Adaptation = {
  /** Ricordo reale negli ultimi 30 giorni (ripetizioni di card già imparate), null se i dati sono pochi */
  retention30: number | null;
  reviews30: number;
  /** Secondi medi per card, misurati */
  avgSeconds: number;
  targetRetention: number;
  /** Ricordo usato per calcolare gli intervalli, corretto in base ai risultati reali */
  effectiveRetention: number;
  /** Spiegazioni delle scelte fatte oggi dal piano */
  notes: string[];
  weakDecks: { deckId: string; title: string; retention: number; reviews: number }[];
  leeches: { key: string; deckId: string; text: string; lapses: number }[];
};

export type DailyPlan = {
  date: string;
  restDay: boolean;
  params: { retention: number; maxIntervalDays: number };
  items: PlanItem[];
  done: { reviews: number; newCards: number; minutes: number };
  limits: { capacity: number; newLimit: number; newTarget: number };
  /** Ripetizioni scadute rimandate perché oltre il tempo disponibile */
  postponed: number;
  /** Card in apprendimento che torneranno più tardi oggi */
  learningLater: number;
  streak: number;
  /** Giorni di studio da quando si usa il piano (per l'avvio graduale) */
  studyDayCount: number;
  decks: PlanDeck[];
  adaptation: Adaptation;
};

export type CalendarDay = {
  date: string;
  /** Ripetizioni fatte, sbagliate (Again), nuove card viste, minuti */
  reviews: number;
  again: number;
  newCards: number;
  minutes: number;
  /** Previsione: ripetizioni in scadenza e nuove card programmate */
  forecastDue: number;
  forecastNew: number;
  rest: boolean;
  exams: { deckId: string; title: string }[];
};

export type CalendarData = { today: string; days: CalendarDay[]; streak: number };

export type ReviewInput = {
  id: string;
  key: string;
  cardId: string;
  deckId: string;
  rating: 1 | 2 | 3 | 4;
  durationMs: number;
  reviewedAt: number;
};
