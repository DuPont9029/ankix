// Ripartizione del formato "mixed": numeri esatti per tipo, perché i modelli (soprattutto quello locale)
// ignorano le percentuali e scrivono quasi solo domande/risposte. I quiz sono meno degli altri, ma almeno uno.
export function mixCounts(total: number): { basic: number; cloze: number; mcq: number } {
  const n = Math.max(1, Math.round(total));
  if (n === 1) return { basic: 0, cloze: 0, mcq: 1 };
  const mcq = Math.max(1, Math.round(n * 0.2));
  const cloze = Math.max(1, Math.round(n * 0.3));
  return { basic: Math.max(0, n - mcq - cloze), cloze, mcq };
}
