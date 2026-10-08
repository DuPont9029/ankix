import { NextResponse } from "next/server";
import { prepareQuestions, QuestionsBody } from "@/lib/exams";
import { handle, readJson, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Domande casuali del prof sui materiali scelti. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const questions = await prepareQuestions(user, QuestionsBody.parse(await readJson(req)));
  return NextResponse.json({ questions });
});
