import "server-only";
import { generateFlashcards, type SourceFile } from "./gemini";
import { appendCards, getDeck, getMaterialsByIds, listCards, setDeckStatus, updateDeckMeta } from "./repo";
import { getObjectBytes } from "./s3";
import type { GenerationOptions } from "./types";

/**
 * Esegue la generazione per un mazzo in stato "generating".
 * Non lancia mai: gli errori vengono salvati sul mazzo.
 */
export async function runGeneration(deckId: string, opts: GenerationOptions, apiKey: string): Promise<void> {
  try {
    const deck = await getDeck(deckId);
    if (!deck) return;

    const materials = await getMaterialsByIds(opts.materialIds);
    if (materials.length === 0) throw new Error("The selected materials no longer exist.");

    const sources: SourceFile[] = [];
    for (const m of materials) {
      try {
        sources.push({ title: m.title, filename: m.filename, mimeType: m.mimeType, bytes: await getObjectBytes(m.s3Key) });
      } catch (err) {
        console.error("[s3] download failed", m.s3Key, err);
        throw new Error(`Could not download "${m.title}" from the bucket.`);
      }
    }

    const existing = (await listCards(deckId)).map((c) => c.front);
    const result = await generateFlashcards(sources, opts, deck.subject, apiKey, existing);

    // Il mazzo potrebbe essere stato eliminato durante la generazione.
    if (!(await getDeck(deckId))) return;
    await appendCards(deckId, result.cards);
    if (opts.autoTitle && existing.length === 0) {
      await updateDeckMeta(deckId, {
        title: result.title || deck.title,
        description: deck.description || result.description,
      });
    } else if (!deck.description && result.description) {
      await updateDeckMeta(deckId, { description: result.description });
    }
    await setDeckStatus(deckId, "ready", { model: result.model });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error during generation.";
    console.error("[generation]", deckId, err);
    // Se il mazzo aveva già card, resta utilizzabile: segnaliamo comunque l'errore.
    await setDeckStatus(deckId, "error", { error: message }).catch(() => undefined);
  }
}
