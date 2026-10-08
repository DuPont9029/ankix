"use client";

import type { ReactNode } from "react";
import { cn } from "./styles";

// Controlli condivisi dai moduli a passi (generazione delle flashcard, esame orale).

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[];
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-1 rounded-md bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer rounded-[5px] px-2.5 py-2 text-center transition",
              active ? "bg-card shadow-card" : "hover:bg-muted-strong",
            )}
          >
            <span className={cn("flex items-center justify-center gap-1.5 text-[13px] font-semibold", active ? "text-heading" : "text-ink-muted")}>
              {o.icon}
              {o.label}
            </span>
            {o.hint && <span className={cn("mt-0.5 hidden text-[11px] sm:block", active ? "text-accent" : "text-ink-faint")}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Section({ step, title, aside, description, children }: { step: number; title: string; aside?: ReactNode; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-sunken p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-serif text-[20px] leading-7 font-semibold text-heading">
          <span className="grid size-6 place-items-center rounded-[4px] bg-primary font-sans text-xs font-bold text-on-primary">{step}</span>
          {title}
        </h2>
        {aside}
      </div>
      {description && <p className="mt-2 text-[13px] text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
