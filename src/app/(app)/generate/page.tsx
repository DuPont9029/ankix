import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { getGeminiKey } from "@/lib/gemini-key";
import { listMaterials } from "@/lib/repo";
import { GenerateForm } from "./generate-form";

export const metadata: Metadata = { title: "Generate flashcards" };
export const dynamic = "force-dynamic";

export default async function GeneratePage({ searchParams }: PageProps<"/generate">) {
  const params = await searchParams;
  const raw = Array.isArray(params.materials) ? params.materials.join(",") : (params.materials ?? "");
  const [user, materials] = await Promise.all([getCurrentUser(), listMaterials()]);
  const hasGeminiKey = user ? Boolean(await getGeminiKey(user)) : false;
  const known = new Set(materials.map((m) => m.id));
  const initialSelection = raw
    .split(",")
    .map((s) => s.trim())
    .filter((id) => known.has(id))
    .slice(0, 10);
  return <GenerateForm materials={materials} initialSelection={initialSelection} hasGeminiKey={hasGeminiKey} model={env.geminiModel} />;
}
