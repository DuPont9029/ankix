import "server-only";
import { OCCLUSION_IMAGE_TYPES } from "./files";
import { generateFlashcards, generateImageOcclusions, type GenerationResult, type SourceFile } from "./ai/generate";
import type { AiCredentials } from "./ai/settings";
import { appendCards, getDeck, getMaterialsByIds, listCards, setDeckStatus, updateDeckMeta } from "./repo";
import { getObjectBytes } from "./s3";
import type { GenerationOptions } from "./types";

/**
 * Esegue la generazione per un mazzo in stato "generating".
 * Non lancia mai: gli errori vengono salvati sul mazzo.
 */
export async function runGeneration(deckId: string, opts: GenerationOptions, cred: AiCredentials): Promise<void> {
  try {
    const deck = await getDeck(deckId);
    if (!deck) return;

    let materials = await getMaterialsByIds(opts.materialIds);
    if (materials.length === 0) throw new Error("The selected materials no longer exist.");
    const existingCards = await listCards(deckId);

    if (opts.cardType === "image_occlusion") {
      materials = materials.filter((m) => OCCLUSION_IMAGE_TYPES.includes(m.mimeType));
      if (materials.length === 0) throw new Error("Image occlusion needs at least one image (PNG, JPG or WEBP) among the materials.");
      // "Generate more": salta le immagini che hanno già una card, per non creare duplicati.
      const done = new Set(existingCards.filter((c) => c.type === "image_occlusion").map((c) => c.imageMaterialId));
      materials = materials.filter((m) => !done.has(m.id));
      if (materials.length === 0) throw new Error("Every selected image already has an image occlusion card in this deck.");
    }

    const sources: (SourceFile & { materialId: string })[] = [];
    for (const m of materials) {
      try {
        sources.push({ title: m.title, filename: m.filename, mimeType: m.mimeType, bytes: await getObjectBytes(m.s3Key), materialId: m.id });
      } catch (err) {
        console.error("[s3] download failed", m.s3Key, err);
        throw new Error(`Could not download "${m.title}" from the bucket.`);
      }
    }

    const existing = existingCards.map((c) => c.front);
    const result: GenerationResult =
      opts.cardType === "image_occlusion"
        ? await generateImageOcclusions(sources, opts, deck.subject, cred)
        : await generateFlashcards(sources, opts, deck.subject, cred, existing);

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
