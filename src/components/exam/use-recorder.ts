"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_RECORDING_SEC } from "@/lib/exam-types";

// Registrazione dell'esame orale: audio compresso (MediaRecorder) per la trascrizione sul server e,
// se richiesto, trascrizione dal vivo con il riconoscimento vocale del browser (Web Speech API).

type SpeechAlternative = { transcript: string };
type SpeechResult = { isFinal: boolean; 0: SpeechAlternative };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(): boolean {
  return speechRecognition() !== null;
}

/** Formato più compatto supportato dal browser (opus in webm su Chrome/Firefox, AAC in mp4 su Safari). */
function pickMimeType(): string {
  for (const type of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

export type RecorderStatus = "idle" | "recording" | "paused" | "stopped";

export type Recording = { blob: Blob; durationSec: number; transcript: string };

export function useRecorder({ live, language }: { live: boolean; language: "it" | "en" }) {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const listening = useRef(false);
  const transcript = useRef("");
  // Tempo effettivo di registrazione, escluse le pause
  const activeSince = useRef<number | null>(null);
  const accumulated = useRef(0);
  const resolveStop = useRef<((r: Recording | null) => void) | null>(null);

  const seconds = useCallback(() => (accumulated.current + (activeSince.current ? Date.now() - activeSince.current : 0)) / 1000, []);

  const cleanup = useCallback(() => {
    listening.current = false;
    recognition.current?.abort();
    recognition.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audioCtx.current?.close().catch(() => undefined);
    audioCtx.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startRecognition = useCallback(() => {
    const Ctor = speechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = language === "it" ? "it-IT" : "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          transcript.current = `${transcript.current} ${r[0].transcript.trim()}`.trim();
          setFinalText(transcript.current);
        } else {
          pending += r[0].transcript;
        }
      }
      setInterim(pending.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        listening.current = false;
        setError("The browser does not allow speech recognition here: choose a cloud transcription engine.");
      }
      // "no-speech", "network", "aborted": il riconoscimento riparte da solo in onend
    };
    // Chrome interrompe il riconoscimento dopo qualche secondo di silenzio: si riavvia finché si registra.
    rec.onend = () => {
      setInterim("");
      if (listening.current) {
        try {
          rec.start();
        } catch {
          /* già avviato */
        }
      }
    };
    recognition.current = rec;
    listening.current = true;
    rec.start();
  }, [language]);

  const start = useCallback(async () => {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio.");
      return;
    }
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      setError("Microphone access was denied: allow it in the browser settings and try again.");
      return;
    }
    stream.current = media;
    chunks.current = [];
    transcript.current = "";
    setFinalText("");
    setInterim("");
    accumulated.current = 0;
    activeSince.current = Date.now();

    const mimeType = pickMimeType();
    const rec = new MediaRecorder(media, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      const blob = new Blob(chunks.current, { type: rec.mimeType || mimeType || "audio/webm" });
      const result = { blob, durationSec: Math.round(seconds()), transcript: transcript.current.trim() };
      cleanup();
      setStatus("stopped");
      resolveStop.current?.(result);
      resolveStop.current = null;
    };
    rec.start(1000);
    recorder.current = rec;

    // Livello del microfono, per mostrare che l'audio arriva.
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(media).connect(analyser);
    audioCtx.current = ctx;
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (audioCtx.current !== ctx) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
      requestAnimationFrame(tick);
    };
    tick();

    if (live) startRecognition();
    setElapsed(0);
    setStatus("recording");
  }, [cleanup, live, seconds, startRecognition]);

  const pause = useCallback(() => {
    if (recorder.current?.state !== "recording") return;
    recorder.current.pause();
    accumulated.current = seconds() * 1000;
    activeSince.current = null;
    listening.current = false;
    recognition.current?.stop();
    setLevel(0);
    setStatus("paused");
  }, [seconds]);

  const resume = useCallback(() => {
    if (recorder.current?.state !== "paused") return;
    recorder.current.resume();
    activeSince.current = Date.now();
    if (recognition.current) {
      listening.current = true;
      try {
        recognition.current.start();
      } catch {
        /* già avviato */
      }
    }
    setStatus("recording");
  }, []);

  /** Termina la registrazione; restituisce l'audio (e la trascrizione dal vivo, se attiva). */
  const stop = useCallback((): Promise<Recording | null> => {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return Promise.resolve(null);
    accumulated.current = seconds() * 1000;
    activeSince.current = null;
    listening.current = false;
    recognition.current?.stop();
    return new Promise((resolve) => {
      resolveStop.current = resolve;
      // Lascia al riconoscimento vocale il tempo di consegnare l'ultima frase.
      setTimeout(() => rec.stop(), live ? 800 : 0);
    });
  }, [live, seconds]);

  /** Annulla la registrazione senza conservare nulla. */
  const discard = useCallback(() => {
    resolveStop.current = null;
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      rec.stop();
    }
    recorder.current = null;
    activeSince.current = null;
    cleanup();
    setStatus("idle");
    setElapsed(0);
    setLevel(0);
  }, [cleanup]);

  // Cronometro e arresto automatico alla durata massima.
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => setElapsed(Math.floor(seconds())), 250);
    return () => clearInterval(id);
  }, [status, seconds]);

  return { status, elapsed, level, finalText, interim, error, start, pause, resume, stop, discard, limitReached: elapsed >= MAX_RECORDING_SEC };
}
