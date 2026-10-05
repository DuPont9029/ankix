import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { CLOUD_PROVIDERS, PROVIDER_INFO } from "@/lib/ai/providers";
import { getAiSettings, isSecureRequest, saveAiSettings, toStatus } from "@/lib/ai/settings";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser({ allowUnjoined: true });
  return NextResponse.json(toStatus(await getAiSettings(user)));
});

const Body = z.object({ provider: z.enum(["local", ...CLOUD_PROVIDERS]) });

// Sceglie il motore AI predefinito.
export const PATCH = handle(async (req: NextRequest) => {
  const user = await requireUser({ allowUnjoined: true });
  const { provider } = Body.parse(await readJson(req));
  const settings = await getAiSettings(user);
  if (provider !== "local" && !settings.keys[provider]) {
    throw new HttpError(400, `Add your ${PROVIDER_INFO[provider].label} key first.`);
  }
  const next = { ...settings, provider };
  const res = NextResponse.json(toStatus(next));
  saveAiSettings(res, next, user.id, isSecureRequest(req));
  return res;
});
