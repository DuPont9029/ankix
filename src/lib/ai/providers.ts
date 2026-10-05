// Motori AI disponibili. Modulo condiviso tra client e server: niente segreti qui.

export const CLOUD_PROVIDERS = ["gemini", "anthropic", "openai", "openrouter"] as const;
export type CloudProvider = (typeof CLOUD_PROVIDERS)[number];
export type AiProvider = "local" | CloudProvider;
export const AI_PROVIDERS: readonly AiProvider[] = ["local", ...CLOUD_PROVIDERS];

/** Modello locale (Gemma 4 E4B via LiteRT-LM su WebGPU): gira nel browser, gratis, i materiali non escono dal dispositivo. */
export const LOCAL_MODEL_LABEL = "Gemma 4 E4B (local)";

export type ProviderInfo = {
  label: string;
  vendor: string;
  keyUrl?: string;
  keyPlaceholder?: string;
  keyHelp?: string;
};

export const PROVIDER_INFO: Record<AiProvider, ProviderInfo> = {
  local: { label: "Local AI", vendor: "Gemma 4 E4B · in your browser" },
  gemini: {
    label: "Google Gemini",
    vendor: "Google AI Studio",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    keyHelp: "Free key from Google AI Studio",
  },
  anthropic: {
    label: "Claude",
    vendor: "Anthropic",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    keyHelp: "Key from the Claude Console",
  },
  openai: {
    label: "OpenAI",
    vendor: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    keyHelp: "Key from the OpenAI platform",
  },
  openrouter: {
    label: "OpenRouter",
    vendor: "OpenRouter (Mistral, Llama, DeepSeek, Qwen…)",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    keyHelp: "One key for hundreds of models",
  },
};

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);
}

export function isCloudProvider(v: unknown): v is CloudProvider {
  return typeof v === "string" && (CLOUD_PROVIDERS as readonly string[]).includes(v);
}

/** Stato delle impostazioni AI dell'utente, senza le chiavi in chiaro. */
export type AiStatus = {
  /** Motore predefinito per le nuove generazioni */
  provider: AiProvider;
  cloud: Record<CloudProvider, { configured: boolean; masked: string | null; model: string; defaultModel: string }>;
};

/** Il motore scelto è utilizzabile? (il locale non richiede chiavi; WebGPU si verifica nel browser) */
export function providerReady(status: AiStatus, provider: AiProvider): boolean {
  return provider === "local" || status.cloud[provider].configured;
}

export function providerModelLabel(status: AiStatus, provider: AiProvider): string {
  return provider === "local" ? LOCAL_MODEL_LABEL : status.cloud[provider].model;
}
