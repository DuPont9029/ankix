import { formatGrade, PASS_GRADE } from "@/lib/exam-types";
import { cn } from "../styles";

/** Colori del voto: lode, superato, insufficiente. */
export function gradeTone(grade: number, honors: boolean): string {
  if (honors) return "bg-highlight text-on-highlight";
  return grade >= PASS_GRADE ? "bg-primary-soft text-accent" : "bg-danger-soft text-on-danger-soft";
}

export function GradeBadge({ grade, honors, className }: { grade: number; honors: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums", gradeTone(grade, honors), className)}>
      {formatGrade(grade, honors)}
    </span>
  );
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
