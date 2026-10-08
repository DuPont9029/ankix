// Trascrizione nel browser con Whisper large-v3-turbo (Transformers.js su WebGPU): l'audio non lascia il dispositivo.
// Il file web di Gemma 4 E4B accetta solo testo, quindi per la voce serve un modello dedicato.
// I file del modello (~560 MB, quantizzati a 4 bit) restano nella cache del browser dopo il primo download.
// Solo per il browser: importare questo modulo esclusivamente da componenti client.

const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm";
const WHISPER_MODEL = "onnx-community/whisper-large-v3-turbo";
export const WHISPER_LABEL = "Whisper large-v3-turbo";
const SAMPLE_RATE = 16_000;

type ProgressEvent = { status: string; file?: string; loaded?: number; total?: number };
type AsrOutput = { text: string } | { text: string }[];
type Asr = (audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput>;
type Transformers = {
  pipeline(
    task: "automatic-speech-recognition",
    model: string,
    options: { device: "webgpu"; dtype: Record<string, string>; progress_callback?: (e: ProgressEvent) => void },
  ): Promise<Asr>;
};

export type WhisperStatus =
  | { state: "idle" }
  | { state: "downloading"; received: number; total: number }
  | { state: "initializing" }
  | { state: "ready" }
  | { state: "error"; error: string };

let status: WhisperStatus = { state: "idle" };
let asr: Asr | null = null;
let loading: Promise<Asr> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: WhisperStatus) {
  status = next;
  for (const l of listeners) l();
}

export function getWhisperStatus(): WhisperStatus {
  return status;
}

export function subscribeWhisper(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** I pesi a 4 bit con attivazioni fp16 sono i più leggeri, ma richiedono il supporto fp16 della GPU. */
async function supportsF16(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter?.features.has("shader-f16") ?? false;
  } catch {
    return false;
  }
}

function ensureAsr(): Promise<Asr> {
  if (asr) return Promise.resolve(asr);
  if (loading) return loading;
  if (typeof navigator === "undefined" || !("gpu" in navigator)) {
    return Promise.reject(new Error("This browser does not support WebGPU: local transcription needs a recent Chrome or Edge."));
  }
  loading = (async () => {
    try {
      setStatus({ state: "downloading", received: 0, total: 0 });
      const { pipeline } = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ TRANSFORMERS_URL)) as Transformers;
      const dtype = (await supportsF16()) ? "q4f16" : "q4";
      const files = new Map<string, { loaded: number; total: number }>();
      asr = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
        device: "webgpu",
        dtype: { encoder_model: dtype, decoder_model_merged: dtype },
        progress_callback: (e) => {
          if (e.status === "progress" && e.file) {
            files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
            let received = 0;
            let total = 0;
            for (const f of files.values()) {
              received += f.loaded;
              total += f.total;
            }
            setStatus({ state: "downloading", received, total });
          } else if (e.status === "ready") {
            setStatus({ state: "initializing" });
          }
        },
      });
      setStatus({ state: "ready" });
      return asr;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ state: "error", error: message });
      throw new Error(`Could not load the local transcription model: ${message}`);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** Audio registrato → campioni mono a 16 kHz, il formato che Whisper si aspetta. */
async function decode(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

// Frasi che Whisper "inventa" sul silenzio (titoli di coda dei sottotitoli con cui è stato addestrato).
const HALLUCINATIONS = [
  /sottotitoli (creati|a cura|e revisione)[^.]*\.?/gi,
  /amara\.org[^.]*\.?/gi,
  /\bqtss\b\.?/gi,
  /thanks? (you )?for watching[!.]?/gi,
  /grazie (a tutti )?per (la visione|l'attenzione)[!.]?\s*$/gi,
];

function clean(text: string): string {
  let out = text;
  for (const re of HALLUCINATIONS) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

let queue: Promise<unknown> = Promise.resolve();

/** Trascrive una registrazione sul dispositivo (una alla volta: il modello usa la GPU). */
export function transcribeLocally(blob: Blob, language: "it" | "en"): Promise<string> {
  const run = async () => {
    const model = await ensureAsr();
    const audio = await decode(blob);
    if (audio.length < SAMPLE_RATE / 2) return "";
    const result = await model(audio, {
      language: language === "it" ? "italian" : "english",
      task: "transcribe",
      // Registrazioni lunghe: finestre di 30 s con un po' di sovrapposizione.
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return clean(Array.isArray(result) ? result.map((r) => r.text).join(" ") : result.text);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
