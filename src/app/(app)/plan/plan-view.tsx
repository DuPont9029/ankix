"use client";

import {
  AlertTriangle,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Flame,
  GraduationCap,
  Play,
  Save,
  Settings2,
  Target,
  Timer,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useTimezoneSync } from "@/components/study/plan-utils";
import { Button, Input, Label, PageHeader, Select, Spinner, SubjectBadge, Switch, buttonClass, cn } from "@/components/ui";
import { api } from "@/lib/client";
import { DAY } from "@/lib/srs";
import type { CalendarData, CalendarDay, DailyPlan, StudyPrefs } from "@/lib/study-types";
import { useApiErrorToast } from "@/lib/use-api-error";

const WEEKDAYS = [
  { day: 1, short: "Mon" },
  { day: 2, short: "Tue" },
  { day: 3, short: "Wed" },
  { day: 4, short: "Thu" },
  { day: 5, short: "Fri" },
  { day: 6, short: "Sat" },
  { day: 0, short: "Sun" },
];

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function formatDay(iso: string, opts: Intl.DateTimeFormatOptions) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}

/** Sei settimane da lunedì, attorno al mese indicato (anno, mese 0–11). */
function monthGrid(year: number, month: number) {
  const first = Date.UTC(year, month, 1);
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const start = first - offset * DAY;
  return { from: isoOf(start), to: isoOf(start + 41 * DAY) };
}

function heat(reviews: number) {
  if (reviews === 0) return "";
  if (reviews < 20) return "bg-primary/15";
  if (reviews < 50) return "bg-primary/30";
  if (reviews < 100) return "bg-primary/50";
  return "bg-primary/70";
}

export function PlanView({ plan, prefs: initialPrefs }: { plan: DailyPlan; prefs: StudyPrefs }) {
  const router = useRouter();
  const showError = useApiErrorToast();
  useTimezoneSync(initialPrefs.timezone);

  const today = plan.date;
  const [cursor, setCursor] = useState(() => {
    const d = new Date(msOf(today));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  const range = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const [calendar, setCalendar] = useState<{ key: string; data: CalendarData } | null>(null);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(today);
  const rangeKey = `${range.from}:${range.to}:${version}`;

  useEffect(() => {
    let cancelled = false;
    api<CalendarData>(`/api/study/calendar?from=${range.from}&to=${range.to}`)
      .then((data) => {
        if (!cancelled) setCalendar({ key: rangeKey, data });
      })
      .catch((err) => {
        if (!cancelled) showError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [range, rangeKey, showError]);

  const loading = calendar?.key !== rangeKey;
  const days = calendar?.data.days ?? [];
  const selectedDay = days.find((d) => d.date === selected) ?? null;

  const [prefs, setPrefs] = useState(initialPrefs);
  const [saving, setSaving] = useState(false);
  const dirty =
    prefs.dailyMinutes !== initialPrefs.dailyMinutes ||
    prefs.newPerDay !== initialPrefs.newPerDay ||
    prefs.desiredRetention !== initialPrefs.desiredRetention ||
    prefs.gradualStart !== initialPrefs.gradualStart ||
    prefs.studyDays.join() !== initialPrefs.studyDays.join();

  async function patch(body: Partial<StudyPrefs>, message?: string) {
    setSaving(true);
    try {
      const res = await api<{ prefs: StudyPrefs }>("/api/study/prefs", { method: "PATCH", json: body });
      setPrefs((p) => ({ ...p, ...res.prefs }));
      setVersion((v) => v + 1);
      router.refresh();
      if (message) toast.success(message);
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  function saveRhythm() {
    void patch(
      {
        dailyMinutes: prefs.dailyMinutes,
        newPerDay: prefs.newPerDay,
        desiredRetention: prefs.desiredRetention,
        gradualStart: prefs.gradualStart,
        studyDays: prefs.studyDays,
      },
      "Study plan updated",
    );
  }

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const move = (delta: number) =>
    setCursor((c) => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });

  const { adaptation } = plan;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Study plan"
        title="Calendar"
        description="Past sessions and the reviews ahead, organised by spaced repetition around your rhythm and your exams."
        actions={
          <Link href="/today" className={buttonClass()}>
            <Play className="size-4" /> Today&apos;s path
          </Link>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-line bg-card p-4 shadow-card sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-serif text-[22px] font-semibold text-heading capitalize">{monthLabel}</h2>
            <div className="flex items-center gap-1">
              {loading && <Spinner className="mr-1 size-4" />}
              <Button variant="ghost" size="sm" onClick={() => move(-1)} aria-label="Previous month">
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const d = new Date(msOf(today));
                  setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
                  setSelected(today);
                }}
              >
                Today
              </Button>
              <Button variant="ghost" size="sm" onClick={() => move(1)} aria-label="Next month">
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w.day} className="eyebrow pb-1 text-ink-faint">
                {w.short}
              </span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const iso = isoOf(msOf(range.from) + i * DAY);
              const day = days.find((d) => d.date === iso);
              return (
                <DayCell
                  key={iso}
                  iso={iso}
                  day={day}
                  inMonth={new Date(msOf(iso)).getUTCMonth() === cursor.month}
                  isToday={iso === today}
                  past={iso < today}
                  selected={iso === selected}
                  onSelect={() => setSelected(iso)}
                />
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-primary/30" /> Reviews done
            </span>
            <span className="flex items-center gap-1.5">
              <span className="font-semibold text-ink">12</span> due · <span className="font-semibold text-accent">+5</span> new (forecast)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-[repeating-linear-gradient(135deg,var(--c-muted-strong)_0_3px,transparent_3px_6px)]" /> Rest day
            </span>
            <span className="flex items-center gap-1.5">
              <GraduationCap className="size-3.5 text-warning" /> Exam
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-card p-5 shadow-card">
            <p className="eyebrow text-accent">{selected === today ? "Today" : selected < today ? "Past day" : "Forecast"}</p>
            <h3 className="mt-0.5 font-serif text-[22px] font-semibold text-heading">{formatDay(selected, { weekday: "long", day: "numeric", month: "long" })}</h3>
            {selectedDay ? <DayDetail day={selectedDay} isPast={selected < today} isToday={selected === today} /> : <p className="mt-3 text-[13px] text-ink-muted">Loading…</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={<Flame className="size-4" />} label="Streak" value={`${calendar?.data.streak ?? plan.streak} days`} />
            <Stat
              icon={<Target className="size-4" />}
              label="Recall (30 days)"
              value={adaptation.retention30 === null ? "—" : `${Math.round(adaptation.retention30 * 100)}%`}
              hint={`target ${Math.round(adaptation.targetRetention * 100)}%`}
            />
            <Stat icon={<Timer className="size-4" />} label="Pace" value={`${adaptation.avgSeconds} s/card`} />
            <Stat icon={<BrainCircuit className="size-4" />} label="Today's capacity" value={`${plan.limits.capacity} cards`} hint={`${prefs.dailyMinutes} min`} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
            <Settings2 className="size-5 text-accent" /> Your rhythm
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">The plan fits each day into this budget and adapts it to how you actually perform.</p>
          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="minutes" hint={`${prefs.dailyMinutes} min`}>
                Time per day
              </Label>
              <input
                id="minutes"
                type="range"
                min={5}
                max={120}
                step={5}
                value={prefs.dailyMinutes}
                onChange={(e) => setPrefs({ ...prefs, dailyMinutes: Number(e.target.value) })}
                className="w-full accent-[var(--c-primary)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="newPerDay">New cards / day</Label>
                <Input
                  id="newPerDay"
                  type="number"
                  min={0}
                  max={200}
                  value={prefs.newPerDay}
                  onChange={(e) => setPrefs({ ...prefs, newPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })}
                />
              </div>
              <div>
                <Label htmlFor="retention">Target recall</Label>
                <Select id="retention" value={prefs.desiredRetention} onChange={(e) => setPrefs({ ...prefs, desiredRetention: Number(e.target.value) })}>
                  <option value={0.8}>80% · fewer reviews</option>
                  <option value={0.85}>85%</option>
                  <option value={0.9}>90% · recommended</option>
                  <option value={0.93}>93%</option>
                  <option value={0.95}>95% · before exams</option>
                </Select>
              </div>
            </div>
            <div>
              <Label>Study days</Label>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const on = prefs.studyDays.includes(w.day);
                  return (
                    <button
                      key={w.day}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setPrefs({ ...prefs, studyDays: on ? prefs.studyDays.filter((d) => d !== w.day) : [...prefs.studyDays, w.day].sort() })
                      }
                      className={cn(
                        "h-9 min-w-12 cursor-pointer rounded-md border px-2 text-[13px] font-semibold transition",
                        on ? "border-primary bg-primary text-on-primary" : "border-line bg-card text-ink-muted hover:border-line-strong",
                      )}
                    >
                      {w.short}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[12px] text-ink-faint">On rest days there are no new cards; reviews due on those days move to the next study day.</p>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-md border border-line bg-sunken p-3">
              <div>
                <p className="text-[14px] font-semibold text-ink">Gradual start</p>
                <p className="text-[12px] text-ink-muted">
                  Begin with about a third of the new cards and add 10% for every day you study, so the workload never piles up.
                </p>
              </div>
              <Switch checked={prefs.gradualStart} onChange={(v) => setPrefs({ ...prefs, gradualStart: v })} label="Gradual start" />
            </div>
            <div className="flex justify-end">
              <Button onClick={saveRhythm} loading={saving} disabled={!dirty}>
                {!saving && <Save className="size-4" />} Save
              </Button>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-card p-5 shadow-card">
            <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
              <GraduationCap className="size-5 text-accent" /> Decks and exams
            </h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Set an exam date and the plan makes sure you see every card before it and review them in the days just ahead. Paused decks stay out of the
              daily path.
            </p>
            {plan.decks.length === 0 ? (
              <p className="mt-4 text-[13px] text-ink-faint">No decks with cards yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {plan.decks.map((d) => {
                  const paused = prefs.pausedDecks.includes(d.id);
                  const exam = prefs.exams[d.id] ?? "";
                  return (
                    <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <Link href={`/decks/${d.id}`} className={cn("block truncate text-[14px] font-semibold hover:underline", paused ? "text-ink-faint" : "text-ink")}>
                          {d.title}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2 text-[12px] text-ink-muted">
                          <SubjectBadge subject={d.subject} />
                          <span className="tabular-nums">
                            {d.due} due · {d.fresh} new
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <input
                          type="date"
                          aria-label={`Exam date for ${d.title}`}
                          value={exam}
                          min={today}
                          onChange={(e) => void patch({ exams: { [d.id]: e.target.value } }, e.target.value ? "Exam date saved" : "Exam date removed")}
                          className="h-9 rounded-md border border-line bg-card px-2 text-[13px] text-ink focus:border-primary focus:outline-none"
                        />
                        <Switch
                          checked={!paused}
                          disabled={saving}
                          onChange={(on) => void patch({ pausedDecks: on ? prefs.pausedDecks.filter((x) => x !== d.id) : [...prefs.pausedDecks, d.id] })}
                          label={paused ? `Resume ${d.title}` : `Pause ${d.title}`}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-line bg-card p-5 shadow-card">
            <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
              <BrainCircuit className="size-5 text-accent" /> What the plan learned about you
            </h2>
            <ul className="mt-3 space-y-2 text-[13px] leading-5 text-ink-muted">
              <li>
                Intervals are calculated for <span className="font-semibold text-ink">{Math.round(adaptation.effectiveRetention * 100)}%</span> recall
                {adaptation.effectiveRetention !== adaptation.targetRetention
                  ? ` (your target is ${Math.round(adaptation.targetRetention * 100)}%, corrected using your real results).`
                  : adaptation.retention30 === null
                    ? ` — after about 20 reviews of known cards it is calibrated on your real results.`
                    : "."}
              </li>
              <li>
                Measured pace: <span className="font-semibold text-ink">{adaptation.avgSeconds} s</span> per card, used to fit the daily session into{" "}
                {prefs.dailyMinutes} minutes.
              </li>
            </ul>
            {adaptation.weakDecks.length > 0 && (
              <div className="mt-4">
                <p className="eyebrow text-ink-muted">Weak spots</p>
                <ul className="mt-1.5 space-y-1.5">
                  {adaptation.weakDecks.map((w) => (
                    <li key={w.deckId} className="flex items-center justify-between gap-3 text-[13px]">
                      <Link href={`/decks/${w.deckId}`} className="truncate font-medium text-ink hover:underline">
                        {w.title}
                      </Link>
                      <span className="shrink-0 text-danger tabular-nums">{Math.round(w.retention * 100)}% recall</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12px] text-ink-faint">Try the deck&apos;s mind map to see how its concepts connect before the next review.</p>
              </div>
            )}
            {adaptation.leeches.length > 0 && (
              <div className="mt-4">
                <p className="eyebrow flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="size-3.5" /> Cards you keep forgetting
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {adaptation.leeches.map((l) => (
                    <li key={l.key} className="flex items-start justify-between gap-3 text-[13px]">
                      <Link href={`/decks/${l.deckId}`} className="line-clamp-2 text-ink hover:underline">
                        {l.text}
                      </Link>
                      <span className="shrink-0 text-ink-muted tabular-nums">{l.lapses}×</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[12px] text-ink-faint">Rewriting them in simpler words or adding a mnemonic usually helps more than repeating them.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function DayCell({
  iso,
  day,
  inMonth,
  isToday,
  past,
  selected,
  onSelect,
}: {
  iso: string;
  day: CalendarDay | undefined;
  inMonth: boolean;
  isToday: boolean;
  past: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const showForecast = !past && day && (day.forecastDue > 0 || day.forecastNew > 0);
  const label = [
    formatDay(iso, { weekday: "long", day: "numeric", month: "long" }),
    day && day.reviews > 0 ? `${day.reviews} reviews done` : "",
    showForecast ? `${day.forecastDue} due, ${day.forecastNew} new planned` : "",
    day?.exams.length ? `Exam: ${day.exams.map((e) => e.title).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "relative flex aspect-square min-h-11 cursor-pointer flex-col items-stretch justify-between overflow-hidden rounded-md border p-1 text-left transition sm:aspect-[1.15] sm:p-1.5",
        selected ? "border-primary ring-1 ring-primary" : "border-line hover:border-line-strong",
        !inMonth && "opacity-40",
        day?.rest && "bg-[repeating-linear-gradient(135deg,var(--c-muted)_0_3px,transparent_3px_6px)]",
        day?.exams.length ? "border-warning" : "",
      )}
    >
      {day && day.reviews > 0 && <span aria-hidden className={cn("absolute inset-0", heat(day.reviews))} />}
      <span className="relative flex items-center justify-between">
        <span
          className={cn(
            "grid size-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums sm:size-6 sm:text-[12px]",
            isToday ? "bg-primary text-on-primary" : "text-ink",
          )}
        >
          {Number(iso.slice(8))}
        </span>
        {day?.exams.length ? <GraduationCap className="size-3.5 text-warning" /> : day?.rest && !past ? <Coffee className="hidden size-3 text-ink-faint sm:block" /> : null}
      </span>
      <span className="relative hidden text-[10px] leading-3 tabular-nums sm:block">
        {past || isToday
          ? day && day.reviews > 0 && <span className="font-semibold text-ink">{day.reviews} done</span>
          : null}
        {showForecast && !(isToday && day.reviews > 0) && (
          <>
            <span className="font-semibold text-ink">{day.forecastDue}</span>
            {day.forecastNew > 0 && <span className="font-semibold text-accent"> +{day.forecastNew}</span>}
          </>
        )}
      </span>
      {(showForecast || (day && day.reviews > 0)) && <span aria-hidden className="relative mx-auto size-1 rounded-full bg-primary sm:hidden" />}
    </button>
  );
}

function DayDetail({ day, isPast, isToday }: { day: CalendarDay; isPast: boolean; isToday: boolean }) {
  return (
    <div className="mt-3 space-y-3 text-[13px]">
      {day.exams.map((e) => (
        <Link key={e.deckId} href={`/decks/${e.deckId}`} className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 font-semibold text-warning">
          <GraduationCap className="size-4 shrink-0" /> Exam: <span className="truncate">{e.title}</span>
        </Link>
      ))}
      {(isPast || isToday) && (
        <div className="grid grid-cols-3 gap-2">
          <Mini label="Answers" value={day.reviews} />
          <Mini label="New" value={day.newCards} />
          <Mini label="Minutes" value={day.minutes} />
        </div>
      )}
      {isPast && day.reviews > 0 && (
        <p className="text-ink-muted">
          {Math.round(((day.reviews - day.again) / day.reviews) * 100)}% remembered ({day.again} × Again).
        </p>
      )}
      {isPast && day.reviews === 0 && <p className="text-ink-muted">{day.rest ? "Rest day." : "No study on this day."}</p>}
      {!isPast && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Mini label={isToday ? "Still due" : "Reviews due"} value={day.forecastDue} />
            <Mini label="New planned" value={day.forecastNew} />
          </div>
          <p className="text-[12px] text-ink-faint">
            {day.rest
              ? "Rest day: reviews falling today are moved to the next study day."
              : isToday
                ? "Forecast for the rest of today."
                : "Forecast: reviews of cards you have already studied, plus new cards at your current pace."}
          </p>
          {isToday && (
            <Link href="/today" className={buttonClass("primary", "sm")}>
              <Play className="size-3.5" /> Open today&apos;s path
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-sunken px-2.5 py-2">
      <p className="text-[11px] font-semibold text-ink-muted">{label}</p>
      <p className="font-serif text-[22px] leading-7 font-semibold text-heading tabular-nums">{value}</p>
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-card p-3.5 shadow-card">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-muted">
        <span className="text-primary">{icon}</span> {label}
      </p>
      <p className="mt-1 font-serif text-[20px] leading-6 font-semibold text-heading tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-ink-faint">{hint}</p>}
    </div>
  );
}
