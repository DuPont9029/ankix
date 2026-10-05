// Modello locale: Gemma 4 E4B eseguito nel browser con LiteRT-LM su WebGPU (stesso setup di litert-lm-test).
// Il file del modello (~3 GB) viene scaricato una volta sola in OPFS; i materiali non lasciano il dispositivo.
// Solo per il browser: importare questo modulo esclusivamente da componenti client.

const LITERT_URL = "https://cdn.jsdelivr.net/npm/@litert-lm/core@0.17.1/+esm";
const MODEL_URL = "https://huggingface.co/litert-community/gemma-4-E4B-it-litert-lm/resolve/main/gemma-4-E4B-it-web.litertlm";
/** Contesto del modello (prompt + risposta) */
export const MAX_TOKENS = 8192;

type Message = { role: string; content?: string | { type: string; text?: string }[] };
type Conversation = {
  sendMessageStreaming(message: string): ReadableStream<Message> & AsyncIterable<Message>;
  cancel(): void;
  delete(): Promise<void>;
};
type Engine = {
  createConversation(config?: { preface?: { messages?: Message[] } }): Promise<Conversation>;
  delete(): Promise<void>;
};
type LiteRt = { Engine: { create(settings: { model: Blob; mainExecutorSettings?: { maxNumTokens?: number } }): Promise<Engine> } };

export type LocalModelStatus =
  | { state: "idle" }
  | { state: "unsupported"; error: string }
  | { state: "downloading"; received: number; total: number }
  | { state: "initializing" }
  | { state: "ready" }
  | { state: "error"; error: string };

let status: LocalModelStatus = { state: "idle" };
let engine: Engine | null = null;
let loading: Promise<Engine> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: LocalModelStatus) {
  status = next;
  for (const l of listeners) l();
}

export function getLocalModelStatus(): LocalModelStatus {
  return status;
}

export function subscribeLocalModel(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** null se WebGPU è disponibile, altrimenti il motivo per cui il modello locale non può girare. */
export function webGpuProblem(): string | null {
  if (typeof navigator === "undefined") return null;
  if (!("gpu" in navigator)) {
    return "This browser does not support WebGPU. Use a recent Chrome or Edge on a computer with a supported GPU, or choose a cloud AI in Settings.";
  }
  if (!navigator.storage?.getDirectory) return "This browser cannot store the model on disk (OPFS unavailable).";
  return null;
}

const MODEL_FILE = MODEL_URL.split("/").pop()!;
const DONE_MARKER = `${MODEL_FILE}.done`; // scritto solo a download completo

export async function isModelCached(): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.getFileHandle(DONE_MARKER);
    return true;
  } catch {
    return false;
  }
}

// Scarica il modello in OPFS a pezzi, così il file da diversi GB non resta in memoria.
async function getModelFile(): Promise<File> {
  const root = await navigator.storage.getDirectory();
  // Libera lo spazio occupato da altri modelli (es. versioni precedenti).
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name !== MODEL_FILE && name !== DONE_MARKER && /\.litertlm(\.done)?$/.test(name)) await root.removeEntry(name).catch(() => {});
  }
  if (await isModelCached()) return (await root.getFileHandle(MODEL_FILE)).getFile();

  await navigator.storage.persist?.().catch(() => false);
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`Model download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length") || 0);
  const handle = await root.getFileHandle(MODEL_FILE, { create: true });
  const writable = await handle.createWritable();
  const reader = res.body.getReader();
  let received = 0;
  setStatus({ state: "downloading", received, total });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      received += value.length;
      setStatus({ state: "downloading", received, total });
    }
    await writable.close();
    await root.getFileHandle(DONE_MARKER, { create: true });
  } catch (err) {
    await writable.abort().catch(() => {});
    await root.removeEntry(MODEL_FILE).catch(() => {});
    throw err;
  }
  return handle.getFile();
}

// Il runtime WASM di LiteRT-LM scrive i suoi log (INFO/WARNING/ERROR: [file.cc:riga] …) su stderr,
// che nel browser diventa console.error: li riporta al livello giusto, senza segnalarli come errori.
// Due formati: "WARNING: [npu_registry.cc:34] …" e quello di glog "W1005 21:10:53.209999 2354880 mel_filterbank.cc:137] …".
const RUNTIME_LOG = /^(?:(INFO|WARNING|ERROR|VERBOSE\d*): \[[\w./-]+\.cc:\d+\]|([IWEV])\d{4} [\d:.]+\s+\d+ [\w./-]+\.cc:\d+\])/;
let consoleFiltered = false;
function filterRuntimeLogs() {
  if (consoleFiltered) return;
  consoleFiltered = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const m = typeof args[0] === "string" ? args[0].match(RUNTIME_LOG) : null;
    const level = m ? (m[1] ?? m[2]).charAt(0) : undefined;
    if (level === "I" || level === "V") console.debug(...args);
    else if (level === "W") console.warn(...args);
    else original(...args);
  };
}

/** Carica il modello (scaricandolo se serve). Le chiamate successive riusano lo stesso motore. */
export function ensureEngine(): Promise<Engine> {
  if (engine) return Promise.resolve(engine);
  if (loading) return loading;
  const problem = webGpuProblem();
  if (problem) {
    setStatus({ state: "unsupported", error: problem });
    return Promise.reject(new Error(problem));
  }
  loading = (async () => {
    try {
      const file = await getModelFile();
      setStatus({ state: "initializing" });
      filterRuntimeLogs();
      const { Engine } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ LITERT_URL)) as LiteRt;
      engine = await Engine.create({ model: file, mainExecutorSettings: { maxNumTokens: MAX_TOKENS } });
      setStatus({ state: "ready" });
      return engine;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", error: `Could not load the local model: ${message}` });
      throw new Error(`Could not load the local model: ${message}`);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function clearModelCache(): Promise<void> {
  await engine?.delete().catch(() => {});
  engine = null;
  const root = await navigator.storage.getDirectory();
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (/\.litertlm(\.done)?$/.test(name)) await root.removeEntry(name).catch(() => {});
  }
  setStatus({ state: "idle" });
}

// Una conversazione alla volta: il motore usa un solo contesto sulla GPU.
let queue: Promise<unknown> = Promise.resolve();

export class AbortedError extends Error {
  constructor() {
    super("Stopped.");
  }
}

/**
 * Invia un prompt in una conversazione nuova (contesto pulito) e restituisce la risposta completa.
 * `onText` riceve il testo man mano che arriva.
 */
export function runPrompt(
  prompt: string,
  { system, onText, signal }: { system?: string; onText?: (chunk: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const run = async () => {
    if (signal?.aborted) throw new AbortedError();
    const eng = await ensureEngine();
    const conv = await eng.createConversation(system ? { preface: { messages: [{ role: "system", content: system }] } } : undefined);
    const onAbort = () => conv.cancel();
    signal?.addEventListener("abort", onAbort);
    let out = "";
    try {
      for await (const msg of conv.sendMessageStreaming(prompt)) {
        const parts = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : (msg.content ?? []);
        for (const part of parts) {
          if (part.type === "text" && part.text) {
            out += part.text;
            onText?.(part.text);
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) throw new AbortedError();
      throw err;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await conv.delete().catch(() => {});
    }
    if (signal?.aborted) throw new AbortedError();
    return out;
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
