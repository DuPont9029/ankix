import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { isTextMime } from "../../files";
import { AiError, decodeText, materialHeader } from "../common";
import { httpErrorMessage, isNetworkError, type CloudBackend } from "./backend";

type ContentBlock = Anthropic.Beta.BetaTextBlockParam | Anthropic.Beta.BetaImageBlockParam | Anthropic.Beta.BetaRequestDocumentBlock;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

// Modelli che accettano il fallback lato server in caso di rifiuto dei classificatori di sicurezza.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

function client(apiKey: string): Anthropic {
  // I tentativi li gestisce generate.ts, con lo stesso criterio per tutti i provider.
  return new Anthropic({ apiKey, maxRetries: 0 });
}

function toBlocks(sources: Parameters<CloudBackend["generateJson"]>[2]["sources"]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const src of sources) {
    blocks.push({ type: "text", text: materialHeader(src) });
    if (isTextMime(src.mimeType)) {
      blocks.push({ type: "text", text: decodeText(src.bytes) });
    } else if (src.mimeType === "application/pdf") {
      blocks.push({
        type: "document",
        title: src.title.slice(0, 200),
        source: { type: "base64", media_type: "application/pdf", data: Buffer.from(src.bytes).toString("base64") },
      });
    } else if ((IMAGE_TYPES as readonly string[]).includes(src.mimeType)) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: src.mimeType as ImageType, data: Buffer.from(src.bytes).toString("base64") },
      });
    } else {
      throw new AiError(`Claude does not accept ${src.mimeType} files ("${src.title}"): convert it to JPG or PNG, or use another AI engine.`);
    }
  }
  return blocks;
}

export const anthropic: CloudBackend = {
  async verify(apiKey, model) {
    try {
      await client(apiKey).models.retrieve(model);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new Error("Invalid key: make sure you copied it in full from the Claude Console.");
      }
      throw anthropic.friendlyError(err, model);
    }
  },

  async generateJson(apiKey, model, req) {
    const content = [...toBlocks(req.sources), { type: "text" as const, text: req.prompt }];
    // Streaming: risposte lunghe (molte card) senza timeout HTTP.
    const stream = client(apiKey).beta.messages.stream({
      model,
      max_tokens: 64000,
      ...(req.system ? { system: req.system } : {}),
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: req.schema } },
      ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      throw new AiError("Claude declined to process this material. Try a different material or another AI engine.");
    }
    if (message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded") {
      throw new AiError("Claude's response was truncated: reduce the number of cards or split the material.");
    }
    const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.trim()) throw new AiError("Claude returned an empty response.");
    return text;
  },

  friendlyError(err, model) {
    if (err instanceof Anthropic.APIError) {
      const mapped = httpErrorMessage("Claude", err.status, err.message, model);
      if (mapped) return mapped;
    }
    if (err instanceof Anthropic.APIConnectionError || isNetworkError(err)) return new Error("Could not reach Claude: check the server connection.");
    return err instanceof Error ? err : new Error(String(err));
  },

  isRetryable(err) {
    if (err instanceof Anthropic.APIConnectionError || err instanceof TypeError) return true;
    return err instanceof Anthropic.APIError && err.status !== undefined && (err.status === 429 || err.status === 529 || err.status >= 500);
  },
};
