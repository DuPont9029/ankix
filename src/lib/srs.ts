// Ripetizione dilazionata con FSRS-5 (lo stesso algoritmo di Anki dalla 23.10), parametri predefiniti.
// Modulo puro condiviso tra client (anteprima degli intervalli, card da ripetere nella sessione) e server
// (che ricalcola tutto ed è l'unico a salvare): con gli stessi input i risultati coincidono.

export type Rating = 1 | 2 | 3 | 4;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];
export const RATING_LABELS: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

export type SrsState = "new" | "learning" | "review" | "relearning";

export type ItemState = {
  state: Exclude<SrsState, "new">;
  /** Passo di apprendimento corrente (solo learning/relearning) */
  step: number;
  /** Prossima ripetizione (ms) */
  due: number;
  /** Stabilità: giorni dopo cui la probabilità di ricordare scende al 90% */
  stability: number;
  /** Difficoltà 1–10 */
  difficulty: number;
  reps: number;
  lapses: number;
  lastReview: number;
};

export type SchedulerParams = {
  /** Probabilità di ricordo desiderata al momento della ripetizione (0.7–0.97) */
  retention: number;
  maxIntervalDays: number;
  /** Data d'esame (ms): gli intervalli non la superano, così tutto viene ripassato prima */
  capDue?: number | null;
};

export const DEFAULT_PARAMS: SchedulerParams = { retention: 0.9, maxIntervalDays: 365 };

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const LEARNING_STEPS = [1 * MINUTE, 10 * MINUTE];
const RELEARNING_STEPS = [10 * MINUTE];

// Pesi predefiniti di FSRS-5
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605,
  2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
];
const DECAY = -0.5;
const FACTOR = 19 / 81;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Probabilità di ricordare dopo `days` giorni con stabilità `stability`. */
export function forgettingCurve(days: number, stability: number): number {
  return Math.pow(1 + (FACTOR * Math.max(0, days)) / Math.max(stability, 0.01), DECAY);
}

/** Probabilità attuale di ricordare l'elemento (1 = appena ripassato). */
export function retrievability(s: Pick<ItemState, "stability" | "lastReview">, now: number): number {
  return forgettingCurve((now - s.lastReview) / DAY, s.stability);
}

function intervalDays(stability: number, retention: number): number {
  return (stability / FACTOR) * (Math.pow(retention, 1 / DECAY) - 1);
}

const initStability = (g: Rating) => Math.max(W[g - 1], 0.1);
const initDifficulty = (g: Rating) => clamp(W[4] - Math.exp(W[5] * (g - 1)) + 1, 1, 10);

function nextDifficulty(d: number, g: Rating): number {
  const damped = d + (-W[6] * (g - 3) * (10 - d)) / 9;
  return clamp(W[7] * initDifficulty(4) + (1 - W[7]) * damped, 1, 10);
}

function recallStability(d: number, s: number, r: number, g: Rating): number {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  return s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy);
}

function forgetStability(d: number, s: number, r: number): number {
  const sf = W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
  return Math.min(sf, s / Math.exp(W[17] * W[18]));
}

const shortTermStability = (s: number, g: Rating) => s * Math.exp(W[17] * (g - 3 + W[18]));

/** Stabilità e difficoltà dopo la valutazione `g`. */
function memory(prev: ItemState | null, g: Rating, now: number): { stability: number; difficulty: number } {
  if (!prev) return { stability: initStability(g), difficulty: initDifficulty(g) };
  const elapsed = (now - prev.lastReview) / DAY;
  const difficulty = nextDifficulty(prev.difficulty, g);
  if (elapsed < 1) return { stability: Math.max(shortTermStability(prev.stability, g), 0.1), difficulty };
  const r = forgettingCurve(elapsed, prev.stability);
  const stability = g === 1 ? forgetStability(prev.difficulty, prev.stability, r) : recallStability(prev.difficulty, prev.stability, r, g);
  return { stability: Math.max(stability, 0.1), difficulty };
}

function reviewInterval(stability: number, params: SchedulerParams): number {
  return clamp(Math.round(intervalDays(stability, params.retention)), 1, params.maxIntervalDays);
}

/** Non oltre la data d'esame (se mancano almeno 2 giorni: a ridosso dell'esame vale l'intervallo normale). */
function capInterval(days: number, now: number, params: SchedulerParams): number {
  if (!params.capDue) return days;
  const left = Math.floor((params.capDue - now) / DAY);
  return left >= 2 ? Math.max(1, Math.min(days, left - 1)) : days;
}

export type ScheduleResult = { next: ItemState; elapsedDays: number; scheduledDays: number };

export function schedule(prev: ItemState | null, g: Rating, now: number, params: SchedulerParams = DEFAULT_PARAMS): ScheduleResult {
  const { stability, difficulty } = memory(prev, g, now);
  const elapsedDays = prev ? Math.max(0, (now - prev.lastReview) / DAY) : 0;
  const base = { stability, difficulty, reps: (prev?.reps ?? 0) + 1, lapses: prev?.lapses ?? 0, lastReview: now };
  const toReview = (days: number): ScheduleResult => {
    const d = capInterval(days, now, params);
    return { next: { ...base, state: "review", step: 0, due: now + d * DAY }, elapsedDays, scheduledDays: d };
  };
  const toStep = (state: "learning" | "relearning", step: number, delay: number, lapses = base.lapses): ScheduleResult => ({
    next: { ...base, lapses, state, step, due: now + delay },
    elapsedDays,
    scheduledDays: delay / DAY,
  });

  if (prev?.state === "review") {
    if (g === 1) return toStep("relearning", 0, RELEARNING_STEPS[0], base.lapses + 1);
    // Intervalli ordinati: Hard ≤ Good < Easy, come in Anki.
    const days = (r: Rating) => reviewInterval(memory(prev, r, now).stability, params);
    const hard = Math.min(days(2), days(3));
    const good = Math.max(days(3), hard + 1);
    const easy = Math.max(days(4), good + 1);
    return toReview(Math.min(g === 2 ? hard : g === 3 ? good : easy, params.maxIntervalDays));
  }

  // Nuovo, in apprendimento o in riapprendimento: passi brevi nella stessa giornata.
  const state = prev?.state === "relearning" ? "relearning" : "learning";
  const steps = state === "relearning" ? RELEARNING_STEPS : LEARNING_STEPS;
  const step = prev ? Math.min(prev.step, steps.length - 1) : 0;
  const graduate = reviewInterval(stability, params);
  if (g === 1) return toStep(state, 0, steps[0]);
  if (g === 2) {
    const delay = step === 0 && steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[step] * 1.5;
    return toStep(state, step, delay);
  }
  if (g === 3) {
    if (step + 1 < steps.length) return toStep(state, step + 1, steps[step + 1]);
    return toReview(graduate);
  }
  return toReview(Math.max(graduate, state === "learning" ? 2 : 1));
}

/** Dopo quanto tornerebbe l'elemento per ciascuna valutazione (ms), per le etichette dei pulsanti. */
export function previewDelays(prev: ItemState | null, now: number, params: SchedulerParams): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const g of RATINGS) out[g] = schedule(prev, g, now, params).next.due - now;
  return out;
}

export function formatDelay(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  const days = ms / DAY;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${Math.round(days / 30.4)}mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")}y`;
}

// ---------- giorni di studio ----------

/** Come in Anki la giornata di studio cambia alle 4 del mattino, così una sessione dopo mezzanotte conta per il giorno prima. */
export const ROLLOVER_HOURS = 4;

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: isValidTimeZone(tz) ? tz : "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(tz, f);
  }
  return f;
}

/** Giorno di studio (giorni dal 1970-01-01 nel fuso dell'utente) a cui appartiene l'istante `ms`. */
export function dayIndex(ms: number, tz: string): number {
  const parts = formatter(tz).formatToParts(new Date(ms - ROLLOVER_HOURS * HOUR));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return Math.round(Date.UTC(get("year"), get("month") - 1, get("day")) / DAY);
}

export function dayToIso(day: number): string {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

export function isoToDay(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / DAY) : null;
}

/** 0 = domenica … 6 = sabato */
export function weekday(day: number): number {
  return new Date(day * DAY).getUTCDay();
}
