"use client";

import { Cpu, Download, HardDrive, Trash2 } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button, cn } from "@/components/ui";
import { formatBytes } from "@/lib/files";
import {
  clearModelCache,
  ensureEngine,
  getLocalModelStatus,
  isModelCached,
  subscribeLocalModel,
  webGpuProblem,
  type LocalModelStatus,
} from "@/lib/ai/local/engine";
import { LOCAL_MODEL_LABEL } from "@/lib/ai/providers";

const SERVER_STATUS: LocalModelStatus = { state: "idle" };

export function useLocalModelStatus(): LocalModelStatus {
  return useSyncExternalStore(subscribeLocalModel, getLocalModelStatus, () => SERVER_STATUS);
}

/** Problema WebGPU del browser corrente (null = ok o non ancora verificato). */
export function useWebGpuProblem(): string | null {
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setProblem(webGpuProblem()), 0);
    return () => clearTimeout(t);
  }, []);
  return problem;
}

export function ModelProgress({ status }: { status: LocalModelStatus }) {
  if (status.state === "downloading") {
    const pct = status.total ? Math.round((status.received / status.total) * 100) : null;
    return (
      <div>
        <div className="flex justify-between text-xs text-ink-muted tabular-nums">
          <span>Downloading the model (only the first time)</span>
          <span>
            {formatBytes(status.received)}
            {status.total ? ` / ${formatBytes(status.total)}` : ""}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full bg-accent transition-[width]", pct === null && "w-1/3 animate-[ankix-progress_1.6s_ease-in-out_infinite]")}
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
      </div>
    );
  }
  if (status.state === "initializing") return <p className="text-xs text-ink-muted">Starting the model on the GPU (can take a minute)…</p>;
  return null;
}

/** Pannello delle impostazioni: stato, download e rimozione del modello locale. */
export function LocalModelPanel() {
  const status = useLocalModelStatus();
  const problem = useWebGpuProblem();
  const [cached, setCached] = useState<boolean | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (problem) return;
    let alive = true;
    isModelCached().then((c) => alive && setCached(c)).catch(() => alive && setCached(false));
    return () => {
      alive = false;
    };
  }, [problem, status.state]);

  const busy = status.state === "downloading" || status.state === "initializing";

  async function prepare() {
    try {
      await ensureEngine();
      toast.success("Local model ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the local model");
    }
  }

  async function clear() {
    setClearing(true);
    try {
      await clearModelCache();
      setCached(false);
      toast.success("Model removed from this device");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-line bg-sunken p-4">
      <div className="flex items-start gap-3">
        <Cpu className="mt-0.5 size-5 shrink-0 text-ink-muted" strokeWidth={1.75} />
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-semibold text-ink">{LOCAL_MODEL_LABEL}</p>
          <p className="text-ink-muted">
            Runs on your GPU through WebGPU (LiteRT-LM): free, no key, and your materials never leave this device. The model (~3 GB) is downloaded once
            and kept in the browser storage.
          </p>
        </div>
      </div>
      {problem ? (
        <p className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">{problem}</p>
      ) : (
        <>
          <ModelProgress status={status} />
          {status.state === "error" && <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-on-danger-soft">{status.error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto flex items-center gap-1.5 text-xs text-ink-muted">
              <HardDrive className="size-3.5" />
              {status.state === "ready" ? "Loaded and ready" : cached ? "Downloaded on this device" : cached === false ? "Not downloaded yet" : "…"}
            </span>
            {status.state !== "ready" && (
              <Button size="sm" variant="secondary" onClick={prepare} loading={busy}>
                {!busy && <Download className="size-3.5" />} {cached ? "Load now" : "Download now"}
              </Button>
            )}
            {(cached || status.state === "ready") && (
              <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={clear} loading={clearing} disabled={busy}>
                {!clearing && <Trash2 className="size-3.5" />} Remove
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
