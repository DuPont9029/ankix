import { ArrowRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { buttonClass, cn } from "./styles";

export function GeminiKeyNotice({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-lg border border-accent/25 bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-highlight text-on-highlight">
          <KeyRound className="size-[18px]" />
        </span>
        <div>
          <p className="flex items-center gap-1.5 font-semibold text-heading">
            Add your Gemini key <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          </p>
          <p className="text-[13px] text-ink-muted">To generate flashcards you need your personal key (free on Google AI Studio).</p>
        </div>
      </div>
      <Link href="/settings" className={buttonClass("primary", "sm", "self-start sm:self-auto")}>
        Set up <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}
