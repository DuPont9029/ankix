"use client";

import { ArrowLeft, CalendarDays, Check, CloudOff, Flag, Loader2, Trophy } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, SubjectBadge, buttonClass, cn } from "@/components/ui";
import { formatDelay, MINUTE, previewDelays, RATING_LABELS, RATINGS, schedule, type ItemState, type Rating } from "@/lib/srs";
import { STAGES, type DailyPlan, type PlanItem, type StageKey } from "@/lib/study-types";
import { Face } from "./card-face";
import { useReviewSync } from "./review-sync";

const LEARN_AHEAD_MS = 20 * MINUTE;

type PoolEntry = { item: PlanItem; state: ItemState };
type Current = { item: PlanItem; state: ItemState | null; stage: StageKey; shownAt: number };
type Session = {
  main: PlanItem[];
  /** Card in apprendimento che tornano nella sessione quando scadono */
  pool: PoolEntry[];
  current: Current | null;
  answered: { stage: StageKey; rating: Rating }[];
  /** Nessuna card disponibile ora: la prossima in apprendimento torna a quest'ora */
  waitingUntil: number | null;
};

function pickNext(s: Omit<Session, "current" | "waitingUntil">, now: number, ahead = false): Session {
  const pool = [...s.pool].sort((a, b) => a.state.due - b.state.due);
  const first = pool[0];
  const take = (entry: PoolEntry): Session => ({
    ...s,
    pool: pool.slice(1),
    current: { item: entry.item, state: entry.state, stage: "consolidate", shownAt: now },
    waitingUntil: null,
  });
  if (first && first.state.due <= now) return take(first);
  if (s.main.length > 0) {
    const [item, ...rest] = s.main;
    return { ...s, main: rest, pool, current: { item, state: item.state, stage: item.stage, shownAt: now }, waitingUntil: null };
  }
  if (first && (ahead || first.state.due <= now + LEARN_AHEAD_MS)) return take(first);
  return { ...s, pool, current: null, waitingUntil: first ? first.state.due : null };
}

const RATING_STYLES: Record<Rating, string> = {
  1: "border-danger text-danger hover:bg-danger-soft",
  2: "border-line-strong text-ink hover:bg-muted",
  3: "border-primary bg-primary text-on-primary hover:bg-primary-hover",
  4: "border-accent text-accent hover:bg-accent-soft",
};

export function ScheduledSession({ plan, title, backHref, onFinish }: { plan: DailyPlan; title: string; backHref: string; onFinish?: () => void }) {
  const { push, flush, status: syncStatus } = useReviewSync();
  const [session, setSession] = useState<Session>(() =>
    pickNext(
      {
        main: plan.items.filter((i) => i.stage !== "consolidate"),
        pool: plan.items.filter((i) => i.stage === "consolidate" && i.state).map((item) => ({ item, state: item.state! })),
        answered: [],
      },
      Date.now(),
    ),
  );
  const [flipped, setFlipped] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [finishing, setFinishing] = useState(false);
  const [ended, setEnded] = useState(false);

  const { current, waitingUntil } = session;
  const hasCurrent = current !== null;
  const done = ended || !current;

  // Aggiorna l'ora (anteprima degli intervalli e card in apprendimento che tornano).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // In attesa di una card in apprendimento: quando scade riprende da sola.
  useEffect(() => {
    if (ended || hasCurrent || !waitingUntil) return;
    const delay = Math.max(0, waitingUntil - LEARN_AHEAD_MS - Date.now());
    const id = setTimeout(() => setSession((s) => pickNext(s, Date.now())), Math.min(delay, 2 ** 31 - 1));
    return () => clearTimeout(id);
  }, [ended, hasCurrent, waitingUntil]);

  const params = useMemo(
    () => (current ? { ...plan.params, capDue: current.item.capDue } : null),
    [current, plan.params],
  );
  const delays = useMemo(() => (current && params ? previewDelays(current.state, now, params) : null), [current, now, params]);

  const rate = useCallback(
    (rating: Rating) => {
      if (!current || !params) return;
      const at = Date.now();
      const { next } = schedule(current.state, rating, at, params);
      push({
        id: crypto.randomUUID(),
        key: current.item.key,
        cardId: current.item.card.id,
        deckId: current.item.deckId,
        rating,
        durationMs: Math.min(at - current.shownAt, 600_000),
        reviewedAt: at,
      });
      setSession((s) => {
        // Ancora in apprendimento: torna più tardi nella sessione.
        const pool = next.state === "review" ? s.pool : [...s.pool, { item: current.item, state: next }];
        return pickNext({ main: s.main, pool, answered: [...s.answered, { stage: current.stage, rating }] }, at);
      });
      setFlipped(false);
      setPicked(null);
      setNow(at);
    },
    [current, params, push],
  );

  const pick = useCallback((i: number) => {
    setPicked(i);
    setFlipped(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (done || !current) return;
      const letter = "abcdef".indexOf(e.key.toLowerCase());
      if (!flipped && current.item.card.type === "mcq" && e.key.length === 1 && letter >= 0 && letter < current.item.card.choices.length) {
        pick(letter);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped(true);
      } else if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        rate(Number(e.key) as Rating);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, done, flipped, pick, rate]);

  // Fine sessione: salva subito quello che resta.
  useEffect(() => {
    if (done) void flush();
  }, [done, flush]);

  const stageCounts = useMemo(() => {
    const total: Record<StageKey, number> = { warmup: 0, review: 0, new: 0, consolidate: 0 };
    const doneBy: Record<StageKey, number> = { warmup: 0, review: 0, new: 0, consolidate: 0 };
    for (const it of plan.items) if (it.stage !== "consolidate") total[it.stage]++;
    for (const a of session.answered) doneBy[a.stage]++;
    total.consolidate = doneBy.consolidate + session.pool.length + (current?.stage === "consolidate" ? 1 : 0);
    return { total, done: doneBy };
  }, [current, plan.items, session.answered, session.pool.length]);

  const answeredCount = session.answered.length;
  const remainingCount = session.main.length + session.pool.length + (current ? 1 : 0);
  const progress = answeredCount / Math.max(1, answeredCount + remainingCount);
  const mcqSuggestion: Rating | null =
    current?.item.card.type === "mcq" && picked !== null ? (current.item.card.choices[picked]?.correct ? 3 : 1) : null;

  async function finish() {
    setFinishing(true);
    const ok = await flush();
    setFinishing(false);
    if (ok) onFinish?.();
  }

  const header = (
    <div className="mb-5 flex items-center justify-between gap-3">
      <Link href={backHref} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4 shrink-0" />
        <span className="truncate">{title}</span>
      </Link>
      <div className="flex items-center gap-2">
        <SyncBadge status={syncStatus} onRetry={() => void flush()} />
        {!done && (
          <Button variant="ghost" size="sm" onClick={() => setEnded(true)}>
            <Flag className="size-4" /> End session
          </Button>
        )}
      </div>
    </div>
  );

  if (done) {
    const total = session.answered.length;
    const again = session.answered.filter((a) => a.rating === 1).length;
    const comeback = !ended && session.waitingUntil ? session.waitingUntil : null;
    return (
      <div className="mx-auto max-w-3xl">
        {header}
        <div className="rounded-lg border border-line bg-card p-8 text-center shadow-raised sm:p-12">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-md border border-line bg-sunken text-accent">
            <Trophy className="size-6" />
          </div>
          <p className="eyebrow text-accent">{ended ? "Session ended" : "Path completed"}</p>
          <h2 className="mt-1 font-serif text-[28px] font-semibold text-heading">{total === 0 ? "Nothing studied yet" : "Well done!"}</h2>
          {total > 0 && (
            <p className="mt-2 text-ink-muted">
              <span className="font-semibold text-ink">{total}</span> answers · {Math.round(((total - again) / total) * 100)}% remembered
              {stageCounts.done.new > 0 && <> · {stageCounts.done.new} new cards learned</>}
            </p>
          )}
          {comeback && (
            <p className="mx-auto mt-3 max-w-md text-[13px] text-ink-muted">
              {session.pool.length} card{session.pool.length === 1 ? "" : "s"} still being learned will come back at{" "}
              <span className="font-semibold text-ink">{new Date(comeback).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>. Keep this
              page open and the session resumes on its own, or continue now.
            </p>
          )}
          {syncStatus === "error" && (
            <p className="mx-auto mt-3 max-w-md text-[13px] text-danger">Some answers have not been saved yet. Check your connection and retry.</p>
          )}
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {comeback && (
              <Button variant="secondary" onClick={() => setSession((s) => pickNext(s, Date.now(), true))}>
                Continue now
              </Button>
            )}
            {onFinish ? (
              <Button onClick={finish} loading={finishing}>
                <Check className="size-4" /> Done
              </Button>
            ) : (
              <Link href={backHref} className={buttonClass()}>
                <Check className="size-4" /> Done
              </Link>
            )}
            <Link href="/plan" className={buttonClass("secondary")}>
              <CalendarDays className="size-4" /> Study calendar
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const card = current.item.card;
  return (
    <div className="mx-auto max-w-3xl">
      {header}

      <div className="mb-6">
        <ol className="mb-3 grid grid-cols-4 gap-1.5">
          {STAGES.map((st) => {
            const total = stageCounts.total[st.key];
            const doneN = Math.min(stageCounts.done[st.key], total);
            const active = current.stage === st.key;
            return (
              <li key={st.key} className={cn("min-w-0 rounded-md border px-2 py-1.5", active ? "border-primary bg-primary-soft" : "border-line bg-card", total === 0 && "opacity-50")}>
                <span className={cn("block truncate text-[11px] font-semibold", active ? "text-accent" : "text-ink-muted")}>{st.title}</span>
                <span className="block text-[12px] text-ink tabular-nums">
                  {doneN}/{total}
                </span>
              </li>
            );
          })}
        </ol>
        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted">
          <span className="flex min-w-0 items-center gap-2">
            <SubjectBadge subject={current.item.subject} />
            <span className="truncate">{current.item.deckTitle}</span>
          </span>
          <span className="shrink-0 tabular-nums">{remainingCount} left</span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted-strong">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="flip select-none">
        <div
          role="button"
          tabIndex={0}
          aria-label={flipped ? "Answer shown" : "Show answer"}
          onClick={() => setFlipped(true)}
          className={cn("flip-inner grid cursor-pointer", flipped && "flipped")}
        >
          {(["front", "back"] as const).map((side) => (
            <div
              key={side}
              aria-hidden={side === "front" ? flipped : !flipped}
              className={cn(
                "flip-face flex min-h-[320px] flex-col items-center justify-center rounded-lg border bg-card p-6 text-center shadow-raised [grid-area:1/1] sm:min-h-[380px] sm:p-10",
                side === "back" ? "flip-back border-primary" : "border-line",
              )}
            >
              <span className={cn("eyebrow mb-5", side === "back" ? "text-accent" : "text-ink-faint")}>
                {side === "front"
                  ? current.state === null
                    ? "New card"
                    : current.state.state === "review"
                      ? "Review"
                      : "Learning"
                  : card.type === "mcq" && picked !== null
                    ? card.choices[picked]?.correct
                      ? "Correct"
                      : "Wrong"
                    : "Answer"}
              </span>
              <Face item={current.item} side={side} picked={picked} onPick={pick} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {flipped && delays ? (
          <div className="grid grid-cols-4 gap-2">
            {RATINGS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => rate(g)}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-md border px-1 py-2 font-semibold transition active:scale-[0.99]",
                  RATING_STYLES[g],
                  mcqSuggestion === g && "ring-2 ring-primary ring-offset-2 ring-offset-bg",
                )}
              >
                <span className="text-[14px]">{RATING_LABELS[g]}</span>
                <span className="text-[11px] font-medium opacity-80 tabular-nums">{formatDelay(delays[g])}</span>
              </button>
            ))}
          </div>
        ) : (
          <Button size="lg" className="w-full" onClick={() => setFlipped(true)}>
            Show answer
          </Button>
        )}
        <p className="mt-4 hidden text-right text-xs text-ink-faint sm:block">
          {card.type === "mcq" && !flipped ? "A–D: pick · " : ""}Space: show answer · 1 Again · 2 Hard · 3 Good · 4 Easy
        </p>
      </div>
    </div>
  );
}

function SyncBadge({ status, onRetry }: { status: ReturnType<typeof useReviewSync>["status"]; onRetry: () => void }) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-ink-faint">
        <Loader2 className="size-3.5 animate-spin" /> Saving
      </span>
    );
  }
  if (status === "error") {
    return (
      <button type="button" onClick={onRetry} className="inline-flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-danger hover:underline">
        <CloudOff className="size-3.5" /> Not saved · retry
      </button>
    );
  }
  return null;
}
