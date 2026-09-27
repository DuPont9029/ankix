import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { getGeminiKey, maskKey } from "@/lib/gemini-key";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  const key = await getGeminiKey(user);
  return <SettingsView initialMasked={key ? maskKey(key) : null} model={env.geminiModel} user={{ name: user.name, email: user.email, image: user.image }} />;
}
