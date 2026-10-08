import "server-only";
import OpenAI, { toFile } from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import { isTextMime } from "../../files";
import { AiError, decodeText, materialHeader } from "../common";
import { httpErrorMessage, isNetworkError, type AudioRequest, type CloudBackend, type JsonRequest } from "./backend";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const OPENROUTER_URL = "https://openrouter.ai/api/v1";
// Modelli di ragionamento di OpenAI, che accettano reasoning_effort.
const REASONING_MODELS = /^(gpt-5|o\d)/;


function toParts(label: string, sources: JsonRequest["sources"]): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [];
  for (const src of sources) {
    parts.push({ type: "text", text: materialHeader(src) });
    const b64 = () => `data:${src.mimeType};base64,${Buffer.from(src.bytes).toString("base64")}`;
    if (isTextMime(src.mimeType)) {
      parts.push({ type: "text", text: decodeText(src.bytes) });
    } else if (src.mimeType === "application/pdf") {
      parts.push({ type: "file", file: { filename: src.filename, file_data: b64() } });
    } else if (IMAGE_TYPES.includes(src.mimeType)) {
      parts.push({ type: "image_url", image_url: { url: b64(), detail: "high" } });
    } else {
      throw new AiError(`${label} does not accept ${src.mimeType} files ("${src.title}"): convert it to JPG or PNG, or use another AI engine.`);
    }
  }
  return parts;
}

/** OpenAI e i servizi compatibili con la sua API (OpenRouter). */
function openAiCompatible(label: string, keyHint: string, baseURL?: string): CloudBackend {
  const client = (apiKey: string) =>
    new OpenAI({
      apiKey,
      maxRetries: 0, // i tentativi li gestisce generate.ts
      ...(baseURL ? { baseURL, defaultHeaders: { "X-Title": "Ankix" } } : {}),
    });

  const backend: CloudBackend = {
    async verify(apiKey, model) {
      try {
        if (baseURL === OPENROUTER_URL) {
          // OpenRouter: l'elenco dei modelli è pubblico, quindi si verifica la chiave stessa.
          const res = await fetch(`${OPENROUTER_URL}/key`, { headers: { Authorization: `Bearer ${apiKey}` } });
          if (res.status === 401 || res.status === 403) throw new Error(`Invalid key: make sure you copied it in full from ${keyHint}.`);
          if (!res.ok) throw new Error(`${label} answered with error ${res.status} while verifying the key.`);
        } else {
          await client(apiKey).models.retrieve(model);
        }
      } catch (err) {
        if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) {
          throw new Error(`Invalid key: make sure you copied it in full from ${keyHint}.`);
        }
        throw backend.friendlyError(err, model);
      }
    },

    async generateJson(apiKey, model, req) {
      const response = await client(apiKey).chat.completions.create({
        model,
        messages: [
          ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
          { role: "user", content: [...toParts(label, req.sources), { type: "text", text: req.prompt }] },
        ],
        response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
        ...(req.effort && !baseURL && REASONING_MODELS.test(model) ? { reasoning_effort: req.effort } : {}),
      });
      const choice = response.choices[0];
      if (choice?.message.refusal) throw new AiError(`${label} declined to process this material: ${choice.message.refusal}`);
      if (choice?.finish_reason === "length") {
        throw new AiError(`${label}'s response was truncated: reduce the number of cards or split the material.`);
      }
      if (choice?.finish_reason === "content_filter") throw new AiError(`${label} stopped the response (content filter). Try a different material.`);
      const text = choice?.message.content;
      if (!text?.trim()) throw new AiError(`${label} returned an empty response.`);
      return text;
    },

    ...(baseURL
      ? {}
      : {
          async transcribe(apiKey: string, model: string, req: AudioRequest) {
            const ext = req.audio.filename.match(/\.[a-z0-9]+$/i)?.[0] ?? ".webm";
            const result = await client(apiKey).audio.transcriptions.create({
              model,
              file: await toFile(req.audio.bytes, `exam${ext}`, { type: req.audio.mimeType }),
              language: req.language,
              // Il prompt guida la grafia dei termini tecnici; deve essere nella lingua dell'audio.
              prompt: req.hint.slice(0, 800),
              chunking_strategy: "auto",
              response_format: "json",
            });
            return result.text.trim();
          },
        }),

    friendlyError(err, model) {
      if (err instanceof OpenAI.APIConnectionError || isNetworkError(err)) return new Error(`Could not reach ${label}: check the server connection.`);
      if (err instanceof OpenAI.APIError) {
        const mapped = httpErrorMessage(label, err.status, err.message, model);
        if (mapped) return mapped;
      }
      return err instanceof Error ? err : new Error(String(err));
    },

    isRetryable(err) {
      if (err instanceof OpenAI.APIConnectionError || err instanceof TypeError) return true;
      return err instanceof OpenAI.APIError && err.status !== undefined && (err.status === 429 || err.status >= 500);
    },
  };
  return backend;
}

export const openai = openAiCompatible("OpenAI", "the OpenAI platform");
export const openrouter = openAiCompatible("OpenRouter", "OpenRouter", OPENROUTER_URL);
