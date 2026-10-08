"use client";

import { AlertTriangle, ArrowLeft, CalendarClock, CheckCircle2, GalleryVerticalEnd, Lightbulb, Mic, Route, Sparkles, ThumbsUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { formatDuration, gradeTone } from "@/components/exam/grade";
import { Button, ConfirmDialog, PageHeader, Pill, buttonClass, cn } from "@/components/ui";
import { api } from "@/lib/client";
import {
  COVERAGE_LABELS,
  CRITERIA_LABELS,
  PASS_GRADE,
  TRANSCRIBER_LABELS,
  wordCount,
  type ExamCoverage,
  type ExamCriteria,
  type OralExam,
} from "@/lib/exam-types";
import type { DeckSource } from "@/lib/types";
import { useApiErrorToast } from "@/lib/use-api-error";

const COVERAGE: Record<ExamCoverage, { label: string; tone: "primary" | "warning" | "danger" | "neutral" }> = {
  good: { label: "Well presented", tone: "primary" },
  partial: { label: "Incomplete", tone: "warning" },
  poor: { label: "Presented badly", tone: "danger" },
  missing: { label: "Not mentioned", tone: "neutral" },
};

const ORDER: Record<ExamCoverage, number> = { poor: 0, partial: 1, missing: 2, good: 3 };

type CardText = { deckId: string; text: string };

export function ExamResultView({ exam, decks, cardTexts }: { exam: OralExam; decks: DeckSource[]; cardTexts: Record<string, CardText> }) {
  const router = useRouter();
  const showError = useApiErrorToast();
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { result } = exam;
  const passed = result.grade >= PASS_GRADE;
  const topics = [...result.topics].sort((a, b) => ORDER[a.coverage] - ORDER[b.coverage]);
  const date = new Date(exam.createdAt).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });

  async function remove() {
    setDeleting(true);
    try {
      await api(`/api/exams/${exam.id}`, { method: "DELETE" });
      toast.success("Exam deleted.");
      router.push("/exam");
      router.refresh();
    } catch (err) {
      showError(err);
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link href="/exam" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Oral exams
      </Link>
      <PageHeader
        eyebrow={`Oral exam · ${date}`}
        title={exam.title}
        description={`${formatDuration(exam.durationSec)} min · ${exam.answers.length} question${exam.answers.length === 1 ? "" : "s"} · ${wordCount(exam.answers.map((a) => a.transcript).join(" "))} words · graded by ${exam.model}`}
        actions={
          <>
            <Link href={`/exam?materials=${exam.materials.map((m) => m.id).join(",")}`} className={buttonClass()}>
              <Mic className="size-4" /> Retake
            </Link>
            <Button variant="ghost" onClick={() => setConfirm(true)} aria-label="Delete exam">
              <Trash2 className="size-4" />
            </Button>
          </>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className={cn("flex flex-col items-center justify-center rounded-lg p-8 text-center", gradeTone(result.grade, result.honors))}>
          <p className="eyebrow opacity-80">Grade</p>
          <p className="mt-2 font-serif text-[72px] leading-none font-semibold tabular-nums">{result.grade}</p>
          <p className="mt-1 text-sm font-semibold opacity-80">out of 30{result.honors && " · cum laude"}</p>
          <p className="mt-4 rounded-full bg-card/60 px-3 py-1 text-xs font-bold">
            {result.honors ? "30 e lode" : passed ? "Passed" : `Not passed · ${PASS_GRADE} needed`}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-card p-5 sm:p-6">
          <p className="leading-relaxed text-ink">{result.summary}</p>
          <dl className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(Object.keys(CRITERIA_LABELS) as (keyof ExamCriteria)[]).map((k) => (
              <div key={k}>
                <div className="flex items-baseline justify-between text-sm">
                  <dt className="font-semibold text-ink">{CRITERIA_LABELS[k]}</dt>
                  <dd className="text-ink-muted tabular-nums">{result.criteria[k]}/10</dd>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", result.criteria[k] >= 6 ? "bg-primary" : result.criteria[k] >= 4 ? "bg-warning" : "bg-danger")}
                    style={{ width: `${result.criteria[k] * 10}%` }}
                  />
                </div>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Scheduled exam={exam} decks={decks} />

      <section className="rounded-lg border border-line bg-card p-5 sm:p-6">
        <h2 className="font-serif text-[20px] font-semibold text-heading">{exam.answers.length === 1 ? "Your answer" : "Question by question"}</h2>
        <ol className="mt-3 divide-y divide-line">
          {exam.answers.map((a, i) => {
            const judged = result.answers[i];
            return (
              <li key={i} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 font-semibold text-ink">
                    {exam.answers.length > 1 && `${i + 1}. `}
                    {a.question}
                  </h3>
                  {judged && <Pill tone={COVERAGE[judged.coverage].tone}>{COVERAGE_LABELS[judged.coverage]}</Pill>}
                </div>
                {judged?.feedback && <p className="mt-1 text-sm text-ink-muted">{judged.feedback}</p>}
                {a.transcript ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-accent">
                      Your answer · {formatDuration(a.durationSec)} min · {wordCount(a.transcript)} words
                    </summary>
                    <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">{a.transcript}</p>
                  </details>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">Not answered</p>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-faint">Transcribed with {TRANSCRIBER_LABELS[exam.transcriber]}: recognition errors are not counted against you.</p>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FeedbackList icon={ThumbsUp} title="What went well" items={result.strengths} />
        <FeedbackList icon={Lightbulb} title="How to improve" items={result.improvements} />
      </section>

      {result.errors.length > 0 && (
        <section className="rounded-lg border border-line bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
            <AlertTriangle className="size-5 text-danger" strokeWidth={1.75} /> Errors to correct
          </h2>
          <ul className="mt-3 space-y-3">
            {result.errors.map((e, i) => (
              <li key={i} className="rounded-md bg-sunken p-3.5 text-sm">
                <p className="text-ink-muted line-through decoration-danger/60">{e.said}</p>
                <p className="mt-1 text-ink">{e.correction}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-line bg-card p-5 sm:p-6">
        <h2 className="font-serif text-[20px] font-semibold text-heading">Topics</h2>
        <ul className="mt-3 divide-y divide-line">
          {topics.map((t, i) => {
            const linked = t.cardIds.filter((id) => cardTexts[id]);
            const fresh = t.newCardIds.filter((id) => cardTexts[id]);
            return (
              <li key={i} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{t.topic}</h3>
                  <Pill tone={COVERAGE[t.coverage].tone}>{COVERAGE[t.coverage].label}</Pill>
                </div>
                {t.comment && <p className="mt-1 text-sm text-ink-muted">{t.comment}</p>}
                {(linked.length > 0 || fresh.length > 0) && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-accent">
                      {t.coverage === "good" ? `${linked.length} related flashcards` : `${linked.length + fresh.length} flashcards scheduled for review`}
                      {fresh.length > 0 && ` (${fresh.length} new)`}
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {[...fresh, ...linked].map((id) => (
                        <li key={id} className="flex items-start gap-2 text-ink-muted">
                          {fresh.includes(id) ? <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent" /> : <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />}
                          <Link href={`/decks/${cardTexts[id].deckId}`} className="hover:text-ink hover:underline">
                            {cardTexts[id].text}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </section>


      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={remove}
        loading={deleting}
        title="Delete this exam?"
        description="The result and the transcript are removed from your history. Scheduled flashcards and the review deck are kept."
        confirmLabel="Delete"
      />
    </div>
  );
}

function Scheduled({ exam, decks }: { exam: OralExam; decks: DeckSource[] }) {
  const { rescheduled, newCards, deckId } = exam.scheduling;
  if (rescheduled === 0) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-line bg-sunken px-5 py-4 text-sm text-ink-muted">
        <CalendarClock className="size-5 shrink-0" strokeWidth={1.75} />
        {exam.result.topics.some((t) => t.coverage !== "good")
          ? "No flashcards to schedule: generate a deck from these materials to get targeted reviews after your next exam."
          : "Every topic was presented well: no extra reviews needed."}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-primary bg-primary-soft p-5 sm:flex-row sm:items-center sm:p-6">
      <CalendarClock className="size-8 shrink-0 text-accent" strokeWidth={1.5} />
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-heading">
          {rescheduled} flashcard{rescheduled === 1 ? "" : "s"} scheduled for review
          {newCards > 0 && `, including ${newCards} new on the gaps`}
        </h2>
        <p className="mt-0.5 text-sm text-ink-muted">Topics presented badly are due now; incomplete ones by tomorrow. They are already in your daily path.</p>
        {decks.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {decks.map((d) => (
              <Link
                key={d.id}
                href={`/decks/${d.id}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card px-2.5 py-0.5 text-xs font-medium text-ink hover:border-line-strong"
              >
                {d.id === deckId ? <Sparkles className="size-3 text-accent" /> : <GalleryVerticalEnd className="size-3 text-ink-muted" />}
                <span className="truncate">{d.title}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
      <Link href="/today" className={buttonClass()}>
        <Route className="size-4" /> Review now
      </Link>
    </section>
  );
}

function FeedbackList({ icon: Icon, title, items }: { icon: typeof ThumbsUp; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
        <Icon className="size-5 text-ink-muted" strokeWidth={1.75} /> {title}
      </h2>
      <ul className="mt-3 space-y-2 text-sm text-ink">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" />
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}
