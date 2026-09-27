import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { verifyApiKey } from "@/lib/gemini";
import { clearGeminiKeyCookie, encryptKey, getGeminiKey, maskKey, setGeminiKeyCookie } from "@/lib/gemini-key";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser({ allowUnjoined: true });
  const key = await getGeminiKey(user);
  return NextResponse.json({ configured: Boolean(key), masked: key ? maskKey(key) : null, model: env.geminiModel });
});

const Body = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, "The key looks too short")
    .max(200, "The key looks too long")
    .regex(/^[A-Za-z0-9_\-.]+$/, "The key contains invalid characters"),
});

export const PUT = handle(async (req: NextRequest) => {
  const user = await requireUser({ allowUnjoined: true });
  const { apiKey } = Body.parse(await readJson(req));
  try {
    await verifyApiKey(apiKey);
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : "Key verification failed.");
  }
  const res = NextResponse.json({ configured: true, masked: maskKey(apiKey), model: env.geminiModel });
  const secure = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  setGeminiKeyCookie(res, encryptKey(apiKey, user.id), secure);
  return res;
});

export const DELETE = handle(async () => {
  await requireUser({ allowUnjoined: true });
  const res = NextResponse.json({ configured: false, masked: null, model: env.geminiModel });
  clearGeminiKeyCookie(res);
  return res;
});
