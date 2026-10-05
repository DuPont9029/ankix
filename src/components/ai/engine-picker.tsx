"use client";

import { Check, Cpu, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { cn } from "@/components/ui";
import { AI_PROVIDERS, PROVIDER_INFO, providerModelLabel, providerReady, type AiProvider, type AiStatus } from "@/lib/ai/providers";
import { useWebGpuProblem } from "./local-model";

/** Scelta del motore AI per una generazione: il modello locale oppure un provider cloud con la chiave dello studente. */
export function EnginePicker({ status, value, onChange }: { status: AiStatus; value: AiProvider; onChange: (p: AiProvider) => void }) {
  const gpuProblem = useWebGpuProblem();
  return (
    <div role="radiogroup" aria-label="AI engine" className="space-y-1.5">
      {AI_PROVIDERS.map((p) => {
        const ready = providerReady(status, p);
        const active = value === p;
        const warning = p === "local" ? gpuProblem : null;
        // Senza chiave la riga non è selezionabile e contiene il link alle impostazioni (niente link dentro un bottone).
        const Row = ready ? "button" : "div";
        return (
          <Row
            key={p}
            {...(ready ? { type: "button" as const, onClick: () => onChange(p) } : { "aria-disabled": true })}
            role="radio"
            aria-checked={active}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition",
              active ? "border-primary bg-card" : "border-line bg-card",
              ready && "cursor-pointer hover:border-line-strong",
              !ready && "opacity-60",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-ink-muted">
              {p === "local" ? <Cpu className="size-4" strokeWidth={1.75} /> : <Sparkles className="size-4" strokeWidth={1.75} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink">
                {PROVIDER_INFO[p].label}
                {p === "local" && <span className="ml-1.5 rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-semibold text-accent">Free · private</span>}
              </span>
              <span className={cn("block truncate text-[11px]", warning ? "text-warning" : "text-ink-muted")}>
                {warning ?? (ready ? providerModelLabel(status, p) : "API key not configured")}
              </span>
            </span>
            {ready ? (
              <Check className={cn("size-4 shrink-0", active ? "text-heading" : "text-transparent")} />
            ) : (
              <Link href="/settings" className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                <KeyRound className="size-3" /> Add key
              </Link>
            )}
          </Row>
        );
      })}
    </div>
  );
}
