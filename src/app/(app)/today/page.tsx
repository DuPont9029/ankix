import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { buildPlan, getPrefs } from "@/lib/study";
import { TodayView } from "./today-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const user = (await getCurrentUser())!;
  const [plan, prefs] = await Promise.all([buildPlan(user.id), getPrefs(user.id)]);
  return <TodayView plan={plan} timezone={prefs.timezone} firstName={user.name.split(" ")[0]} />;
}
