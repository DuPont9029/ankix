import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { GenerationBody } from "@/lib/decks";
import { env } from "@/lib/env";
import { requireGeminiKey } from "@/lib/gemini-key";
import { runGeneration } from "@/lib/generation";
import { handle, HttpError, readJson, requireUser } from "@/lib/http";
import { getMaterialsByIds, insertDeck, listDecks, newId } from "@/lib/repo";
import { isSubject } from "@/lib/subjects";
import type { GenerationOptions } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const scope = req.nextUrl.searchParams.get("scope") === "public" ? "public" : "mine";
  return NextResponse.json({ decks: await listDecks(user.id, scope) });
});

const Body = GenerationBody.extend({
  title: z.string().trim().max(120).optional().default(""),
  subject: z.string().refine(isSubject, "Invalid subject"),
});

export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const apiKey = await requireGeminiKey(user);
  const body = Body.parse(await readJson(req));
  const materialIds = [...new Set(body.materialIds)];
  const materials = await getMaterialsByIds(materialIds);
  if (materials.length !== materialIds.length) throw new HttpError(400, "Some of the selected materials no longer exist.");

  const options: GenerationOptions = {
    cardCount: body.cardCount,
    cardType: body.cardType,
    difficulty: body.difficulty,
    language: body.language,
    focus: body.focus.trim(),
    materialIds,
    autoTitle: !body.title,
  };
  const now = Date.now();
  const id = newId();
  await insertDeck({
    id,
    title: body.title || (materials.length === 1 ? materials[0].title : `${body.subject} – ${materials.length} materials`),
    subject: body.subject,
    description: "",
    status: "generating",
    error: null,
    options,
    sources: materials.map((m) => ({ id: m.id, title: m.title })),
    model: env.geminiModel,
    createdBy: user.name,
    createdById: user.id,
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  });

  after(() => runGeneration(id, options, apiKey));
  return NextResponse.json({ id }, { status: 202 });
});
