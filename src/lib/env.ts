import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function positiveInt(name: string, fallback: number): number {
  const n = Number.parseInt(optional(name, String(fallback)), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const env = {
  get geminiModel() {
    return optional("GEMINI_MODEL", "gemini-3.6-flash");
  },
  get anthropicModel() {
    return optional("ANTHROPIC_MODEL", "claude-opus-5-5");
  },
  get openaiModel() {
    return optional("OPENAI_MODEL", "gpt-5");
  },
  get openrouterModel() {
    return optional("OPENROUTER_MODEL", "openrouter/auto");
  },
  get s3Bucket() {
    return required("S3_BUCKET");
  },
  get s3Region() {
    return optional("AWS_REGION", "us-east-1");
  },
  get s3Endpoint() {
    return process.env.AWS_S3_ENDPOINT?.trim() || undefined;
  },
  get s3ForcePathStyle() {
    return optional("AWS_S3_FORCE_PATH_STYLE", "true") === "true";
  },
  get s3Prefix() {
    return optional("S3_PREFIX", "ankix").replace(/^\/+|\/+$/g, "");
  },
  get maxUploadBytes() {
    return positiveInt("MAX_UPLOAD_MB", 50) * 1024 * 1024;
  },
  get className() {
    return optional("NEXT_PUBLIC_CLASS_NAME", "Medicine and Surgery");
  },
};
