"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/client";
import type { DailyPlan, StageKey } from "@/lib/study-types";

const STAGE_COST: Record<StageKey, number> = { warmup: 1, review: 1, new: 2.5, consolidate: 1 };

export function estimateMinutes(plan: DailyPlan): number {
  const seconds = plan.items.reduce((sum, it) => sum + STAGE_COST[it.stage] * plan.adaptation.avgSeconds, 0);
  return Math.max(1, Math.round(seconds / 60));
}

/** Il giorno di studio segue il fuso orario del browser: se cambia (es. in viaggio) lo aggiorna. */
export function useTimezoneSync(timezone: string) {
  const router = useRouter();
  useEffect(() => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browser || browser === timezone) return;
    api("/api/study/prefs", { method: "PATCH", json: { timezone: browser } })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [router, timezone]);
}
