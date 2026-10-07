import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { buildPlan, getPrefs } from "@/lib/study";
import { PlanView } from "./plan-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Study plan" };

export default async function PlanPage() {
  const user = (await getCurrentUser())!;
  const [plan, prefs] = await Promise.all([buildPlan(user.id), getPrefs(user.id)]);
  return <PlanView plan={plan} prefs={prefs} />;
}
