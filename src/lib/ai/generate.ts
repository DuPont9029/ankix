import "server-only";
import type { CardInput } from "../repo";
import { sanitizeField, sanitizeTags } from "../sanitize";
import type { GenerationOptions } from "../types";
import type { CloudBackend, JsonRequest } from "./cloud/backend";
import { anthropic } from "./cloud/anthropic";
import { gemini } from "./cloud/gemini";
import { openai, openrouter } from "./cloud/openai";
import {
  AiError,
  boxesToOcclusions,
  cleanCards,
  extractJson,
  normalizeKey,
  OCCLUSION_SCHEMA,
  occlusionPrompt,
  OcclusionResponse,
  RESPONSE_SCHEMA,
  ResponseSchema,
  systemInstruction,
  userPrompt,
  type GenerationResult,
  type OcclusionImage,
  type SourceFile,
} from "./common";
import { PROVIDER_INFO, type CloudProvider } from "./providers";
import type { AiCredentials } from "./settings";

export type { GenerationResult, OcclusionImage, SourceFile };

const BACKENDS: Record<CloudProvider, CloudBackend> = { gemini, anthropic, openai, openrouter };

/** Verifica che la chiave sia valida e abbia accesso al modello scelto. */
export function verifyApiKey(provider: CloudProvider, apiKey: string, model: string): Promise<void> {
  return BACKENDS[provider].verify(apiKey, model);
}

class InvalidFormatError extends AiError {}

// Limita le generazioni simultanee per chiave, per non esaurire la quota dello studente.
const MAX_CONCURRENT_PER_KEY = 2;
const globalForQueue = globalThis as unknown as {
  __ankixGenSlots?: Map<string, { active: number; waiters: (() => void)[] }>;
};

async function acquire(apiKey: string): Promise<() => void> {
  const slots = (globalForQueue.__ankixGenSlots ??= new Map());
  let slot = slots.get(apiKey);
  if (!slot) {
    slot = { active: 0, waiters: [] };
    slots.set(apiKey, slot);
  }
  while (slot.active >= MAX_CONCURRENT_PER_KEY) {
    await new Promise<void>((resolve) => slot!.waiters.push(resolve));
  }
  slot.active++;
  return () => {
    slot!.active--;
    const next = slot!.waiters.shift();
    if (next) next();
    else if (slot!.active === 0) slots.delete(apiKey);
  };
}

/** Chiede JSON al provider (fino a 3 tentativi per errori transitori o formato non valido) e lo valida con `parse`. */
async function requestJson<T>(cred: AiCredentials, req: JsonRequest, parse: (json: unknown) => T): Promise<T> {
  const backend = BACKENDS[cred.provider];
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await backend.generateJson(cred.apiKey, cred.model, req);
      try {
        return parse(extractJson(text));
      } catch {
        throw new InvalidFormatError(`${PROVIDER_INFO[cred.provider].label} returned an invalid format.`);
      }
    } catch (err) {
      lastError = err;
      const retry = err instanceof InvalidFormatError || (!(err instanceof AiError) && backend.isRetryable(err));
      if (!retry || attempt === 2) break;
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
  }
  throw lastError instanceof AiError ? lastError : backend.friendlyError(lastError, cred.model);
}

/** Richiesta JSON generica (es. mappe mentali), con lo stesso limite di generazioni simultanee per chiave. */
export async function generateStructured<T>(cred: AiCredentials, req: JsonRequest, parse: (json: unknown) => T): Promise<T> {
  const release = await acquire(cred.apiKey);
  try {
    return await requestJson(cred, req, parse);
  } finally {
    release();
  }
}

export async function generateFlashcards(
  sources: SourceFile[],
  opts: GenerationOptions,
  subject: string,
  cred: AiCredentials,
  existingFronts: string[] = [],
): Promise<GenerationResult> {
  const release = await acquire(cred.apiKey);
  try {
    const parsed = await requestJson(
      cred,
      {
        system: systemInstruction(opts.language),
        sources,
        prompt: userPrompt(opts, subject, sources, existingFronts.map(normalizeKey)),
        schema: RESPONSE_SCHEMA,
        schemaName: "flashcards",
        temperature: 0.4,
      },
      (json) => ResponseSchema.parse(json),
    );
    const cards = cleanCards(parsed.cards, opts, existingFronts);
    if (cards.length === 0) {
      throw new AiError(
        existingFronts.length
          ? "No new flashcards: the material seems to be already covered by the deck."
          : "No valid flashcards could be generated from the material.",
      );
    }
    return {
      title: sanitizeField(parsed.title).replace(/<[^>]+>/g, "").slice(0, 120),
      description: sanitizeField(parsed.description).replace(/<[^>]+>/g, "").slice(0, 500),
      cards,
      model: cred.model,
    };
  } finally {
    release();
  }
}

/** Una card image occlusion per ogni immagine (una maschera = una card in Anki). */
export async function generateImageOcclusions(
  images: OcclusionImage[],
  opts: GenerationOptions,
  subject: string,
  cred: AiCredentials,
): Promise<GenerationResult> {
  const release = await acquire(cred.apiKey);
  const perImage = Math.max(3, Math.min(30, Math.ceil(opts.cardCount / Math.max(1, images.length))));
  const cards: CardInput[] = [];
  try {
    for (const image of images) {
      const parsed = await requestJson(
        cred,
        {
          sources: [image],
          prompt: occlusionPrompt(opts, subject, image, perImage),
          schema: OCCLUSION_SCHEMA,
          schemaName: "image_occlusion",
          temperature: 0.2,
        },
        (json) => OcclusionResponse.parse(json),
      );
      const occlusions = boxesToOcclusions(parsed.masks, perImage);
      if (occlusions.length > 0) {
        cards.push({
          type: "image_occlusion",
          front: sanitizeField(parsed.header).replace(/<[^>]+>/g, "").slice(0, 300) || image.title,
          back: "",
          extra: sanitizeField(parsed.back_extra),
          tags: sanitizeTags(parsed.tags),
          imageMaterialId: image.materialId,
          occlusions,
        });
      }
    }
    if (cards.length === 0) {
      throw new AiError(`${PROVIDER_INFO[cred.provider].label} could not find any labels or structures to mask in the selected images.`);
    }
    return { title: images.length === 1 ? images[0].title : "", description: "", cards, model: cred.model };
  } finally {
    release();
  }
}
