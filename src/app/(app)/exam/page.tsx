import type { Metadata } from "next";
import { getAiStatus } from "@/lib/ai/settings";
import { getCurrentUser } from "@/lib/current-user";
import { listMaterials, listOralExams } from "@/lib/repo";
import { ExamView } from "./exam-view";

export const metadata: Metadata = { title: "Oral exam" };
export const dynamic = "force-dynamic";

export default async function ExamPage({ searchParams }: PageProps<"/exam">) {
  const params = await searchParams;
  const raw = Array.isArray(params.materials) ? params.materials.join(",") : (params.materials ?? "");
  const user = (await getCurrentUser())!;
  const [materials, exams, aiStatus] = await Promise.all([listMaterials(user.id), listOralExams(user.id), getAiStatus(user)]);
  const known = new Set(materials.map((m) => m.id));
  const initialSelection = raw
    .split(",")
    .map((s) => s.trim())
    .filter((id) => known.has(id))
    .slice(0, 10);
  return <ExamView materials={materials} exams={exams} aiStatus={aiStatus} initialSelection={initialSelection} />;
}
