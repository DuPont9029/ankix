import "server-only";
import { z } from "zod";
import { HttpError } from "./http";
import { canViewDeck, getDeck, isDeckOwner } from "./repo";
import type { Deck } from "./types";

export const GenerationBody = z.object({
  materialIds: z.array(z.uuid()).min(1, "Select at least one material").max(10, "At most 10 materials per deck"),
  cardCount: z.number().int().min(5).max(100),
  cardType: z.enum(["basic", "cloze", "mixed"]),
  difficulty: z.enum(["base", "intermedio", "avanzato"]),
  language: z.enum(["it", "en"]),
  focus: z.string().max(1000).optional().default(""),
});

/**
 * Carica un mazzo verificando i permessi. Un mazzo privato di un altro utente
 * risponde 404 come se non esistesse, per non rivelarne l'esistenza.
 */
export async function loadDeck(id: string, user: { id: string }, mode: "view" | "own"): Promise<Deck> {
  const deck = await getDeck(id);
  if (!deck || !canViewDeck(deck, user.id)) throw new HttpError(404, "Deck not found.");
  if (mode === "own" && !isDeckOwner(deck, user.id)) {
    throw new HttpError(403, "Only the owner can edit this deck. You can save a copy.");
  }
  return deck;
}
