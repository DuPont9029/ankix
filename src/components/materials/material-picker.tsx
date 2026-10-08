"use client";

import { Check, CheckCircle2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, Input } from "@/components/ui";
import { formatBytes } from "@/lib/files";
import type { Material } from "@/lib/types";

/** Elenco dei materiali con ricerca e selezione multipla. */
export function MaterialPicker({ materials, selected, onToggle }: { materials: Material[]; selected: string[]; onToggle: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.title.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.filename.toLowerCase().includes(q));
  }, [materials, query]);

  return (
    <>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search uploaded notes, handouts and slides…" className="pl-10" aria-label="Search materials" />
      </div>
      <ul className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
        {filtered.map((m) => {
          const active = selected.includes(m.id);
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onToggle(m.id)}
                aria-pressed={active}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3.5 py-3 text-left transition",
                  active ? "border-primary" : "border-line hover:border-line-strong",
                )}
              >
                <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[4px] border", active ? "border-heading bg-heading text-bg" : "border-line-strong")}>
                  {active && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{m.title}</span>
                  <span className="block truncate text-[11px] font-medium text-ink-muted">
                    {m.subject} · {m.filename}
                  </span>
                </span>
                <span className="rounded-[4px] bg-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted tabular-nums">{formatBytes(m.sizeBytes)}</span>
                <CheckCircle2 className={cn("size-[18px] shrink-0", active ? "text-heading" : "text-transparent")} />
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">No results.</li>}
      </ul>
    </>
  );
}
