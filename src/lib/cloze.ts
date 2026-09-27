// Utilità per la sintassi cloze di Anki: {{c1::risposta}} oppure {{c1::risposta::suggerimento}}
const CLOZE_RE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g;

export function hasCloze(text: string): boolean {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}

/** Numeri cloze presenti nel testo, ordinati (es. [1, 2]). */
export function clozeNumbers(text: string): number[] {
  const set = new Set<number>();
  for (const match of text.matchAll(CLOZE_RE)) {
    const n = Number.parseInt(match[1], 10);
    if (n > 0) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * Rende una cloze come HTML (il testo è già sanificato).
 * `active` = numero della cloze nascosta; `reveal` = mostra la risposta.
 */
export function renderCloze(text: string, active: number | null, reveal: boolean): string {
  return text.replace(CLOZE_RE, (_all, num: string, answer: string, hint?: string) => {
    const n = Number.parseInt(num, 10);
    if (active !== null && n === active) {
      if (reveal) return `<span class="cloze cloze-revealed">${answer}</span>`;
      return `<span class="cloze cloze-hidden">[${hint ? hint : "…"}]</span>`;
    }
    if (active === null) return `<span class="cloze cloze-revealed">${answer}</span>`;
    return answer;
  });
}

/** Tutte le lacune evidenziate con il numero di cancellatura in apice (vista elenco). */
export function renderClozeMarked(text: string): string {
  return text.replace(CLOZE_RE, (_all, num: string, answer: string) => {
    return `<span class="cloze cloze-revealed">${answer}<sup class="cloze-idx">c${Number.parseInt(num, 10)}</sup></span>`;
  });
}
