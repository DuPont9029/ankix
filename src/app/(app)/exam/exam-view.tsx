"use client";

import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  Cpu,
  FileAudio,
  FolderOpen,
  Globe,
  GraduationCap,
  History,
  KeyRound,
  Loader2,
  Mic,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Shuffle,
  SkipForward,
  Sparkles,
  Square,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { EnginePicker } from "@/components/ai/engine-picker";
import { ModelProgress, useLocalModelStatus, useWebGpuProblem } from "@/components/ai/local-model";
import { formatDuration, GradeBadge } from "@/components/exam/grade";
import { MaterialScanner } from "@/components/exam/material-scanner";
import { speechRecognitionSupported, useRecorder, type Recording } from "@/components/exam/use-recorder";
import { Section, Segmented } from "@/components/form-section";
import { MaterialPicker } from "@/components/materials/material-picker";
import { RelativeTime } from "@/components/relative-time";
import { formatBytes } from "@/lib/files";
import { Button, EmptyState, Label, PageHeader, Textarea, buttonClass, cn } from "@/components/ui";
import { PROVIDER_INFO, providerReady, type AiProvider, type AiStatus } from "@/lib/ai/providers";
import { AbortedError, webGpuProblem } from "@/lib/ai/local/engine";
import { evaluateExamLocally, generateQuestionsLocally, loadMaterialTexts, type MaterialText } from "@/lib/ai/local/exam";
import { getWhisperStatus, subscribeWhisper, transcribeLocally, WHISPER_LABEL, type WhisperStatus } from "@/lib/ai/local/whisper";
import { api, errorMessage } from "@/lib/client";
import {
  DEFAULT_QUESTIONS,
  MAX_QUESTIONS,
  MAX_RECORDING_SEC,
  MIN_TRANSCRIPT_WORDS,
  TRANSCRIBER_LABELS,
  wordCount,
  type ExamContext,
  type ExamMode,
  type LocalEvaluation,
  type OralExam,
  type OralExamSummary,
  type Transcriber,
} from "@/lib/exam-types";
import type { Material } from "@/lib/types";
import { useApiErrorToast } from "@/lib/use-api-error";

type Setup = {
  materialIds: string[];
  mode: ExamMode;
  /** Numero di domande del prof (modalità "random") */
  count: number;
  /** Domanda scelta dallo studente (modalità "custom") */
  question: string;
  language: "it" | "en";
  provider: AiProvider;
  transcriber: Transcriber;
};

/** Risposta registrata (null = domanda saltata) e trascrizione, quando pronta. */
type Answer = { question: string; recording: Recording | null; transcript: string | null };

type Processing = {
  answers: Answer[];
  transcriber: Transcriber;
  step: "transcribing" | "evaluating";
  error: string | null;
  /** Caratteri scritti dal modello locale durante la valutazione */
  written: number;
};

const subscribeNoop = () => () => undefined;

/** Il riconoscimento vocale si verifica solo nel browser (sul server risulta non disponibile). */
function useSpeechSupport(): boolean {
  return useSyncExternalStore(subscribeNoop, speechRecognitionSupported, () => false);
}

function cloudTranscriberReady(status: AiStatus, t: Transcriber): boolean {
  return (t === "gemini" || t === "openai") && status.cloud[t].configured;
}

/** Motore predefinito dello studente (il locale non richiede chiavi). */
function defaultProvider(status: AiStatus): AiProvider {
  return providerReady(status, status.provider) ? status.provider : "local";
}

/** Con il modello locale anche la trascrizione resta sul dispositivo. */
function defaultTranscriber(status: AiStatus): Transcriber {
  if (status.provider === "local") return "local";
  if (status.cloud.gemini.configured) return "gemini";
  if (status.cloud.openai.configured) return "openai";
  return "local";
}

const EXTENSIONS: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg" };

export function ExamView({
  materials,
  exams,
  aiStatus,
  initialSelection,
}: {
  materials: Material[];
  exams: OralExamSummary[];
  aiStatus: AiStatus;
  initialSelection: string[];
}) {
  const [setup, setSetup] = useState<Setup | null>(null);

  if (setup) return <ExamRoom setup={setup} materials={materials} aiStatus={aiStatus} onExit={() => setSetup(null)} />;
  return <ExamSetup materials={materials} exams={exams} aiStatus={aiStatus} initialSelection={initialSelection} onStart={setSetup} />;
}

// ---------- preparazione ----------

function ExamSetup({
  materials,
  exams,
  aiStatus,
  initialSelection,
  onStart,
}: {
  materials: Material[];
  exams: OralExamSummary[];
  aiStatus: AiStatus;
  initialSelection: string[];
  onStart: (s: Setup) => void;
}) {
  const speech = useSpeechSupport();
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [mode, setMode] = useState<ExamMode>("random");
  const [count, setCount] = useState(DEFAULT_QUESTIONS);
  const [question, setQuestion] = useState("");
  const [language, setLanguage] = useState<"it" | "en">("en");
  const gpuProblem = useWebGpuProblem();
  const [provider, setProvider] = useState<AiProvider>(() => defaultProvider(aiStatus));
  const [transcriber, setTranscriber] = useState<Transcriber>(() => defaultTranscriber(aiStatus));
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    if (next.length > 10) {
      toast.error("You can select up to 10 materials.");
      return;
    }
    setSelected(next);
  }

  const transcriberOk = transcriber === "browser" ? speech : transcriber === "local" ? !gpuProblem : cloudTranscriberReady(aiStatus, transcriber);
  const providerOk = provider === "local" ? !gpuProblem : providerReady(aiStatus, provider);
  const canStart = selected.length > 0 && providerOk && transcriberOk && (mode === "random" || question.trim().length > 0);

  if (materials.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="Exam mode" title="Oral exam" description="Simulate an oral exam on the course materials and get a grade." />
        <EmptyState
          icon={<FolderOpen className="size-5" />}
          title="You need at least one material"
          description="Upload the PDF, slides or notes the exam is based on first."
          action={
            <Link href="/materials" className={buttonClass()}>
              <Upload className="size-4" /> Go to materials
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Exam mode"
        title="Oral exam"
        description="Choose the materials: the professor asks you random questions on them and you answer out loud, one question at a time. The AI transcribes your answers, grades the exam out of 30 and schedules the flashcards on the topics you got wrong or left incomplete."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Section
            step={1}
            title="Exam materials"
            description="The examiner checks your answer against these files. Flashcards from your decks generated from them are rescheduled."
            aside={<span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">{selected.length} selected (max 10)</span>}
          >
            <MaterialPicker materials={materials} selected={selected} onToggle={toggle} />
          </Section>

          <Section step={2} title="Questions">
            <Segmented
              name="Questions"
              value={mode}
              onChange={setMode}
              options={[
                { value: "random", label: "The professor asks", hint: "Random questions on the materials", icon: <Shuffle className="size-3.5" /> },
                { value: "custom", label: "My own question", hint: "Choose the topic yourself", icon: <PenLine className="size-3.5" /> },
              ]}
            />
            <div className="mt-4">
              {mode === "random" ? (
                <>
                  <Label hint="different every time">Number of questions</Label>
                  <Segmented
                    name="Number of questions"
                    value={String(count)}
                    onChange={(v) => setCount(Number(v))}
                    options={Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
                  />
                </>
              ) : (
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder="E.g. Describe the cardiac cycle and the pressure-volume loop."
                  aria-label="Exam question"
                />
              )}
            </div>
            <div className="mt-4">
              <Label>Language you will speak</Label>
              <Segmented
                name="Language"
                value={language}
                onChange={setLanguage}
                options={[
                  { value: "en", label: "English" },
                  { value: "it", label: "Italiano" },
                ]}
              />
            </div>
          </Section>

          {exams.length > 0 && <PastExams exams={exams} />}
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-line bg-card p-5 shadow-raised sm:p-6">
            <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
              <GraduationCap className="size-5 text-ink-muted" strokeWidth={1.75} /> Examiner
            </h2>

            <div className="mt-5 space-y-4">
              <div>
                <Label>Evaluating AI</Label>
                <EnginePicker
                  status={aiStatus}
                  value={provider}
                  onChange={(p) => {
                    setProvider(p);
                    // Esame tutto sul dispositivo: anche la trascrizione passa al modello locale.
                    if (p === "local" && transcriber !== "browser") setTranscriber("local");
                  }}
                />
                {provider === "local" && (
                  <p className="mt-1.5 text-[11px] text-ink-muted">
                    Questions and grading run on this device: nothing is sent to an AI provider. Slower than a cloud AI and less precise on long materials.
                  </p>
                )}
              </div>

              <div>
                <Label>Transcription</Label>
                <TranscriberPicker status={aiStatus} value={transcriber} onChange={setTranscriber} speech={speech} gpuProblem={gpuProblem} />
              </div>

              <Button
                size="lg"
                className="w-full"
                disabled={!canStart}
                onClick={() => onStart({ materialIds: selected, mode, count, question: question.trim(), language, provider, transcriber })}
              >
                <Mic className="size-4" /> Enter the exam room <ArrowRight className="size-4" />
              </Button>
              <p className="text-xs text-ink-muted">
                {selected.length === 0
                  ? "Select at least one material."
                  : mode === "custom" && !question.trim()
                    ? "Write your question."
                    : `Up to ${MAX_RECORDING_SEC / 60} minutes per answer. Grade from 0 to 30: 18 is a pass.`}
              </p>
            </div>
          </div>
          <p className="px-1 text-xs text-ink-faint">
            {selected.length > 0 && `Materials: ${selected.map((id) => byId.get(id)?.title).filter(Boolean).join(", ")}`}
          </p>
        </div>
      </div>
    </div>
  );
}

function TranscriberPicker({
  status,
  value,
  onChange,
  speech,
  gpuProblem,
}: {
  status: AiStatus;
  value: Transcriber;
  onChange: (t: Transcriber) => void;
  speech: boolean;
  gpuProblem: string | null;
}) {
  const options: { value: Transcriber; ready: boolean; detail: string; icon: typeof Globe }[] = [
    {
      value: "local",
      ready: !gpuProblem,
      detail: gpuProblem ?? `${WHISPER_LABEL} · free, private · ~560 MB the first time`,
      icon: Cpu,
    },
    {
      value: "gemini",
      ready: cloudTranscriberReady(status, "gemini"),
      detail: cloudTranscriberReady(status, "gemini") ? `${status.cloud.gemini.model} · after recording` : "API key not configured",
      icon: Sparkles,
    },
    {
      value: "openai",
      ready: cloudTranscriberReady(status, "openai"),
      detail: cloudTranscriberReady(status, "openai") ? "gpt-4o-transcribe · after recording" : "API key not configured",
      icon: Sparkles,
    },
    {
      value: "browser",
      ready: speech,
      detail: speech ? "Live, free · less accurate on technical terms" : "Not supported by this browser (use Chrome, Edge or Safari)",
      icon: Globe,
    },
  ];
  return (
    <div role="radiogroup" aria-label="Transcription engine" className="space-y-1.5">
      {options.map((o) => {
        const active = value === o.value;
        const Row = o.ready ? "button" : "div";
        return (
          <Row
            key={o.value}
            {...(o.ready ? { type: "button" as const, onClick: () => onChange(o.value) } : { "aria-disabled": true })}
            role="radio"
            aria-checked={active}
            className={cn(
              "flex w-full items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition",
              active ? "border-primary" : "border-line",
              o.ready ? "cursor-pointer hover:border-line-strong" : "opacity-60",
            )}
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-ink-muted">
              <o.icon className="size-4" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-ink">{TRANSCRIBER_LABELS[o.value]}</span>
              <span className="block truncate text-[11px] text-ink-muted">{o.detail}</span>
            </span>
            {o.ready ? (
              <Check className={cn("size-4 shrink-0", active ? "text-heading" : "text-transparent")} />
            ) : (
              o.value !== "browser" && (
                <Link href="/settings" className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent hover:underline">
                  <KeyRound className="size-3" /> Add key
                </Link>
              )
            )}
          </Row>
        );
      })}
    </div>
  );
}

function PastExams({ exams }: { exams: OralExamSummary[] }) {
  return (
    <section className="rounded-lg border border-line bg-card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
        <History className="size-5 text-ink-muted" strokeWidth={1.75} /> Past exams
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {exams.map((e) => (
          <li key={e.id}>
            <Link href={`/exam/${e.id}`} className="flex items-center gap-3 py-3 transition hover:opacity-80">
              <GradeBadge grade={e.grade} honors={e.honors} className="min-w-16 justify-center" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{e.title}</span>
                <span className="block text-[11px] text-ink-muted">
                  <RelativeTime ms={e.createdAt} /> · {formatDuration(e.durationSec)} min
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- aula d'esame ----------

function speak(text: string, language: "it" | "en") {
  if (typeof speechSynthesis === "undefined") return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = language === "it" ? "it-IT" : "en-US";
  u.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function stopSpeaking() {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function ExamRoom({ setup, materials, aiStatus, onExit }: { setup: Setup; materials: Material[]; aiStatus: AiStatus; onExit: () => void }) {
  const router = useRouter();
  const showError = useApiErrorToast();
  const recorder = useRecorder({ live: setup.transcriber === "browser", language: setup.language });
  const chosen = useMemo(() => materials.filter((m) => setup.materialIds.includes(m.id)), [materials, setup.materialIds]);
  const [questions, setQuestions] = useState<string[] | null>(setup.mode === "custom" ? [setup.question] : null);
  const [prepError, setPrepError] = useState<string | null>(null);
  /** Fine dell'animazione di lettura dei materiali */
  const [scanned, setScanned] = useState(setup.mode === "custom");
  const [attempt, setAttempt] = useState(0);
  const requested = useRef(-1);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [processing, setProcessing] = useState<Processing | null>(null);
  const [voice, setVoice] = useState(true);
  const [repeat, setRepeat] = useState(0);
  const current = questions?.[answers.length] ?? null;
  const busy = recorder.status === "recording" || recorder.status === "paused" || answers.length > 0 || (processing !== null && processing.error === null);

  const local = setup.provider === "local";
  const abort = useRef<AbortController | null>(null);
  const [localPhase, setLocalPhase] = useState<string | null>(null);
  const subject = chosen[0]?.subject ?? "";

  // Modello locale: card collegate e testo dei materiali, caricati una volta e riusati per domande e valutazione.
  const localData = useRef<Promise<{ context: ExamContext; texts: MaterialText[] }> | null>(null);
  const loadLocalData = useCallback(() => {
    if (!localData.current) {
      localData.current = (async () => {
        const context = await api<ExamContext>(`/api/exams/context?materials=${setup.materialIds.join(",")}`);
        const texts = await loadMaterialTexts(chosen, (i) => setLocalPhase(`Reading “${chosen[i].title}”…`));
        return { context, texts };
      })();
      localData.current.catch(() => (localData.current = null));
    }
    return localData.current;
  }, [chosen, setup.materialIds]);

  // Lasciando la pagina si ferma il modello locale. Non nel finto smontaggio di StrictMode (sviluppo), che
  // rimonta subito il componente: per questo l'annullamento aspetta un istante e controlla di essere ancora smontati.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const controller = abort.current;
      setTimeout(() => {
        if (!mounted.current) controller?.abort();
      }, 0);
    };
  }, []);

  // Il prof sceglie le domande (una richiesta per tentativo, anche con il doppio effetto di StrictMode).
  useEffect(() => {
    if (setup.mode !== "random" || requested.current === attempt) return;
    requested.current = attempt;
    if (!local) {
      api<{ questions: string[] }>("/api/exams/questions", {
        method: "POST",
        json: { materialIds: setup.materialIds, count: setup.count, language: setup.language, provider: setup.provider },
      })
        .then((r) => setQuestions(r.questions))
        .catch((err) => setPrepError(errorMessage(err)));
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    (async () => {
      const { context, texts } = await loadLocalData();
      setLocalPhase("The professor is reading and writing the questions…");
      let written = 0;
      return generateQuestionsLocally(
        { subject, language: setup.language, count: setup.count, materials: texts, cards: context.cards, avoid: context.avoid },
        {
          signal: controller.signal,
          onText: (chunk) => {
            written += chunk.length;
            setLocalPhase(`Writing the questions… (${written.toLocaleString("en-US")} characters)`);
          },
        },
      );
    })()
      .then((q) => setQuestions(q))
      .catch((err) => {
        // Annullato solo se si è lasciata la pagina: in ogni altro caso l'errore va mostrato.
        if (!(err instanceof AbortedError) || mounted.current) setPrepError(errorMessage(err));
      })
      .finally(() => setLocalPhase(null));
  }, [attempt, setup, local, loadLocalData, subject]);

  // Il prof legge la domanda ad alta voce.
  useEffect(() => {
    if (!voice || !current || processing) return;
    speak(current, setup.language);
    return stopSpeaking;
  }, [current, voice, repeat, processing, setup.language]);

  // Uscire dalla pagina durante l'esame o la valutazione farebbe perdere tutto.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  useEffect(() => {
    if (recorder.error) toast.error(recorder.error);
  }, [recorder.error]);

  async function transcribe(recording: Recording, transcriber: Exclude<Transcriber, "browser">, question: string): Promise<string> {
    if (transcriber === "local") return transcribeLocally(recording.blob, setup.language);
    const type = recording.blob.type.split(";")[0];
    const form = new FormData();
    form.append("audio", recording.blob, `answer.${EXTENSIONS[type] ?? "webm"}`);
    form.append("provider", transcriber);
    form.append("language", setup.language);
    form.append("hint", [question, ...chosen.map((m) => m.title)].join(". ").slice(0, 1000));
    return (await api<{ transcript: string }>("/api/exams/transcribe", { method: "POST", body: form })).transcript;
  }

  async function evaluate(items: Answer[], transcriber: Transcriber) {
    let list = items;
    setProcessing({ answers: list, transcriber, step: "transcribing", error: null, written: 0 });
    try {
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (a.transcript !== null) continue;
        const text = !a.recording ? "" : transcriber === "browser" ? a.recording.transcript : await transcribe(a.recording, transcriber, a.question);
        list = list.map((x, j) => (j === i ? { ...x, transcript: text } : x));
        const snapshot = list;
        setProcessing((p) => p && { ...p, answers: snapshot });
      }
      const words = wordCount(list.map((a) => a.transcript ?? "").join(" "));
      if (words < MIN_TRANSCRIPT_WORDS) {
        throw new Error(
          words > 0
            ? `Only ${words} words were understood in your answers: that is too little to be evaluated.`
            : "No speech was recognised in the recordings. Check the microphone and try again.",
        );
      }
      setProcessing((p) => p && { ...p, step: "evaluating" });
      const examAnswers = list.map((a) => ({ question: a.question, transcript: a.transcript ?? "", durationSec: a.recording?.durationSec ?? 0 }));
      // Con il modello locale la valutazione si scrive qui; il server la ricontrolla e programma le card.
      let evaluation: LocalEvaluation | undefined;
      if (local) {
        const controller = new AbortController();
        abort.current = controller;
        const { context, texts } = await loadLocalData();
        evaluation = await evaluateExamLocally(
          { subject, language: setup.language, answers: examAnswers, materials: texts, cards: context.cards },
          { signal: controller.signal, onText: (chunk) => setProcessing((p) => p && { ...p, written: p.written + chunk.length }) },
        );
      }
      const { exam } = await api<{ exam: OralExam }>("/api/exams", {
        method: "POST",
        json: {
          materialIds: setup.materialIds,
          mode: setup.mode,
          language: setup.language,
          provider: setup.provider,
          transcriber,
          answers: examAnswers,
          evaluation,
        },
      });
      toast.success("Exam evaluated.");
      router.push(`/exam/${exam.id}`);
      router.refresh();
    } catch (err) {
      if (err instanceof AbortedError) return;
      showError(err);
      const snapshot = list;
      setProcessing((p) => p && { ...p, answers: snapshot, error: errorMessage(err) });
    }
  }

  /** Chiude la risposta alla domanda corrente (o la salta) e passa alla successiva o alla valutazione. */
  async function next(skip = false) {
    if (!current || !questions) return;
    stopSpeaking();
    const recording = skip ? null : await recorder.stop();
    recorder.discard();
    const done = [...answers, { question: current, recording, transcript: null }];
    setAnswers(done);
    if (done.length === questions.length) void evaluate(done, setup.transcriber);
  }

  // Arresto automatico alla durata massima di una risposta.
  useEffect(() => {
    if (recorder.limitReached && recorder.status === "recording") {
      toast.info("Maximum length for this answer reached.");
      void next();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- next cambia a ogni render; conta solo il raggiungimento del limite
  }, [recorder.limitReached, recorder.status]);

  function restart() {
    setProcessing(null);
    setAnswers([]);
    recorder.discard();
  }

  if (processing) {
    return (
      <ProcessingView
        processing={processing}
        aiStatus={aiStatus}
        provider={setup.provider}
        onRetry={(transcriber, retranscribe) =>
          evaluate(retranscribe ? processing.answers.map((a) => (a.recording ? { ...a, transcript: null } : a)) : processing.answers, transcriber)
        }
        onRestart={restart}
        onExit={onExit}
      />
    );
  }

  const leave = () => {
    abort.current?.abort();
    stopSpeaking();
    recorder.discard();
    onExit();
  };

  if (!questions || !current || !scanned) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg border border-line bg-card p-8 text-center shadow-raised">
          {prepError ? (
            <>
              <X className="mx-auto size-8 text-danger" />
              <h1 className="mt-3 font-serif text-[24px] font-semibold text-heading">The professor could not prepare the questions</h1>
              <p className="mt-2 text-sm text-ink-muted">{prepError}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button
                  onClick={() => {
                    setPrepError(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  <RotateCcw className="size-4" /> Try again
                </Button>
                <Button variant="secondary" onClick={leave}>
                  Back to setup
                </Button>
              </div>
            </>
          ) : (
            <>
              <h1 className="font-serif text-[24px] font-semibold text-heading">The professor is preparing your questions…</h1>
              <p className="mt-1 text-sm text-ink-muted">
                {setup.count} random question{setup.count === 1 ? "" : "s"} on {chosen.map((m) => m.title).join(", ")}.
              </p>
              <div className="mt-5">
                <MaterialScanner key={attempt} materials={chosen} done={questions !== null} onComplete={() => setScanned(true)} />
              </div>
              {local && <LocalStatus phase={localPhase} />}
              <WaitingTime key={`t${attempt}`} />
            </>
          )}
        </div>
      </div>
    );
  }

  const index = answers.length;
  const last = index === questions.length - 1;
  const recording = recorder.status === "recording";
  const paused = recorder.status === "paused";
  const started = recording || paused;
  const elapsed = started ? recorder.elapsed : 0;
  const remaining = MAX_RECORDING_SEC - elapsed;

  return (
    <div className="mx-auto max-w-3xl">
      <button type="button" onClick={leave} className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {busy ? "Abandon the exam" : "Back to setup"}
      </button>

      <div className="rounded-lg border border-line bg-card p-6 shadow-raised sm:p-10">
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow flex items-center gap-2 text-accent">
            <span className="size-1.5 rounded-full bg-accent" />
            {questions.length > 1 ? `Question ${index + 1} of ${questions.length}` : "Exam question"}
          </p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => (voice ? setRepeat((n) => n + 1) : speak(current, setup.language))} title="Hear the question again">
              <RotateCcw className="size-3.5" /> Repeat
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                if (voice) stopSpeaking();
                setVoice(!voice);
              }}
              aria-label={voice ? "Mute the professor" : "Let the professor read the questions"}
              title={voice ? "Mute the professor" : "Let the professor read the questions"}
            >
              {voice ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </Button>
          </div>
        </div>
        {questions.length > 1 && (
          <div className="mt-3 flex gap-1.5" aria-hidden>
            {questions.map((_, i) => (
              <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < index ? "bg-primary" : i === index ? "bg-accent" : "bg-muted")} />
            ))}
          </div>
        )}
        <h1 className="mt-4 font-serif text-[24px] leading-8 font-semibold text-heading sm:text-[30px] sm:leading-10">{current}</h1>
        <p className="mt-2 text-sm text-ink-muted">{chosen.map((m) => m.title).join(" · ")}</p>

        <div className="mt-10 flex flex-col items-center">
          <div className="relative grid place-items-center">
            {recording && (
              <span
                aria-hidden
                className="absolute inset-0 rounded-full bg-danger/25 transition-transform duration-100"
                style={{ transform: `scale(${1 + recorder.level * 0.6})` }}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (recording) return recorder.pause();
                if (paused) return recorder.resume();
                stopSpeaking();
                void recorder.start();
              }}
              className={cn(
                "relative grid size-28 cursor-pointer place-items-center rounded-full shadow-raised transition active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary",
                recording ? "bg-danger text-bg" : "bg-primary text-on-primary hover:bg-primary-hover",
              )}
              aria-label={recording ? "Pause" : paused ? "Resume" : "Start answering"}
            >
              {recording ? <Pause className="size-10" /> : paused ? <Play className="size-10" /> : <Mic className="size-10" />}
            </button>
          </div>

          <p className="mt-6 font-serif text-[40px] leading-none font-semibold text-heading tabular-nums">{formatDuration(elapsed)}</p>
          <p className={cn("mt-2 text-sm", started && remaining <= 60 ? "font-semibold text-danger" : "text-ink-muted")}>
            {recording
              ? remaining <= 60
                ? `${remaining} seconds left for this answer`
                : "Recording… answer as in front of the professor"
              : paused
                ? "Paused: tap to resume"
                : "Tap the microphone and answer"}
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {started && (
              <Button size="lg" onClick={() => next()}>
                {last ? (
                  <>
                    <Square className="size-4" /> Finish and evaluate
                  </>
                ) : (
                  <>
                    Next question <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            )}
            <Button size="lg" variant="ghost" onClick={() => next(true)}>
              <SkipForward className="size-4" /> {started ? "Discard and skip" : "I don't know, skip"}
            </Button>
          </div>
        </div>

        {setup.transcriber === "browser" && started && (
          <div className="mt-8 rounded-md border border-line bg-sunken p-4">
            <p className="eyebrow mb-2 flex items-center gap-1.5 text-ink-muted">
              <AudioLines className="size-3.5" /> Live transcript
            </p>
            <p className="max-h-48 overflow-y-auto text-sm leading-relaxed text-ink">
              {recorder.finalText}
              {recorder.interim && <span className="text-ink-faint"> {recorder.interim}</span>}
              {!recorder.finalText && !recorder.interim && <span className="text-ink-faint">Listening…</span>}
            </p>
          </div>
        )}
      </div>

      {!started && index === 0 && (
        <ul className="mt-5 grid gap-2 text-sm text-ink-muted sm:grid-cols-3">
          {[
            "Start with a definition, then mechanisms, classification and clinical aspects.",
            "Use the correct terminology: the professor checks it too.",
            "Errors weigh more than omissions: if unsure, say so. A skipped question counts against the grade.",
          ].map((tip) => (
            <li key={tip} className="flex gap-2 rounded-md border border-line bg-sunken p-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" /> {tip}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProcessingView({
  processing,
  aiStatus,
  provider,
  onRetry,
  onRestart,
  onExit,
}: {
  processing: Processing;
  aiStatus: AiStatus;
  provider: AiProvider;
  onRetry: (transcriber: Transcriber, retranscribe: boolean) => void;
  onRestart: () => void;
  onExit: () => void;
}) {
  const { step, error, answers, transcriber } = processing;
  const recorded = answers.filter((a) => a.recording).length;
  const transcribed = answers.filter((a) => a.recording && a.transcript !== null).length;
  const duration = answers.reduce((sum, a) => sum + (a.recording?.durationSec ?? 0), 0);

  // Trascrizione fallita o troppo corta: si può riprovare con un altro motore (l'audio è ancora qui).
  const failedTranscription = error !== null && step === "transcribing";
  const alternatives = (["local", "gemini", "openai"] as const).filter(
    (t) => t !== transcriber && (t === "local" ? webGpuProblem() === null : cloudTranscriberReady(aiStatus, t)),
  );

  const steps = [
    {
      key: "transcribing",
      label:
        transcriber === "browser"
          ? "Collecting the live transcripts"
          : `Transcribing your answers with ${TRANSCRIBER_LABELS[transcriber]}${recorded > 1 ? ` (${transcribed}/${recorded})` : ""}`,
    },
    {
      key: "evaluating",
      label:
        provider === "local"
          ? `The local AI is grading your answers${processing.written ? ` (${processing.written.toLocaleString("en-US")} characters written)` : ""}`
          : `${PROVIDER_INFO[provider].label} is grading your answers and scheduling flashcards`,
    },
  ] as const;
  const current = steps.findIndex((s) => s.key === step);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-lg border border-line bg-card p-6 shadow-raised sm:p-8">
        <p className="eyebrow text-accent">Oral exam</p>
        <h1 className="mt-1 font-serif text-[26px] leading-9 font-semibold text-heading">{error ? "Something went wrong" : "Evaluating your exam…"}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {answers.length} question{answers.length === 1 ? "" : "s"}, {formatDuration(duration)} min recorded. {!error && "Keep this tab open: it can take a minute or two."}
        </p>

        <ol className="mt-6 space-y-3">
          {steps.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li key={s.key} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full",
                    done ? "bg-primary text-on-primary" : active && error ? "bg-danger-soft text-on-danger-soft" : active ? "bg-primary-soft text-accent" : "bg-muted text-ink-faint",
                  )}
                >
                  {done ? <Check className="size-4" /> : active && error ? <X className="size-4" /> : active ? <Loader2 className="size-4 animate-spin" /> : i + 1}
                </span>
                <span className={cn(active ? "font-semibold text-ink" : done ? "text-ink-muted" : "text-ink-faint")}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {!error && step === "transcribing" && transcriber === "local" && <WhisperProgress />}
        {!error && step === "evaluating" && provider === "local" && (
          <div className="mt-4">
            <LocalStatus phase={null} />
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-md bg-danger-soft px-4 py-3 text-sm text-on-danger-soft">
            <p>{error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!failedTranscription && (
                <Button size="sm" onClick={() => onRetry(transcriber, false)}>
                  <RotateCcw className="size-3.5" /> Retry the evaluation
                </Button>
              )}
              {failedTranscription && transcriber !== "browser" && (
                <Button size="sm" onClick={() => onRetry(transcriber, true)}>
                  <RotateCcw className="size-3.5" /> Retry the transcription
                </Button>
              )}
              {failedTranscription &&
                recorded > 0 &&
                alternatives.map((t) => (
                  <Button key={t} size="sm" variant="secondary" onClick={() => onRetry(t, true)}>
                    <FileAudio className="size-3.5" /> Transcribe with {TRANSCRIBER_LABELS[t]}
                  </Button>
                ))}
              <Button size="sm" variant="secondary" onClick={onRestart}>
                <Mic className="size-3.5" /> Answer again
              </Button>
              <Button size="sm" variant="ghost" onClick={onExit}>
                Back to setup
              </Button>
            </div>
          </div>
        )}

        <ol className="mt-6 space-y-4">
          {answers.map((a, i) => (
            <li key={i} className="rounded-md border border-line bg-sunken p-4">
              <p className="text-sm font-semibold text-ink">
                {i + 1}. {a.question}
              </p>
              {a.recording ? (
                <div className="mt-2">
                  <RecordingPlayer blob={a.recording.blob} />
                </div>
              ) : (
                <p className="mt-1 text-xs text-ink-faint">Skipped</p>
              )}
              {a.transcript && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-semibold text-accent">Transcript ({wordCount(a.transcript)} words)</summary>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap text-ink-muted">{a.transcript}</p>
                </details>
              )}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Riascolto della registrazione (resta solo in questa scheda: l'audio non viene salvato). */
function RecordingPlayer({ blob }: { blob: Blob }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(blob);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return <audio ref={ref} controls className="w-full" />;
}

/** Secondi di attesa: con materiali lunghi l'AI impiega di più a leggerli. */
function WaitingTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <p className="mt-3 text-xs text-ink-faint tabular-nums">
      {seconds}s{seconds >= 20 && " · long materials take longer: the AI reads them in full"}
    </p>
  );
}

/** Stato del modello locale (download la prima volta, avvio sulla GPU) e fase in corso. */
function LocalStatus({ phase }: { phase: string | null }) {
  const status = useLocalModelStatus();
  const loadingModel = status.state === "downloading" || status.state === "initializing";
  if (!loadingModel && !phase) return null;
  return (
    <div className="mx-auto mt-4 max-w-md space-y-2 text-left">
      {loadingModel && <ModelProgress status={status} />}
      {phase && !loadingModel && <p className="text-center text-xs text-ink-muted">{phase}</p>}
    </div>
  );
}

const subscribeWhisperStore = (l: () => void) => subscribeWhisper(l);
const IDLE_WHISPER: WhisperStatus = { state: "idle" };

/** Download (solo la prima volta) e avvio di Whisper. */
function WhisperProgress() {
  const status = useSyncExternalStore(subscribeWhisperStore, getWhisperStatus, () => IDLE_WHISPER);
  if (status.state === "downloading" && status.total > 0) {
    const pct = Math.round((status.received / status.total) * 100);
    return (
      <div className="mt-4">
        <div className="flex justify-between text-xs text-ink-muted tabular-nums">
          <span>Downloading the transcription model (only the first time)</span>
          <span>
            {formatBytes(status.received)} / {formatBytes(status.total)}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  if (status.state === "downloading" || status.state === "initializing") {
    return <p className="mt-4 text-xs text-ink-muted">Starting the transcription model on the GPU…</p>;
  }
  return null;
}
