// Elementi di studio: una card domanda/risposta o a scelta multipla è un elemento, una cloze ne genera uno per
// ogni cancellatura e una image occlusion uno per ogni maschera (come le "card" di Anki rispetto alle "note").
// Modulo condiviso tra client e server.
import { clozeNumbers } from "./cloze";
import type { Card } from "./types";

export type StudyItem = { key: string; card: Card; cloze: number | null };

export function expandCard(card: Card): StudyItem[] {
  if (card.type === "cloze") return clozeNumbers(card.front).map((n) => ({ key: `${card.id}:${n}`, card, cloze: n }));
  if (card.type === "image_occlusion") return card.occlusions.map((o, i) => ({ key: `${card.id}:${o.id}`, card, cloze: i + 1 }));
  return [{ key: card.id, card, cloze: null }];
}

export function expandCards(cards: Card[]): StudyItem[] {
  return cards.flatMap(expandCard);
}

/** Testo semplice (senza HTML e con le cloze risolte), per anteprime brevi e prompt. */
export function plainText(html: string): string {
  return html
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
