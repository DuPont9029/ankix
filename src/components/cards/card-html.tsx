import { Check, X } from "lucide-react";
import { renderCloze, renderClozeMarked } from "@/lib/cloze";
import type { Choice } from "@/lib/types";
import { cn } from "../styles";

/**
 * Mostra il contenuto HTML di una card.
 * Sicuro: i campi vengono sanificati lato server (whitelist di tag senza attributi) prima del salvataggio.
 */
export function CardHtml({ html, className }: { html: string; className?: string }) {
  return <div className={cn("card-html", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function ClozeHtml({
  text,
  active = null,
  reveal = true,
  className,
}: {
  text: string;
  active?: number | null;
  reveal?: boolean;
  className?: string;
}) {
  return <CardHtml html={renderCloze(text, active, reveal)} className={className} />;
}

/**
 * Opzioni di una domanda a scelta multipla. Con `reveal` la corretta è evidenziata (e quella scelta, se sbagliata, in rosso);
 * con `onPick` le opzioni sono cliccabili.
 */
export function ChoicesHtml({
  choices,
  reveal = false,
  picked = null,
  onPick,
  className,
}: {
  choices: Choice[];
  reveal?: boolean;
  picked?: number | null;
  onPick?: (index: number) => void;
  className?: string;
}) {
  return (
    <ol className={cn("mx-auto w-full max-w-xl space-y-2 text-left", className)}>
      {choices.map((c, i) => {
        const right = reveal && c.correct;
        const wrong = reveal && !c.correct && picked === i;
        const body = (
          <>
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                right ? "border-accent bg-accent text-bg" : wrong ? "border-danger bg-danger text-bg" : "border-line-strong text-ink-muted",
              )}
            >
              {right ? <Check className="size-3.5" strokeWidth={3} /> : wrong ? <X className="size-3.5" strokeWidth={3} /> : "ABCDEF"[i]}
            </span>
            <CardHtml html={c.text} className={cn("min-w-0 flex-1", right && "font-semibold", wrong && "line-through")} />
          </>
        );
        const cls = cn(
          "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-[15px] leading-6 text-ink transition",
          right ? "border-accent bg-accent-soft" : wrong ? "border-danger bg-danger-soft" : picked === i ? "border-primary bg-primary-soft" : "border-line bg-card",
        );
        return (
          <li key={i}>
            {onPick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(i);
                }}
                className={cn(cls, "cursor-pointer text-left hover:border-primary")}
              >
                {body}
              </button>
            ) : (
              <div className={cls}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Cloze con tutte le lacune evidenziate e numerate (c1, c2…). */
export function ClozeMarkedHtml({ text, className }: { text: string; className?: string }) {
  return <CardHtml html={renderClozeMarked(text)} className={className} />;
}
