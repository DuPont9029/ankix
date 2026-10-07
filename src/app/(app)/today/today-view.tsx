"use client";

import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Coffee,
  Flame,
  GalleryVerticalEnd,
  GraduationCap,
  Play,
  Sparkles,
  Sunrise,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ScheduledSession } from "@/components/study/session";
import { EmptyState, PageHeader, Pill, SubjectBadge, buttonClass, cn } from "@/components/ui";
import { estimateMinutes, useTimezoneSync } from "@/components/study/plan-utils";
import { STAGES, type DailyPlan, type StageKey } from "@/lib/study-types";

function formatToday(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

export function TodayView({ plan, timezone, firstName }: { plan: DailyPlan; timezone: string; firstName: string }) {
  const router = useRouter();
  const [studying, setStudying] = useState(false);
  useTimezoneSync(timezone);

  if (studying) {
    return (
      <ScheduledSession
        plan={plan}
        title="Today's path"
        backHref="/today"
        onFinish={() => {
          setStudying(false);
          router.refresh();
        }}
      />
    );
  }

  const counts: Record<StageKey, number> = { warmup: 0, review: 0, new: 0, consolidate: 0 };
  for (const it of plan.items) counts[it.stage]++;
  const total = plan.items.length;
  const minutes = estimateMinutes(plan);
  const hasDecks = plan.decks.length > 0;
  const finishedToday = total === 0 && plan.done.reviews > 0;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Daily path"
        title={formatToday(plan.date)}
        description={`Hi ${firstName}, here is your study path for today: it starts easy and adds new material gradually.`}
        actions={
          <Link href="/plan" className={buttonClass("secondary")}>
            <CalendarDays className="size-4" /> Calendar & settings
          </Link>
        }
      />

      {!hasDecks ? (
        <EmptyState
          icon={<GalleryVerticalEnd className="size-5" />}
          title="No cards to study yet"
          description="Generate a deck from your materials (or save a copy of a shared one): it will be added to your daily plan automatically."
          action={
            <Link href="/generate" className={buttonClass()}>
              <Sparkles className="size-4" /> Generate flashcards
            </Link>
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="relative overflow-hidden rounded-lg border border-line bg-card p-6 shadow-card sm:p-8">
              <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-64 rounded-full bg-primary/5 blur-3xl" />
              <div className="relative">
                <div className="flex flex-wrap items-center gap-2">
                  {plan.restDay && (
                    <Pill tone="warning">
                      <Coffee className="size-3" /> Rest day
                    </Pill>
                  )}
                  {plan.streak > 0 && (
                    <Pill tone="primary">
                      <Flame className="size-3" /> {plan.streak}-day streak
                    </Pill>
                  )}
                  {plan.studyDayCount < 7 && (
                    <Pill>
                      <Sunrise className="size-3" /> Day {plan.studyDayCount + 1} of your plan
                    </Pill>
                  )}
                </div>
                {total > 0 ? (
                  <>
                    <p className="mt-4 font-serif text-[44px] leading-[48px] font-semibold text-heading tabular-nums">
                      {total} <span className="text-[20px] font-medium text-ink-muted">cards</span>
                    </p>
                    <p className="mt-1 text-ink-muted">
                      About <span className="font-semibold text-ink">{minutes} min</span> of your {Math.round((plan.limits.capacity * plan.adaptation.avgSeconds) / 60)}-minute
                      daily budget
                      {plan.done.reviews > 0 && <> · {plan.done.reviews} answers already today</>}.
                    </p>
                    <button type="button" onClick={() => setStudying(true)} className={buttonClass("primary", "lg", "mt-6 w-full sm:w-auto")}>
                      <Play className="size-[18px]" /> {plan.done.reviews > 0 ? "Continue today's path" : "Start today's path"}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mt-4 flex items-center gap-2 font-serif text-[28px] leading-9 font-semibold text-heading">
                      <CheckCircle2 className="size-7 text-accent" /> {finishedToday ? "Done for today" : "Nothing due today"}
                    </p>
                    <p className="mt-1 text-ink-muted">
                      {finishedToday
                        ? `${plan.done.reviews} answers in ${plan.done.minutes} min. The next reviews are already in the calendar.`
                        : "No reviews are due and no new cards are planned for today."}
                      {plan.learningLater > 0 && ` ${plan.learningLater} cards being learned come back later today.`}
                    </p>
                    <Link href="/plan" className={buttonClass("secondary", "md", "mt-5")}>
                      See the calendar <ArrowRight className="size-4" />
                    </Link>
                  </>
                )}
              </div>
            </div>

            <ol className="relative flex flex-col gap-3 rounded-lg border border-line bg-sunken p-5">
              <p className="eyebrow text-ink-muted">Today&apos;s path</p>
              {STAGES.map((st, i) => {
                const n = counts[st.key];
                return (
                  <li key={st.key} className={cn("flex gap-3", n === 0 && "opacity-50")}>
                    <span className={cn("grid size-7 shrink-0 place-items-center rounded-md text-xs font-bold", n > 0 ? "bg-primary text-on-primary" : "bg-muted-strong text-ink-muted")}>
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-2">
                        <span className="text-[14px] font-semibold text-ink">{st.title}</span>
                        <span className="text-[12px] text-ink-muted tabular-nums">
                          {st.key === "consolidate" ? (n > 0 ? `${n}+` : "as needed") : n}
                        </span>
                      </span>
                      <span className="block text-[12px] leading-4 text-ink-muted">{st.description}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-line bg-card p-5 shadow-card">
              <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
                <BrainCircuit className="size-5 text-accent" /> How today adapts to you
              </h2>
              {plan.adaptation.notes.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {plan.adaptation.notes.map((n) => (
                    <li key={n} className="flex gap-2 text-[13px] leading-5 text-ink-muted">
                      <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                      {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-ink-muted">
                  Your plan follows your settings for now. After a few days of study it measures your pace and how much you actually remember, and adjusts
                  new cards and intervals on its own.
                </p>
              )}
              <p className="mt-4 text-[12px] text-ink-faint">
                Intervals target {Math.round(plan.params.retention * 100)}% recall
                {plan.adaptation.retention30 !== null && <> · measured over 30 days: {Math.round(plan.adaptation.retention30 * 100)}%</>} · {plan.limits.newTarget} new
                cards/day at this stage.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-card p-5 shadow-card">
              <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
                <GraduationCap className="size-5 text-accent" /> Your decks
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {plan.decks.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link href={`/decks/${d.id}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">
                        {d.title}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                        <SubjectBadge subject={d.subject} />
                        <span className="tabular-nums">{d.due} due</span>
                        <span className="tabular-nums">{d.fresh} new</span>
                        {d.exam && <span className="font-semibold text-warning">Exam {new Date(`${d.exam}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}</span>}
                        {d.paused && <span className="text-ink-faint">Paused</span>}
                      </div>
                    </div>
                    {d.due > 0 && (
                      <Link href={`/decks/${d.id}/study?mode=due`} className={buttonClass("ghost", "sm")}>
                        Review <ArrowRight className="size-3.5" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
