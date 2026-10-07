"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import type { ReviewInput } from "@/lib/study-types";

export type SyncStatus = "idle" | "pending" | "saving" | "error";

const BATCH = 8;
const IDLE_FLUSH_MS = 20_000;

/**
 * Coda delle valutazioni da salvare. Ogni salvataggio riscrive il database sul bucket, quindi si inviano
 * a gruppi: ogni 8 valutazioni, dopo 20 s di inattività, a fine sessione e quando la pagina viene nascosta.
 * Ogni valutazione ha un id: un nuovo invio dopo un errore non la duplica.
 */
export function useReviewSync() {
  const pending = useRef<ReviewInput[]>([]);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<SyncStatus>("idle");

  /** Invia un gruppo (o attende quello già in corso). */
  const sendBatch = useCallback((): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    const batch = pending.current.slice(0, 200);
    setStatus("saving");
    const run = api<{ saved: number }>("/api/study/reviews", { method: "POST", json: { reviews: batch } })
      .then(() => {
        const sent = new Set(batch.map((r) => r.id));
        pending.current = pending.current.filter((r) => !sent.has(r.id));
        setStatus(pending.current.length ? "pending" : "idle");
        return true;
      })
      .catch(() => {
        setStatus("error");
        return false;
      })
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = run;
    return run;
  }, []);

  /** Salva tutte le valutazioni in coda; false se il salvataggio non è riuscito. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (inflight.current) await inflight.current;
    while (pending.current.length > 0) {
      if (!(await sendBatch())) return false;
    }
    setStatus("idle");
    return true;
  }, [sendBatch]);

  const push = useCallback(
    (review: ReviewInput) => {
      pending.current.push(review);
      setStatus((s) => (s === "saving" ? s : "pending"));
      if (timer.current) clearTimeout(timer.current);
      if (pending.current.length >= BATCH) void flush();
      else timer.current = setTimeout(() => void flush(), IDLE_FLUSH_MS);
    },
    [flush],
  );

  useEffect(() => {
    // Pagina nascosta o chiusa: invio con keepalive, che sopravvive alla chiusura della scheda.
    const sendNow = () => {
      if (pending.current.length === 0 || inflight.current) return;
      void fetch("/api/study/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews: pending.current.slice(0, 200) }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendNow();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current.length > 0) {
        sendNow();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    addEventListener("pagehide", sendNow);
    addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      removeEventListener("pagehide", sendNow);
      removeEventListener("beforeunload", onBeforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { push, flush, status };
}
