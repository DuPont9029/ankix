import { renderCloze, renderClozeMarked } from "@/lib/cloze";
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

/** Cloze con tutte le lacune evidenziate e numerate (c1, c2…). */
export function ClozeMarkedHtml({ text, className }: { text: string; className?: string }) {
  return <CardHtml html={renderClozeMarked(text)} className={className} />;
}
