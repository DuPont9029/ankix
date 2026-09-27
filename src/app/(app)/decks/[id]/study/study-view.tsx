"use client";

import { ArrowLeft, Check, ChevronLeft, RotateCcw, Shuffle, Trophy, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CardHtml, ClozeHtml } from "@/components/cards/card-html";
import { Button, EmptyState, SubjectBadge, buttonClass, cn } from "@/components/ui";
import { clozeNumbers } from "@/lib/cloze";
import type { Card, Deck } from "@/lib/types";

type Item = { key: string; card: Card; cloze: number | null };

function expand(cards: Card[]): Item[] {
  return cards.flatMap((card): Item[] =>
    card.type === "cloze"
      ? clozeNumbers(card.front).map((n) => ({ key: `${card.id}:${n}`, card, cloze: n }))
      : [{ key: card.id, card, cloze: null }],
  );
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Face({ item, side }: { item: Item; side: "front" | "back" }) {
  const { card, cloze } = item;
  if (card.type === "cloze") {
    return (
      <div className="space-y-5">
        <ClozeHtml text={card.front} active={cloze} reveal={side === "back"} className="font-serif text-[21px] leading-9 text-ink sm:text-[24px]" />
        {side === "back" && card.extra && (
          <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />
        )}
      </div>
    );
  }
  if (side === "front") return <CardHtml html={card.front} className="font-serif text-[21px] leading-9 text-ink sm:text-[24px]" />;
  return (
    <div className="space-y-5">
      <CardHtml html={card.front} className="font-serif text-[15px] text-ink-muted italic" />
      <CardHtml html={card.back} className="text-[17px] leading-7 font-medium text-ink sm:text-lg" />
      {card.extra && <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />}
    </div>
  );
}

export function StudyView({ deck, cards }: { deck: Deck; cards: Card[] }) {
  const all = useMemo(() => expand(cards), [cards]);
  const [queue, setQueue] = useState<Item[]>(all);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, boolean>>({});

  const current = queue[index];
  const done = queue.length > 0 && index >= queue.length;
  const known = Object.values(results).filter(Boolean).length;
  const missed = queue.filter((it) => results[it.key] === false);

  const restart = useCallback((items: Item[], shuffle = false) => {
    setQueue(shuffle ? shuffled(items) : items);
    setIndex(0);
    setFlipped(false);
    setResults({});
  }, []);

  const answer = useCallback(
    (ok: boolean) => {
      if (!current) return;
      setResults((r) => ({ ...r, [current.key]: ok }));
      setFlipped(false);
      setIndex((i) => i + 1);
    },
    [current],
  );

  const back = useCallback(() => {
    if (index === 0) return;
    setFlipped(false);
    setIndex((i) => i - 1);
  }, [index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      if (done || !current) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && (e.key === "1" || e.key === "ArrowLeft")) {
        answer(false);
      } else if (flipped && (e.key === "2" || e.key === "ArrowRight")) {
        answer(true);
      } else if (e.key === "Backspace") {
        back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, back, current, done, flipped]);

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<RotateCcw className="size-5" />}
        title="No cards to study"
        action={
          <Link href={`/decks/${deck.id}`} className={buttonClass()}>
            Back to deck
          </Link>
        }
      />
    );
  }

  const progress = Math.min(index, queue.length) / queue.length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link href={`/decks/${deck.id}`} className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4 shrink-0" />
          <span className="truncate">{deck.title}</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => restart(all, true)}>
          <Shuffle className="size-4" /> Shuffle
        </Button>
      </div>

      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs font-semibold text-ink-muted">
          <SubjectBadge subject={deck.subject} />
          <span className="tabular-nums">
            {Math.min(index + 1, queue.length)} / {queue.length}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted-strong">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      {done ? (
        <div className="rounded-lg border border-line bg-card p-8 text-center shadow-raised sm:p-12">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-md border border-line bg-sunken text-accent">
            <Trophy className="size-6" />
          </div>
          <p className="eyebrow text-accent">Review finished</p>
          <h2 className="mt-1 font-serif text-[28px] font-semibold text-heading">Session complete</h2>
          <p className="mt-2 text-ink-muted">
            You got <span className="font-semibold text-ink">{known}</span> of {queue.length} cards right.
          </p>
          <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            {missed.length > 0 && (
              <Button onClick={() => restart(missed, true)}>
                <RotateCcw className="size-4" /> Review the {missed.length} missed
              </Button>
            )}
            <Button variant="secondary" onClick={() => restart(all, true)}>
              <Shuffle className="size-4" /> Start over
            </Button>
            <a href={`/api/decks/${deck.id}/export?format=apkg`} download className={buttonClass("secondary")}>
              Export to Anki
            </a>
          </div>
        </div>
      ) : (
        current && (
          <>
            <div className="flip select-none">
              <div
                role="button"
                tabIndex={0}
                aria-label={flipped ? "Show question" : "Show answer"}
                onClick={() => setFlipped((f) => !f)}
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
                      {side === "front" ? (current.card.type === "cloze" ? `Cloze ${current.cloze}` : "Question") : "Answer"}
                    </span>
                    <Face item={current} side={side} />
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6">
              {flipped ? (
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="danger" size="lg" onClick={() => answer(false)}>
                    <X className="size-5" /> Review again
                  </Button>
                  <Button size="lg" onClick={() => answer(true)}>
                    <Check className="size-5" /> I knew it
                  </Button>
                </div>
              ) : (
                <Button size="lg" className="w-full" onClick={() => setFlipped(true)}>
                  Show answer
                </Button>
              )}
              <div className="mt-4 flex items-center justify-between text-xs text-ink-faint">
                <button type="button" onClick={back} disabled={index === 0} className="inline-flex cursor-pointer items-center gap-1 hover:text-ink disabled:cursor-default disabled:opacity-40">
                  <ChevronLeft className="size-4" /> Previous
                </button>
                <span className="hidden sm:inline">Space: flip · 1/←: review again · 2/→: I knew it</span>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
