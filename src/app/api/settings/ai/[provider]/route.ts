import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/ai/generate";
import { isCloudProvider, type CloudProvider } from "@/lib/ai/providers";
import { defaultModel, getAiSettings, isSecureRequest, saveAiSettings, toStatus } from "@/lib/ai/settings";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/settings/ai/[provider]">;

async function providerParam(ctx: Ctx): Promise<CloudProvider> {
  const { provider } = await ctx.params;
  if (!isCloudProvider(provider)) throw new HttpError(404, "Unknown AI provider.");
  return provider;
}

const Body = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "The key looks too short")
    .max(300, "The key looks too long")
    .regex(/^[A-Za-z0-9_\-.]+$/, "The key contains invalid characters")
    .optional(),
  model: z
    .string()
    .trim()
    .max(120)
    .regex(/^[A-Za-z0-9_\-.:/@]*$/, "Invalid model name")
    .optional(),
  /** Usa subito questo provider come predefinito */
  makeDefault: z.boolean().optional(),
});

// Salva (dopo averla verificata) la chiave e/o il modello di un provider cloud.
export const PUT = handle(async (req: NextRequest, ctx: Ctx) => {
  const provider = await providerParam(ctx);
  const user = await requireUser({ allowUnjoined: true });
  const body = Body.parse(await readJson(req));
  const settings = await getAiSettings(user);
  const apiKey = body.apiKey ?? settings.keys[provider];
  if (!apiKey) throw new HttpError(400, "Paste your API key.");
  const model = body.model !== undefined ? body.model : (settings.models[provider] ?? "");
  try {
    await verifyApiKey(provider, apiKey, model || defaultModel(provider));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Key verification failed.");
  }
  const next = {
    provider: body.makeDefault ? provider : settings.provider,
    keys: { ...settings.keys, [provider]: apiKey },
    models: { ...settings.models, [provider]: model || undefined },
  };
  const res = NextResponse.json(toStatus(next));
  saveAiSettings(res, next, user.id, isSecureRequest(req));
  return res;
});

// Rimuove la chiave; se il provider era il predefinito si torna al modello locale.
export const DELETE = handle(async (req: NextRequest, ctx: Ctx) => {
  const provider = await providerParam(ctx);
  const user = await requireUser({ allowUnjoined: true });
  const settings = await getAiSettings(user);
  const keys = { ...settings.keys };
  delete keys[provider];
  const next = { ...settings, keys, provider: settings.provider === provider ? ("local" as const) : settings.provider };
  const res = NextResponse.json(toStatus(next));
  saveAiSettings(res, next, user.id, isSecureRequest(req));
  return res;
});
