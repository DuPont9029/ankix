import type { Metadata } from "next";
import { getAiStatus } from "@/lib/ai/settings";
import { getCurrentUser } from "@/lib/current-user";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = (await getCurrentUser())!;
  return <SettingsView initialStatus={await getAiStatus(user)} user={{ name: user.name, email: user.email, image: user.image }} />;
}
