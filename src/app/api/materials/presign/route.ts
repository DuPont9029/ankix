import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson, requireUser } from "@/lib/http";
import { validateFile } from "@/lib/materials";
import { newId } from "@/lib/repo";
import { materialKey, presignPut } from "@/lib/s3";

export const dynamic = "force-dynamic";

const Body = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().max(100).optional().default(""),
  size: z.number().int().positive(),
});

export const POST = handle(async (req: Request) => {
  await requireUser();
  const body = Body.parse(await readJson(req));
  const contentType = validateFile(body.filename, body.mimeType, body.size);
  const id = newId();
  const key = materialKey(id, body.filename);
  const url = await presignPut(key, contentType);
  return NextResponse.json({ id, key, url, contentType });
});
