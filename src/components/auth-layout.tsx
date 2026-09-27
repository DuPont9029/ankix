import type { ReactNode } from "react";
import { Logo } from "./logo";

/** Impaginazione per accesso e onboarding: foglio di quaderno centrato su carta rigata. */
export function AuthLayout({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,var(--c-line)_31px,var(--c-line)_32px)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[12%] hidden w-px bg-danger/25 md:block" />
      <div className="relative w-full max-w-[420px]">
        <div className="mb-7 flex flex-col items-center text-center">
          <Logo className="size-12" />
          <p className="eyebrow mt-5 text-accent">Digital medical notebook</p>
          <h1 className="mt-1 font-serif text-[36px] leading-[44px] font-semibold tracking-[-0.02em] text-heading">Ankix</h1>
          <p className="mt-1 text-ink-muted">
            Anki flashcards from the materials of <span className="font-semibold text-ink">{className}</span>
          </p>
        </div>
        <div className="rounded-lg border border-line bg-card p-6 shadow-raised sm:p-8">{children}</div>
      </div>
    </div>
  );
}
