import { NextResponse, type NextRequest } from "next/server";
import { handle, HttpError, requireUser } from "@/lib/http";
import { deleteOralExam, getOralExam } from "@/lib/repo";

export const dynamic = "force-dynamic";

type Ctx = RouteContext<"/api/exams/[id]">;

export const GET = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const exam = await getOralExam(user.id, id);
  if (!exam) throw new HttpError(404, "Exam not found.");
  return NextResponse.json({ exam });
});

/** Elimina l'esame dallo storico (le card create e le riprogrammazioni restano). */
export const DELETE = handle(async (_req: NextRequest, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await deleteOralExam(user.id, id);
  return NextResponse.json({ ok: true });
});
