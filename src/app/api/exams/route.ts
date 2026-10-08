import { NextResponse } from "next/server";
import { ExamBody, runExam } from "@/lib/exams";
import { handle, readJson, requireUser } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Valuta un esame orale già trascritto e lo salva. */
export const POST = handle(async (req: Request) => {
  const user = await requireUser();
  const exam = await runExam(user, ExamBody.parse(await readJson(req)));
  return NextResponse.json({ exam }, { status: 201 });
});
