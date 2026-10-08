import "server-only";
import { z } from "zod";
import { query, transaction, type Row, type Tx } from "./db";
import { HttpError } from "./http";
import { expandCards, plainText, type StudyItem } from "./items";
import { canViewDeck, getDecksByIds, listCardsForDecks, listDecks } from "./repo";
import {
  DAY,
  dayIndex,
  dayToIso,
  isoToDay,
  isValidTimeZone,
  MINUTE,
  retrievability,
  schedule,
  weekday,
  type ItemState,
  type Rating,
  type SchedulerParams,
} from "./srs";
import {
  DEFAULT_PREFS,
  type Adaptation,
  type CalendarData,
  type CalendarDay,
  type DailyPlan,
  type PlanItem,
  type ReviewInput,
  type StageKey,
  type StudyPrefs,
} from "./study-types";
import type { Deck } from "./types";

/*
 * Piano di studio personale: ripetizione dilazionata (FSRS, vedi srs.ts), percorso giornaliero graduale,
 * adattamento ai risultati reali dello studente e calendario.
 *
 * Ogni scrittura sul database riscrive i Parquet delle tabelle toccate (vedi db.ts): per questo il browser
 * invia le valutazioni a gruppi e il server le applica in ordine, ricalcolando lo stato di ogni elemento.
 */

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? "" : String(v));

const MAX_INTERVAL_DAYS = 365;
/** Le card in apprendimento che tornano entro questo tempo fanno parte della sessione */
const LEARN_AHEAD_MS = 20 * MINUTE;
/** Una card nuova costa circa quanto 2,5 ripetizioni (passi di apprendimento) */
const NEW_CARD_COST = 2.5;
const DEFAULT_SECONDS = 12;
const LEECH_LAPSES = 5;

// ---------- preferenze ----------

export const PrefsBody = z
  .object({
    dailyMinutes: z.number().int().min(5).max(240),
    newPerDay: z.number().int().min(0).max(200),
    desiredRetention: z.number().min(0.75).max(0.97),
    studyDays: z.array(z.number().int().min(0).max(6)).max(7),
    gradualStart: z.boolean(),
    timezone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
    pausedDecks: z.array(z.uuid()).max(500),
    exams: z
      .record(z.uuid(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")))
      .refine((r) => Object.keys(r).length <= 500, "Too many exams"),
  })
  .partial();

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function normalizePrefs(raw: Partial<StudyPrefs>): StudyPrefs {
  const p = { ...DEFAULT_PREFS, ...raw };
  return {
    dailyMinutes: Math.min(Math.max(Math.round(p.dailyMinutes) || DEFAULT_PREFS.dailyMinutes, 5), 240),
    newPerDay: Math.min(Math.max(Math.round(p.newPerDay) || 0, 0), 200),
    desiredRetention: Math.min(Math.max(Number(p.desiredRetention) || DEFAULT_PREFS.desiredRetention, 0.75), 0.97),
    studyDays: Array.isArray(p.studyDays) ? [...new Set(p.studyDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : DEFAULT_PREFS.studyDays,
    gradualStart: p.gradualStart !== false,
    timezone: typeof p.timezone === "string" && isValidTimeZone(p.timezone) ? p.timezone : DEFAULT_PREFS.timezone,
    pausedDecks: Array.isArray(p.pausedDecks) ? p.pausedDecks.filter((d) => typeof d === "string") : [],
    exams: p.exams && typeof p.exams === "object" ? Object.fromEntries(Object.entries(p.exams).filter(([, v]) => isoToDay(String(v)) !== null)) : {},
    startedAt: typeof p.startedAt === "number" ? p.startedAt : null,
  };
}

async function readPrefs(run: Pick<Tx, "query">, userId: string): Promise<{ prefs: StudyPrefs; exists: boolean }> {
  const [row] = await run.query(`SELECT data FROM study_prefs WHERE user_id = $1`, [userId]);
  return { prefs: normalizePrefs(parseJson<Partial<StudyPrefs>>(row?.data, {})), exists: Boolean(row) };
}

async function writePrefs(tx: Tx, userId: string, prefs: StudyPrefs, exists: boolean): Promise<void> {
  const data = JSON.stringify(prefs);
  if (exists) await tx.exec(`UPDATE study_prefs SET data = $1, updated_at = $2 WHERE user_id = $3`, [data, Date.now(), userId]);
  else await tx.exec(`INSERT INTO study_prefs (user_id, data, updated_at) VALUES ($1, $2, $3)`, [userId, data, Date.now()]);
}

export async function getPrefs(userId: string): Promise<StudyPrefs> {
  return (await readPrefs({ query }, userId)).prefs;
}

export async function savePrefs(userId: string, patch: z.infer<typeof PrefsBody>): Promise<StudyPrefs> {
  return transaction(async (tx) => {
    const { prefs, exists } = await readPrefs(tx, userId);
    const exams = { ...prefs.exams };
    for (const [deckId, date] of Object.entries(patch.exams ?? {})) {
      if (date) exams[deckId] = date;
      else delete exams[deckId];
    }
    const next = normalizePrefs({ ...prefs, ...patch, exams, startedAt: prefs.startedAt });
    if (JSON.stringify(next) !== JSON.stringify(prefs) || !exists) await writePrefs(tx, userId, next, exists);
    return next;
  });
}

// ---------- stati e storico ----------

type StoredState = ItemState & { key: string; cardId: string; deckId: string };

function toState(r: Row): StoredState {
  return {
    key: str(r.item_key),
    cardId: str(r.card_id),
    deckId: str(r.deck_id),
    state: (["learning", "review", "relearning"].includes(str(r.state)) ? str(r.state) : "learning") as ItemState["state"],
    step: num(r.step),
    due: num(r.due),
    stability: num(r.stability),
    difficulty: num(r.difficulty),
    reps: num(r.reps),
    lapses: num(r.lapses),
    lastReview: num(r.last_review),
  };
}

const publicState = ({ state, step, due, stability, difficulty, reps, lapses, lastReview }: ItemState): ItemState => ({
  state,
  step,
  due,
  stability,
  difficulty,
  reps,
  lapses,
  lastReview,
});

type LogEntry = { key: string; cardId: string; deckId: string; rating: number; state: string; durationMs: number; at: number };

async function loadLogs(userId: string): Promise<LogEntry[]> {
  const rows = await query(
    // Solo lo storico di mazzi e card che esistono ancora: eliminato un mazzo (o una card) le sue statistiche
    // spariscono dal calendario, anche per righe rimaste da eliminazioni precedenti.
    `SELECT item_key, card_id, deck_id, rating, state, duration_ms, reviewed_at FROM review_log
     WHERE user_id = $1 AND card_id IN (SELECT id FROM cards)
     ORDER BY reviewed_at`,
    [userId],
  );
  return rows.map((r) => ({
    key: str(r.item_key),
    cardId: str(r.card_id),
    deckId: str(r.deck_id),
    rating: num(r.rating),
    state: str(r.state),
    durationMs: num(r.duration_ms),
    at: num(r.reviewed_at),
  }));
}

// ---------- contesto ----------

type Context = {
  prefs: StudyPrefs;
  now: number;
  today: number;
  decks: Deck[];
  items: StudyItem[];
  states: Map<string, StoredState>;
  logs: LogEntry[];
  /** Giorno d'esame per mazzo (solo esami futuri) */
  examDay: Map<string, number>;
};

async function loadContext(userId: string, now: number, extraDeckId?: string): Promise<Context> {
  const [prefs, own, stateRows, logs] = await Promise.all([
    getPrefs(userId),
    listDecks(userId, "mine"),
    query(`SELECT * FROM card_states WHERE user_id = $1 AND card_id IN (SELECT id FROM cards)`, [userId]),
    loadLogs(userId),
  ]);
  const states = new Map(stateRows.map((r) => [str(r.item_key), toState(r)]));
  // Mazzi pubblici di altri studenti: entrano nel piano quando si inizia a studiarli.
  const ownIds = new Set(own.map((d) => d.id));
  const otherIds = new Set([...states.values()].map((s) => s.deckId).filter((id) => !ownIds.has(id)));
  if (extraDeckId && !ownIds.has(extraDeckId)) otherIds.add(extraDeckId);
  const others = (await getDecksByIds([...otherIds])).filter((d) => canViewDeck(d, userId));
  const decks = [...own, ...others];
  const items = expandCards(await listCardsForDecks(decks.map((d) => d.id)));
  const today = dayIndex(now, prefs.timezone);
  const examDay = new Map<string, number>();
  for (const [deckId, iso] of Object.entries(prefs.exams)) {
    const day = isoToDay(iso);
    if (day !== null && day > today) examDay.set(deckId, day);
  }
  return { prefs, now, today, decks, items, states, logs, examDay };
}

const isStudyDay = (prefs: StudyPrefs, day: number) => prefs.studyDays.length === 0 || prefs.studyDays.includes(weekday(day));

function schedulerParams(ctx: Pick<Context, "examDay">, retention: number, deckId: string): SchedulerParams {
  const exam = ctx.examDay.get(deckId);
  return { retention, maxIntervalDays: MAX_INTERVAL_DAYS, capDue: exam !== undefined ? exam * DAY : null };
}

// ---------- adattamento ----------

function measure(logs: LogEntry[], now: number) {
  const recent = logs.filter((l) => l.at >= now - 30 * DAY);
  const mature = recent.filter((l) => l.state === "review");
  const retention30 = mature.length >= 20 ? mature.filter((l) => l.rating > 1).length / mature.length : null;
  // Tempo per card: media delle ultime 300 valutazioni, escludendo le pause (oltre 90 s).
  const timed = logs.slice(-300).map((l) => Math.min(Math.max(l.durationMs, 2000), 90_000));
  const avgSeconds = timed.length >= 15 ? timed.reduce((a, b) => a + b, 0) / timed.length / 1000 : DEFAULT_SECONDS;
  return { recent, mature, retention30, avgSeconds };
}

/**
 * Ricordo usato per gli intervalli: se lo studente ricorda meno di quanto desidera si accorciano gli intervalli,
 * se ricorda di più si allungano (meno ripetizioni a parità di risultato).
 */
function effectiveRetention(target: number, retention30: number | null): number {
  if (retention30 === null) return target;
  const corrected = target + (target - retention30) * 0.6;
  return Math.round(Math.min(Math.max(corrected, 0.75), 0.97) * 100) / 100;
}

/** Ripetizioni di oggi e giorni di studio (per l'avvio graduale e la serie di giorni consecutivi). */
function studyDays(ctx: Context) {
  const days = new Set<number>();
  const today = { reviews: 0, newCards: 0, ms: 0, keys: new Set<string>() };
  for (const l of ctx.logs) {
    const d = dayIndex(l.at, ctx.prefs.timezone);
    days.add(d);
    if (d === ctx.today) {
      today.reviews++;
      if (l.state === "new") today.newCards++;
      today.ms += Math.min(l.durationMs, 90_000);
      today.keys.add(l.key);
    }
  }
  const startDay = ctx.prefs.startedAt ? dayIndex(ctx.prefs.startedAt, ctx.prefs.timezone) : ctx.today;
  const before = [...days].filter((d) => d >= startDay && d < ctx.today).length;
  let streak = 0;
  // La serie parte da oggi (o da ieri, se oggi non si è ancora studiato); i giorni di riposo non la interrompono.
  for (let d = days.has(ctx.today) ? ctx.today : ctx.today - 1, guard = 0; guard < 3660; d--, guard++) {
    if (days.has(d)) streak++;
    else if (isStudyDay(ctx.prefs, d)) break;
  }
  return { days, today, studyDayCount: before, streak };
}

/** Nuove card al giorno con l'avvio graduale: 30% il primo giorno, +10% per ogni giorno di studio, poi il valore pieno. */
function rampedTarget(prefs: StudyPrefs, studyDayCount: number): number {
  if (!prefs.gradualStart) return prefs.newPerDay;
  return Math.min(prefs.newPerDay, Math.ceil(prefs.newPerDay * Math.min(1, 0.3 + 0.1 * studyDayCount)));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

// ---------- piano del giorno ----------

type Core = {
  ctx: Context;
  retention: number;
  measured: ReturnType<typeof measure>;
  daysInfo: ReturnType<typeof studyDays>;
  restDay: boolean;
  capacity: number;
  newTarget: number;
  newLimit: number;
  examNeeds: { deckId: string; perDay: number; remaining: number; daysLeft: number }[];
  notes: string[];
};

function computeCore(ctx: Context, activeDecks: Set<string>, dueCount: number, freshByDeck: Map<string, number>): Core {
  const { prefs } = ctx;
  const measured = measure(ctx.logs, ctx.now);
  const retention = effectiveRetention(prefs.desiredRetention, measured.retention30);
  const daysInfo = studyDays(ctx);
  const restDay = !isStudyDay(prefs, ctx.today);
  const notes: string[] = [];

  const capacity = Math.max(10, Math.floor((prefs.dailyMinutes * 60) / measured.avgSeconds));
  const remaining = Math.max(0, capacity - daysInfo.today.reviews);
  const newTarget = rampedTarget(prefs, daysInfo.studyDayCount);
  let newLimit = newTarget;

  if (restDay) {
    newLimit = 0;
    notes.push("Today is a rest day in your plan: no new cards, only the reviews that are due (if you feel like it).");
  } else {
    if (prefs.gradualStart && newTarget < prefs.newPerDay) {
      notes.push(
        `Gradual start: day ${daysInfo.studyDayCount + 1} of your plan, so ${newTarget} new cards instead of ${prefs.newPerDay}. The share grows with every day you study.`,
      );
    }
    if (dueCount > remaining) {
      if (newLimit > 0) notes.push(`${dueCount} reviews are due, more than fit in your ${prefs.dailyMinutes} minutes: new cards are paused until you catch up.`);
      newLimit = 0;
    } else {
      const room = Math.floor((remaining - dueCount) / NEW_CARD_COST);
      if (room < newLimit) {
        notes.push(`New cards limited to ${room} to stay within your ${prefs.dailyMinutes} minutes.`);
        newLimit = room;
      }
    }
    if (measured.retention30 !== null && measured.retention30 < prefs.desiredRetention - 0.08 && newLimit > 0) {
      newLimit = Math.ceil(newLimit / 2);
      notes.push(`Your recall is below target, so today's new cards are halved: better to consolidate what you have already seen.`);
    }
  }

  // Esami: abbastanza nuove card al giorno per vederle tutte qualche giorno prima.
  const examNeeds: Core["examNeeds"] = [];
  for (const [deckId, day] of ctx.examDay) {
    if (!activeDecks.has(deckId)) continue;
    const fresh = freshByDeck.get(deckId) ?? 0;
    const daysLeft = day - ctx.today;
    if (fresh === 0) continue;
    const perDay = Math.ceil(fresh / Math.max(1, daysLeft - 2));
    examNeeds.push({ deckId, perDay, remaining: fresh, daysLeft });
  }
  const examMin = examNeeds.reduce((a, e) => a + e.perDay, 0);
  if (!restDay && examMin > newLimit) newLimit = examMin;
  newLimit = Math.max(0, newLimit - daysInfo.today.newCards);

  if (measured.retention30 !== null) {
    if (retention > prefs.desiredRetention) {
      notes.push(`You remembered ${pct(measured.retention30)} of mature cards in the last 30 days (target ${pct(prefs.desiredRetention)}): intervals are shortened a little.`);
    } else if (retention < prefs.desiredRetention) {
      notes.push(`You remembered ${pct(measured.retention30)} of mature cards in the last 30 days (target ${pct(prefs.desiredRetention)}): intervals are lengthened to save you time.`);
    }
  }
  if (measured.avgSeconds !== DEFAULT_SECONDS) {
    notes.push(`You take about ${Math.round(measured.avgSeconds)} s per card, so ${prefs.dailyMinutes} minutes ≈ ${capacity} reviews.`);
  }
  return { ctx, retention, measured, daysInfo, restDay, capacity, newTarget, newLimit, examNeeds, notes };
}

function classify(ctx: Context, items: StudyItem[]) {
  const learningNow: { item: StudyItem; state: StoredState }[] = [];
  const due: { item: StudyItem; state: StoredState; r: number }[] = [];
  const fresh: StudyItem[] = [];
  let learningLater = 0;
  for (const item of items) {
    const state = ctx.states.get(item.key);
    if (!state) {
      fresh.push(item);
    } else if (state.state === "review") {
      if (dayIndex(state.due, ctx.prefs.timezone) <= ctx.today) due.push({ item, state, r: retrievability(state, ctx.now) });
    } else if (state.due <= ctx.now + LEARN_AHEAD_MS) {
      learningNow.push({ item, state });
    } else if (dayIndex(state.due, ctx.prefs.timezone) <= ctx.today) {
      learningLater++;
    }
  }
  return { learningNow, due, fresh, learningLater };
}

/** Nuove card: prima i mazzi con l'esame più vicino, poi a turno da ciascun mazzo; una sola cloze/maschera per card al giorno. */
function pickNew(ctx: Context, fresh: StudyItem[], limit: number, seenToday: Set<string>): StudyItem[] {
  if (limit <= 0) return [];
  const byDeck = new Map<string, StudyItem[]>();
  for (const it of fresh) {
    const list = byDeck.get(it.card.deckId) ?? [];
    list.push(it);
    byDeck.set(it.card.deckId, list);
  }
  const order = [...byDeck.keys()].sort((a, b) => (ctx.examDay.get(a) ?? Infinity) - (ctx.examDay.get(b) ?? Infinity));
  const usedCards = new Set([...seenToday].map((k) => k.split(":")[0]));
  const out: StudyItem[] = [];
  const cursors = new Map(order.map((d) => [d, 0]));
  while (out.length < limit) {
    let progressed = false;
    for (const deckId of order) {
      const list = byDeck.get(deckId)!;
      let i = cursors.get(deckId)!;
      while (i < list.length && usedCards.has(list[i].card.id)) i++;
      if (i < list.length && out.length < limit) {
        out.push(list[i]);
        usedCards.add(list[i].card.id);
        progressed = true;
        i++;
      }
      cursors.set(deckId, i);
    }
    if (!progressed) break;
  }
  return out;
}

export async function buildPlan(userId: string, opts: { deckId?: string; now?: number } = {}): Promise<DailyPlan> {
  const now = opts.now ?? Date.now();
  const ctx = await loadContext(userId, now, opts.deckId);
  if (opts.deckId && !ctx.decks.some((d) => d.id === opts.deckId)) throw new HttpError(404, "Deck not found.");
  const deckById = new Map(ctx.decks.map((d) => [d.id, d]));
  const paused = new Set(ctx.prefs.pausedDecks);
  const active = new Set(ctx.decks.filter((d) => (opts.deckId ? d.id === opts.deckId : !paused.has(d.id))).map((d) => d.id));

  // Conteggi di tutti i mazzi (per la panoramica) e degli elementi del piano.
  const all = classify(ctx, ctx.items);
  const inPlan = classify(ctx, ctx.items.filter((it) => active.has(it.card.deckId)));
  const freshByDeck = new Map<string, number>();
  for (const it of inPlan.fresh) freshByDeck.set(it.card.deckId, (freshByDeck.get(it.card.deckId) ?? 0) + 1);

  const core = computeCore(ctx, active, inPlan.due.length, freshByDeck);
  const remaining = Math.max(0, core.capacity - core.daysInfo.today.reviews);

  // Ripetizioni: si scelgono le più a rischio di essere dimenticate, poi si presentano dalla più facile alla più difficile.
  const byRisk = [...inPlan.due].sort((a, b) => a.r - b.r);
  const selected = opts.deckId ? byRisk : byRisk.slice(0, remaining);
  const postponed = inPlan.due.length - selected.length;
  if (postponed > 0) {
    core.notes.unshift(`${postponed} due reviews (the ones you are most likely to still remember) are moved to the next days to keep today's session within ${ctx.prefs.dailyMinutes} minutes.`);
  }
  const ordered = [...selected].sort((a, b) => b.r - a.r);
  const warmupCount = ordered.length >= 12 ? 5 : 0;
  for (const need of core.examNeeds) {
    const title = deckById.get(need.deckId)?.title ?? "a deck";
    core.notes.push(
      `Exam for “${title}” in ${need.daysLeft} days: at least ${need.perDay} new cards a day to see all ${need.remaining} in time; no review is scheduled after the exam.`,
    );
  }

  const newItems = pickNew(ctx, inPlan.fresh, core.newLimit, core.daysInfo.today.keys);
  const toPlanItem = (item: StudyItem, stage: StageKey, state: StoredState | null): PlanItem => {
    const deck = deckById.get(item.card.deckId)!;
    const params = schedulerParams(ctx, core.retention, deck.id);
    return {
      key: item.key,
      cloze: item.cloze,
      card: item.card,
      deckId: deck.id,
      deckTitle: deck.title,
      subject: deck.subject,
      stage,
      state: state ? publicState(state) : null,
      capDue: params.capDue ?? null,
    };
  };
  const items: PlanItem[] = [
    ...ordered.map((d, i) => toPlanItem(d.item, i < warmupCount ? "warmup" : "review", d.state)),
    ...newItems.map((it) => toPlanItem(it, "new", null)),
    ...[...inPlan.learningNow].sort((a, b) => a.state.due - b.state.due).map((l) => toPlanItem(l.item, "consolidate", l.state)),
  ];

  // Mazzi deboli e card "sanguisuga" (dimenticate molte volte): da rivedere sul materiale o da riscrivere.
  const reviewLogs = core.measured.mature;
  const weakDecks: Adaptation["weakDecks"] = [];
  for (const deck of ctx.decks) {
    const logs = reviewLogs.filter((l) => l.deckId === deck.id);
    if (logs.length < 10) continue;
    const retention = logs.filter((l) => l.rating > 1).length / logs.length;
    if (retention < ctx.prefs.desiredRetention - 0.05) weakDecks.push({ deckId: deck.id, title: deck.title, retention, reviews: logs.length });
  }
  weakDecks.sort((a, b) => a.retention - b.retention);
  const itemByKey = new Map(ctx.items.map((it) => [it.key, it]));
  const leeches = [...ctx.states.values()]
    .filter((s) => s.lapses >= LEECH_LAPSES && itemByKey.has(s.key))
    .sort((a, b) => b.lapses - a.lapses)
    .slice(0, 8)
    .map((s) => {
      const card = itemByKey.get(s.key)!.card;
      const text = plainText(card.type === "image_occlusion" ? card.front || "Image occlusion" : card.front);
      return { key: s.key, deckId: s.deckId, text: text.length > 140 ? `${text.slice(0, 140)}…` : text, lapses: s.lapses };
    });

  const dueByDeck = new Map<string, number>();
  for (const d of all.due) dueByDeck.set(d.item.card.deckId, (dueByDeck.get(d.item.card.deckId) ?? 0) + 1);
  for (const l of all.learningNow) dueByDeck.set(l.item.card.deckId, (dueByDeck.get(l.item.card.deckId) ?? 0) + 1);
  const allFresh = new Map<string, number>();
  for (const it of all.fresh) allFresh.set(it.card.deckId, (allFresh.get(it.card.deckId) ?? 0) + 1);

  return {
    date: dayToIso(ctx.today),
    restDay: core.restDay,
    params: { retention: core.retention, maxIntervalDays: MAX_INTERVAL_DAYS },
    items,
    done: { reviews: core.daysInfo.today.reviews, newCards: core.daysInfo.today.newCards, minutes: Math.round(core.daysInfo.today.ms / MINUTE) },
    limits: { capacity: core.capacity, newLimit: core.newLimit, newTarget: core.newTarget },
    postponed,
    learningLater: inPlan.learningLater,
    streak: core.daysInfo.streak,
    studyDayCount: core.daysInfo.studyDayCount,
    decks: ctx.decks
      .filter((d) => d.cardCount > 0)
      .map((d) => ({
        id: d.id,
        title: d.title,
        subject: d.subject,
        due: dueByDeck.get(d.id) ?? 0,
        fresh: allFresh.get(d.id) ?? 0,
        exam: ctx.prefs.exams[d.id] ?? null,
        paused: paused.has(d.id),
      })),
    adaptation: {
      retention30: core.measured.retention30,
      reviews30: core.measured.mature.length,
      avgSeconds: Math.round(core.measured.avgSeconds * 10) / 10,
      targetRetention: ctx.prefs.desiredRetention,
      effectiveRetention: core.retention,
      notes: core.notes,
      weakDecks: weakDecks.slice(0, 4),
      leeches,
    },
  };
}

// ---------- calendario ----------

export async function buildCalendar(userId: string, fromIso: string, toIso: string): Promise<CalendarData> {
  const from = isoToDay(fromIso);
  const to = isoToDay(toIso);
  if (from === null || to === null || to < from || to - from > 62) throw new HttpError(400, "Invalid date range.");
  const now = Date.now();
  const ctx = await loadContext(userId, now);
  const { prefs, today } = ctx;
  const paused = new Set(prefs.pausedDecks);
  const active = new Set(ctx.decks.filter((d) => !paused.has(d.id)).map((d) => d.id));
  const inPlan = classify(ctx, ctx.items.filter((it) => active.has(it.card.deckId)));
  const freshByDeck = new Map<string, number>();
  for (const it of inPlan.fresh) freshByDeck.set(it.card.deckId, (freshByDeck.get(it.card.deckId) ?? 0) + 1);
  const core = computeCore(ctx, active, inPlan.due.length, freshByDeck);

  const days = new Map<number, CalendarDay>();
  for (let d = from; d <= to; d++) {
    days.set(d, { date: dayToIso(d), reviews: 0, again: 0, newCards: 0, minutes: 0, forecastDue: 0, forecastNew: 0, rest: !isStudyDay(prefs, d), exams: [] });
  }
  for (const l of ctx.logs) {
    const day = days.get(dayIndex(l.at, prefs.timezone));
    if (!day) continue;
    day.reviews++;
    if (l.rating === 1) day.again++;
    if (l.state === "new") day.newCards++;
    day.minutes += Math.min(l.durationMs, 90_000) / MINUTE;
  }
  for (const day of days.values()) day.minutes = Math.round(day.minutes);

  // Le ripetizioni scadute contano per oggi; quelle che cadono in un giorno di riposo passano al giorno di studio successivo.
  const nextStudyDay = (d: number) => {
    for (let i = 0; i < 7; i++) if (isStudyDay(prefs, d + i)) return d + i;
    return d;
  };
  const doneKeys = core.daysInfo.today.keys;
  for (const s of ctx.states.values()) {
    if (!active.has(s.deckId)) continue;
    let d = Math.max(dayIndex(s.due, prefs.timezone), today);
    if (d === today && doneKeys.has(s.key) && s.state === "review") continue;
    if (d > today) d = nextStudyDay(d);
    const day = days.get(d);
    if (day) day.forecastDue++;
  }

  // Nuove card: oggi il limite del piano, poi il ritmo dell'avvio graduale (o quello richiesto dagli esami).
  let pool = [...freshByDeck.values()].reduce((a, b) => a + b, 0);
  let futureStudyDays = 0;
  for (let d = today; d <= to && pool > 0; d++) {
    let limit: number;
    if (d === today) {
      limit = core.newLimit;
    } else if (!isStudyDay(prefs, d)) {
      continue;
    } else {
      futureStudyDays++;
      const examMin = core.examNeeds.filter((e) => d < today + e.daysLeft).reduce((a, e) => a + e.perDay, 0);
      limit = Math.max(rampedTarget(prefs, core.daysInfo.studyDayCount + futureStudyDays), examMin);
    }
    const n = Math.min(limit, pool);
    pool -= n;
    const day = days.get(d);
    if (day) day.forecastNew = n;
  }

  const deckById = new Map(ctx.decks.map((d) => [d.id, d]));
  for (const [deckId, iso] of Object.entries(prefs.exams)) {
    const d = isoToDay(iso);
    const day = d !== null ? days.get(d) : undefined;
    const deck = deckById.get(deckId);
    if (day && deck) day.exams.push({ deckId, title: deck.title });
  }
  return { today: dayToIso(today), days: [...days.values()], streak: core.daysInfo.streak };
}

// ---------- valutazioni ----------

export const ReviewsBody = z.object({
  reviews: z
    .array(
      z.object({
        id: z.uuid(),
        key: z.string().min(1).max(200),
        cardId: z.uuid(),
        deckId: z.uuid(),
        rating: z.number().int().min(1).max(4),
        durationMs: z.number().int().min(0).max(3_600_000),
        reviewedAt: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(200),
});

/** Applica in ordine le valutazioni inviate dal browser. Idempotente: una valutazione già salvata (stesso id) viene ignorata. */
export async function recordReviews(userId: string, reviews: ReviewInput[]): Promise<{ saved: number }> {
  const now = Date.now();
  const deckIds = [...new Set(reviews.map((r) => r.deckId))];
  const decks = (await getDecksByIds(deckIds)).filter((d) => canViewDeck(d, userId));
  const items = new Map(expandCards(await listCardsForDecks(decks.map((d) => d.id))).map((it) => [it.key, it]));
  const valid = reviews
    .filter((r) => items.get(r.key)?.card.id === r.cardId && items.get(r.key)?.card.deckId === r.deckId)
    .sort((a, b) => a.reviewedAt - b.reviewedAt);
  if (valid.length === 0) return { saved: 0 };

  const [prefs, logs] = await Promise.all([getPrefs(userId), loadLogs(userId)]);
  const today = dayIndex(now, prefs.timezone);
  const examDay = new Map<string, number>();
  for (const [deckId, iso] of Object.entries(prefs.exams)) {
    const day = isoToDay(iso);
    if (day !== null && day > today) examDay.set(deckId, day);
  }
  const retention = effectiveRetention(prefs.desiredRetention, measure(logs, now).retention30);

  return transaction(async (tx) => {
    const idList = valid.map((_, i) => `$${i + 2}`).join(", ");
    const existing = new Set(
      (await tx.query(`SELECT id FROM review_log WHERE user_id = $1 AND id IN (${idList})`, [userId, ...valid.map((r) => r.id)])).map((r) => str(r.id)),
    );
    const todo = valid.filter((r) => !existing.has(r.id));
    if (todo.length === 0) return { saved: 0 };
    const keys = [...new Set(todo.map((r) => r.key))];
    const keyList = keys.map((_, i) => `$${i + 2}`).join(", ");
    const states = new Map(
      (await tx.query(`SELECT * FROM card_states WHERE user_id = $1 AND item_key IN (${keyList})`, [userId, ...keys])).map((r) => [str(r.item_key), toState(r)]),
    );
    const known = new Set(states.keys());

    for (const r of todo) {
      const prev = states.get(r.key) ?? null;
      let at = Math.min(Math.max(r.reviewedAt, now - 2 * DAY), now);
      if (prev) at = Math.max(at, prev.lastReview);
      const { next, elapsedDays, scheduledDays } = schedule(prev, r.rating as Rating, at, schedulerParams({ examDay }, retention, r.deckId));
      const values = [next.state, next.step, next.due, next.stability, next.difficulty, next.reps, next.lapses, next.lastReview, now];
      if (known.has(r.key)) {
        await tx.exec(
          `UPDATE card_states SET state = $1, step = $2, due = $3, stability = $4, difficulty = $5, reps = $6, lapses = $7, last_review = $8, updated_at = $9
           WHERE user_id = $10 AND item_key = $11`,
          [...values, userId, r.key],
        );
      } else {
        await tx.exec(
          `INSERT INTO card_states (state, step, due, stability, difficulty, reps, lapses, last_review, updated_at, user_id, item_key, card_id, deck_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [...values, userId, r.key, r.cardId, r.deckId],
        );
        known.add(r.key);
      }
      await tx.exec(
        `INSERT INTO review_log (id, user_id, item_key, card_id, deck_id, rating, state, elapsed_days, scheduled_days, duration_ms, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [r.id, userId, r.key, r.cardId, r.deckId, r.rating, prev?.state ?? "new", elapsedDays, scheduledDays, Math.min(r.durationMs, 600_000), at],
      );
      states.set(r.key, { ...next, key: r.key, cardId: r.cardId, deckId: r.deckId });
    }

    const { prefs: stored, exists } = await readPrefs(tx, userId);
    if (stored.startedAt === null) await writePrefs(tx, userId, { ...stored, startedAt: todo[0].reviewedAt }, exists);
    return { saved: todo.length };
  });
}

/** Riepilogo per la pagina di un mazzo: da ripassare oggi, nuove, in apprendimento, imparate. */
export async function deckProgress(userId: string, deckId: string, cards: Parameters<typeof expandCards>[0]) {
  const [prefs, rows] = await Promise.all([getPrefs(userId), query(`SELECT * FROM card_states WHERE user_id = $1 AND deck_id = $2`, [userId, deckId])]);
  const now = Date.now();
  const today = dayIndex(now, prefs.timezone);
  const states = new Map(rows.map((r) => [str(r.item_key), toState(r)]));
  const out = { due: 0, fresh: 0, learning: 0, mature: 0, total: 0, exam: prefs.exams[deckId] ?? null };
  for (const item of expandCards(cards)) {
    out.total++;
    const s = states.get(item.key);
    if (!s) out.fresh++;
    else if (s.state !== "review") {
      out.learning++;
      if (dayIndex(s.due, prefs.timezone) <= today) out.due++;
    } else {
      if (s.stability >= 21) out.mature++;
      if (dayIndex(s.due, prefs.timezone) <= today) out.due++;
    }
  }
  return out;
}
export type DeckProgress = Awaited<ReturnType<typeof deckProgress>>;

// ---------- esami orali ----------

export type ExamTarget = { key: string; cardId: string; deckId: string; level: "poor" | "partial" };

/**
 * Mette in ripasso gli elementi degli argomenti esposti male o in modo incompleto in un esame orale.
 * Non è una ripetizione (non entra nello storico né nelle statistiche), ma lo stato FSRS cambia come dopo
 * una risposta "Again" (esposto male: da ripassare subito) o "Hard" (incompleto: al più tardi domani).
 * Una scadenza già più vicina non viene mai spostata in avanti.
 */
export async function rescheduleFromExam(userId: string, targets: ExamTarget[]): Promise<number> {
  const byKey = new Map<string, ExamTarget>();
  for (const t of targets) {
    if (byKey.get(t.key)?.level !== "poor") byKey.set(t.key, t);
  }
  if (byKey.size === 0) return 0;
  const prefs = await getPrefs(userId);
  const now = Date.now();
  const params: SchedulerParams = { retention: prefs.desiredRetention, maxIntervalDays: MAX_INTERVAL_DAYS };

  return transaction(async (tx) => {
    const keys = [...byKey.keys()];
    const keyList = keys.map((_, i) => `$${i + 2}`).join(", ");
    const states = new Map(
      (await tx.query(`SELECT * FROM card_states WHERE user_id = $1 AND item_key IN (${keyList})`, [userId, ...keys])).map((r) => [str(r.item_key), toState(r)]),
    );
    for (const t of byKey.values()) {
      const prev = states.get(t.key) ?? null;
      const { next } = schedule(prev, t.level === "poor" ? 1 : 2, now, params);
      const due = Math.min(next.due, t.level === "poor" ? now : now + DAY, prev?.due ?? Infinity);
      const values = [next.state, next.step, due, next.stability, next.difficulty, prev?.reps ?? 0, prev?.lapses ?? 0, now, now];
      if (prev) {
        await tx.exec(
          `UPDATE card_states SET state = $1, step = $2, due = $3, stability = $4, difficulty = $5, reps = $6, lapses = $7, last_review = $8, updated_at = $9
           WHERE user_id = $10 AND item_key = $11`,
          [...values, userId, t.key],
        );
      } else {
        await tx.exec(
          `INSERT INTO card_states (state, step, due, stability, difficulty, reps, lapses, last_review, updated_at, user_id, item_key, card_id, deck_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [...values, userId, t.key, t.cardId, t.deckId],
        );
      }
    }
    return byKey.size;
  });
}
