"use client";

import { AlertTriangle, CheckCircle2, Cpu, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, Spinner } from "@/components/ui";
import { generateLocally, type LocalProgress, type LocalRunResult } from "@/lib/ai/local/generate";
import { LOCAL_MODEL_LABEL } from "@/lib/ai/providers";
import { ModelProgress, useLocalModelStatus } from "./local-model";

type RunInput = Omit<Parameters<typeof generateLocally>[0], "onProgress" | "onText" | "signal">;

type State =
  | { phase: "closed" }
  | { phase: "running"; progress: LocalProgress | null; stopping: boolean }
  | { phase: "saving"; count: number }
  | { phase: "error"; message: string; warnings: string[] };

/**
 * Generazione con il modello locale dentro una finestra di avanzamento.
 * `run` risolve con le card generate (o null se non ce ne sono / errore): il chiamante le salva
 * mentre la finestra mostra "Saving…", poi chiama `close` oppure `fail`.
 */
export function useLocalGeneration() {
  const [state, setState] = useState<State>({ phase: "closed" });
  const [text, setText] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const modelStatus = useLocalModelStatus();

  const active = state.phase === "running" || state.phase === "saving";
  // Chiudere o ricaricare la pagina interromperebbe la generazione nel browser.
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener("beforeunload", onBeforeUnload);
    return () => removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  const run = useCallback(async (input: RunInput): Promise<LocalRunResult | null> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setText("");
    setState({ phase: "running", progress: null, stopping: false });
    try {
      const result = await generateLocally({
        ...input,
        signal: controller.signal,
        onProgress: (progress) => setState((s) => (s.phase === "running" ? { ...s, progress } : s)),
        onText: (chunk, reset) => setText((prev) => (reset ? "" : (prev + chunk).slice(-2500))),
      });
      if (result.cards.length === 0) {
        setState({
          phase: "error",
          message: result.stopped ? "Stopped before any card was written." : "The local model did not produce any valid card.",
          warnings: result.warnings,
        });
        return null;
      }
      setState({ phase: "saving", count: result.cards.length });
      return result;
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : String(err), warnings: [] });
      return null;
    } finally {
      abortRef.current = null;
    }
  }, []);

  const close = useCallback(() => setState({ phase: "closed" }), []);
  const fail = useCallback((message: string) => setState({ phase: "error", message, warnings: [] }), []);

  function stop() {
    abortRef.current?.abort();
    setState((s) => (s.phase === "running" ? { ...s, stopping: true } : s));
  }

  const progress = state.phase === "running" ? state.progress : null;
  const dialog = (
    <Modal
      open={state.phase !== "closed"}
      onClose={() => (state.phase === "error" ? close() : undefined)}
      title={
        <span className="flex items-center gap-2">
          <Cpu className="size-5 text-ink-muted" strokeWidth={1.75} /> {LOCAL_MODEL_LABEL}
        </span>
      }
      size="lg"
      footer={
        state.phase === "running" ? (
          <Button variant="secondary" onClick={stop} loading={state.stopping}>
            {!state.stopping && <Square className="size-3.5" />} {state.stopping ? "Stopping…" : "Stop and keep the cards so far"}
          </Button>
        ) : state.phase === "error" ? (
          <Button variant="secondary" onClick={close}>
            Close
          </Button>
        ) : undefined
      }
    >
      {state.phase === "running" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Spinner className="size-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-heading">{progress?.message ?? "Starting…"}</p>
              {progress && progress.steps > 0 && (
                <p className="text-xs text-ink-muted tabular-nums">
                  Step {progress.step} of {progress.steps}
                  {progress.phase === "generating" && ` · ${progress.cards} cards so far`}
                </p>
              )}
            </div>
          </div>
          {progress && progress.steps > 0 && progress.phase === "generating" && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(((progress.step - 1) / progress.steps) * 100)}%` }} />
            </div>
          )}
          {(!progress || progress.phase === "model") && <ModelProgress status={modelStatus} />}
          {text && (
            <pre className="max-h-56 overflow-y-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
              {text}
            </pre>
          )}
          <p className="text-xs text-ink-faint">
            Everything runs on this device. Keep this tab open until it finishes: a long material can take a few minutes.
          </p>
        </div>
      )}
      {state.phase === "saving" && (
        <p className="flex items-center gap-2 text-sm text-ink">
          <CheckCircle2 className="size-4 text-accent" /> {state.count} cards generated. Saving…
        </p>
      )}
      {state.phase === "error" && (
        <div className="space-y-3">
          <p className="flex gap-2 rounded-md bg-danger-soft px-3.5 py-2.5 text-sm text-on-danger-soft">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {state.message}
          </p>
          {state.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-ink-muted">
              {state.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );

  return { run, close, fail, dialog, running: active };
}
