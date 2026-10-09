import "server-only";
import { z } from "zod";
import { evaluateExam, fromLocalEvaluation, generateQuestions } from "./ai/exam";
import { transcribeAudio, type SourceFile } from "./ai/generate";
import { CLOUD_PROVIDERS, LOCAL_MODEL_LABEL, OPENAI_TRANSCRIBE_MODEL, type CloudProvider, type TranscribeProvider } from "./ai/providers";
import { requireCredentials } from "./ai/settings";
import type { User } from "./current-user";
import { MAX_QUESTIONS, MAX_RECORDING_SEC, MIN_TRANSCRIPT_WORDS, type ExamContext, wordCount, type ExamTopic, type OralExam } from "./exam-types";
import { HttpError } from "./http";
import { expandCards } from "./items";
import { appendCards, getMaterialsByIds, getOralExam, insertDeck, insertOralExam, listCardsForDecks, listDecks, listOralExams, newId } from "./repo";
import { getObjectBytes } from "./s3";
import { rescheduleFromExam, type ExamTarget } from "./study";
import type { Card } from "./types";

// Modalità esame: trascrizione della registrazione, valutazione dell'AI, card da ripassare e salvataggio.

/** OpenAI accetta file fino a 25 MB; a 24 kbps 20 minuti di registrazione sono circa 4 MB. */
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/ogg": ".ogg",
  "audio/mp4": ".mp4",
  "audio/x-m4a": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

export async function transcribeRecording(
  user: Pick<User, "id">,
  provider: TranscribeProvider,
  audio: { bytes: Uint8Array; mimeType: string },
  language: "it" | "en",
  hint: string,
): Promise<string> {
  const mimeType = audio.mimeType.toLowerCase().split(";")[0].trim();
  const ext = AUDIO_EXTENSIONS[mimeType];
  if (!ext) throw new HttpError(415, `Unsupported audio format (${mimeType || "unknown"}).`);
  if (audio.bytes.byteLength === 0) throw new HttpError(400, "The recording is empty.");
  if (audio.bytes.byteLength > MAX_AUDIO_BYTES) throw new HttpError(413, "The recording is too large to be transcribed.");
  const cred = await requireCredentials(user, provider);
  const source: SourceFile = { title: "Oral exam", filename: `exam${ext}`, mimeType, bytes: audio.bytes };
  return transcribeAudio(provider === "openai" ? { ...cred, model: OPENAI_TRANSCRIBE_MODEL } : cred, { audio: source, language, hint });
}

const MaterialIds = z.array(z.uuid()).min(1, "Select at least one material").max(10, "At most 10 materials per exam");

/** Materiali dell'esame con il loro contenuto, scaricato dal bucket. */
async function loadSources(ids: string[], userId: string) {
  const materialIds = [...new Set(ids)];
  const materials = await getMaterialsByIds(materialIds, userId);
  if (materials.length !== materialIds.length) throw new HttpError(400, "Some of the selected materials no longer exist or are private.");
  const sources: SourceFile[] = [];
  for (const m of materials) {
    try {
      sources.push({ title: m.title, filename: m.filename, mimeType: m.mimeType, bytes: await getObjectBytes(m.s3Key) });
    } catch (err) {
      console.error("[s3] download failed", m.s3Key, err);
      throw new HttpError(502, `Could not download "${m.title}" from the bucket.`);
    }
  }
  return { materialIds, materials, sources };
}

function aiFailure(err: unknown, fallback: string): never {
  if (err instanceof HttpError) throw err;
  console.error("[exam]", err);
  throw new HttpError(502, err instanceof Error ? err.message : fallback);
}

/** Mazzi dello studente generati da questi materiali, con le loro card (quelle da ripassare). */
async function relatedCards(userId: string, materialIds: string[]) {
  const selected = new Set(materialIds);
  const decks = (await listDecks(userId, "mine")).filter(
    (d) => d.status !== "generating" && (d.sources.some((s) => selected.has(s.id)) || (d.options.materialIds ?? []).some((id) => selected.has(id))),
  );
  return { decks, cards: await listCardsForDecks(decks.map((d) => d.id)) };
}

/** Con almeno tante card le domande nascono da quelle: un testo breve, molto più veloce da leggere dei PDF. */
const MIN_CARDS_FOR_QUESTIONS = 20;

export const QuestionsBody = z.object({
  materialIds: MaterialIds,
  count: z.number().int().min(1).max(MAX_QUESTIONS),
  language: z.enum(["it", "en"]),
  provider: z.enum(CLOUD_PROVIDERS),
});

/** Le domande del prof: casuali sui materiali, evitando quelle già fatte negli esami precedenti sugli stessi file. */
/** Domande degli ultimi esami casuali sugli stessi materiali, da non ripetere. */
async function pastQuestions(userId: string, materialIds: string[]): Promise<string[]> {
  const selected = new Set(materialIds);
  const past = await Promise.all((await listOralExams(userId)).slice(0, 10).map((e) => getOralExam(userId, e.id)));
  return past
    .filter((e) => e?.mode === "random" && e.materials.some((m) => selected.has(m.id)))
    .flatMap((e) => e!.answers.map((a) => a.question))
    .slice(0, 30);
}

/** Per l'esame con il modello locale, che lavora nel browser: card dei mazzi collegati e domande da evitare. */
export async function examContext(userId: string, ids: string[]): Promise<ExamContext> {
  const materialIds = [...new Set(MaterialIds.parse(ids))];
  const [{ cards }, avoid] = await Promise.all([relatedCards(userId, materialIds), pastQuestions(userId, materialIds)]);
  return { cards, avoid };
}

export async function prepareQuestions(user: Pick<User, "id">, body: z.infer<typeof QuestionsBody>): Promise<string[]> {
  const cred = await requireCredentials(user, body.provider);
  const started = Date.now();
  const materialIds = [...new Set(body.materialIds)];
  const { cards } = await relatedCards(user.id, materialIds);
  const fromCards = cards.length >= MIN_CARDS_FOR_QUESTIONS;
  const { materials, sources } = fromCards
    ? { materials: await getMaterialsByIds(materialIds, user.id), sources: [] }
    : await loadSources(materialIds, user.id);
  if (materials.length !== materialIds.length) throw new HttpError(400, "Some of the selected materials no longer exist or are private.");
  const loaded = Date.now();
  const avoid = await pastQuestions(user.id, materialIds);
  try {
    const questions = await generateQuestions(
      { subject: materials[0].subject, titles: materials.map((m) => m.title), language: body.language, count: body.count, sources, cards: fromCards ? cards : [], avoid },
      cred,
    );
    console.info(`[exam] questions with ${cred.model} from ${fromCards ? `${cards.length} cards` : "materials"}: setup ${loaded - started} ms, AI ${Date.now() - loaded} ms`);
    return questions;
  } catch (err) {
    aiFailure(err, "The exam questions could not be prepared.");
  }
}

const Coverage = z.enum(["good", "partial", "poor", "missing"]);
const Text = (max: number) => z.string().max(max);

const LocalEvaluationBody = z.object({
  grade: z.number(),
  honors: z.boolean(),
  summary: Text(4000),
  criteria: z.object({ accuracy: z.number(), completeness: z.number(), clarity: z.number(), terminology: z.number() }),
  strengths: z.array(Text(1000)).max(20),
  improvements: z.array(Text(1000)).max(20),
  errors: z.array(z.object({ said: Text(1000), correction: Text(1000) })).max(30),
  answers: z.array(z.object({ coverage: Coverage, feedback: Text(2000) })).max(MAX_QUESTIONS),
  topics: z
    .array(
      z.object({
        topic: Text(300),
        coverage: Coverage,
        comment: Text(1500),
        cardIds: z.array(z.string().max(64)).max(50),
        newCards: z.array(z.object({ front: Text(1000), back: Text(1000) })).max(10),
      }),
    )
    .max(20),
});

export const ExamBody = z.object({
  materialIds: MaterialIds,
  mode: z.enum(["random", "custom"]),
  language: z.enum(["it", "en"]),
  provider: z.enum(["local", ...CLOUD_PROVIDERS]),
  transcriber: z.enum(["local", "browser", "gemini", "openai"]),
  /** Solo per il modello locale: valutazione già scritta nel browser */
  evaluation: LocalEvaluationBody.optional(),
  answers: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(1000),
        transcript: z.string().trim().max(100_000),
        durationSec: z.number().int().min(0).max(MAX_RECORDING_SEC + 60),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
});

const preview = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Valuta l'esame, mette in ripasso le card degli argomenti deboli (creando quelle mancanti) e lo salva. */
export async function runExam(user: Pick<User, "id" | "name">, body: z.infer<typeof ExamBody>): Promise<OralExam> {
  if (wordCount(body.answers.map((a) => a.transcript).join(" ")) < MIN_TRANSCRIPT_WORDS) {
    throw new HttpError(400, "The answers are too short to be evaluated: speak for at least a minute in total and try again.");
  }
  const local = body.provider === "local";
  if (local && !body.evaluation) throw new HttpError(400, "The local AI grades the exam in your browser: no evaluation was received.");
  const cred = local ? null : await requireCredentials(user, body.provider as CloudProvider);
  const model = cred ? cred.model : LOCAL_MODEL_LABEL;
  // Il modello locale ha già letto i materiali nel browser: servono solo i metadati.
  const { materialIds, materials, sources } = local
    ? { materialIds: [...new Set(body.materialIds)], materials: await getMaterialsByIds([...new Set(body.materialIds)], user.id), sources: [] }
    : await loadSources(body.materialIds, user.id);
  if (materials.length !== materialIds.length) throw new HttpError(400, "Some of the selected materials no longer exist or are private.");

  const { decks, cards } = await relatedCards(user.id, materialIds);
  const subject = materials[0].subject;

  let evaluation;
  try {
    evaluation = cred
      ? await evaluateExam({ subject, language: body.language, answers: body.answers, sources, cards }, cred)
      : fromLocalEvaluation(body.evaluation!, body.answers, cards);
  } catch (err) {
    aiFailure(err, "The exam could not be evaluated.");
  }

  const title = preview(body.mode === "custom" ? body.answers[0].question : materials.map((m) => m.title).join(" · "), 120);
  const now = Date.now();

  // Card nuove per le lacune: un mazzo di ripasso dedicato, con le stesse fonti dell'esame.
  const newInputs = evaluation.topics.flatMap((t) => t.newCards);
  let reviewDeckId: string | null = null;
  let created: Card[] = [];
  if (newInputs.length > 0) {
    reviewDeckId = newId();
    await insertDeck({
      id: reviewDeckId,
      title: preview(`Exam review – ${title}`, 120),
      subject,
      description: `Flashcards on the gaps found in the oral exam of ${new Date(now).toISOString().slice(0, 10)}.`,
      status: "ready",
      error: null,
      options: {
        cardCount: newInputs.length,
        cardType: "mixed",
        difficulty: "intermedio",
        language: body.language,
        focus: body.mode === "custom" ? body.answers[0].question : "",
        materialIds,
        provider: body.provider,
      },
      sources: materials.map((m) => ({ id: m.id, title: m.title })),
      model,
      createdBy: user.name,
      createdById: user.id,
      isPublic: false,
      createdAt: now,
      updatedAt: now,
    });
    created = await appendCards(reviewDeckId, newInputs);
  }

  // Le card create seguono l'ordine degli argomenti: si riassegnano per posizione.
  const topics: ExamTopic[] = [];
  let offset = 0;
  for (const t of evaluation.topics) {
    topics.push({ topic: t.topic, coverage: t.coverage, comment: t.comment, cardIds: t.cardIds, newCardIds: created.slice(offset, offset + t.newCards.length).map((c) => c.id) });
    offset += t.newCards.length;
  }

  const cardsById = new Map([...cards, ...created].map((c) => [c.id, c]));
  const targets: ExamTarget[] = [];
  for (const t of topics) {
    if (t.coverage === "good") continue;
    const level = t.coverage === "poor" ? "poor" : "partial";
    for (const id of t.cardIds) {
      const card = cardsById.get(id);
      if (card) targets.push(...expandCards([card]).map((it) => ({ key: it.key, cardId: card.id, deckId: card.deckId, level }) as const));
    }
    // Le card nuove riguardano proprio ciò che non si sapeva: subito in ripasso.
    for (const id of t.newCardIds) {
      const card = cardsById.get(id)!;
      targets.push(...expandCards([card]).map((it) => ({ key: it.key, cardId: card.id, deckId: card.deckId, level: "poor" }) as const));
    }
  }
  const rescheduled = await rescheduleFromExam(user.id, targets);

  const touched = new Set(targets.map((t) => t.deckId));
  const exam: OralExam = {
    id: newId(),
    title,
    mode: body.mode,
    language: body.language,
    materials: materials.map((m) => ({ id: m.id, title: m.title })),
    answers: body.answers,
    durationSec: body.answers.reduce((sum, a) => sum + a.durationSec, 0),
    transcriber: body.transcriber,
    model,
    result: {
      grade: evaluation.grade,
      honors: evaluation.honors,
      summary: evaluation.summary,
      criteria: evaluation.criteria,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
      errors: evaluation.errors,
      answers: evaluation.answers,
      topics,
    },
    scheduling: {
      rescheduled,
      newCards: created.length,
      deckId: reviewDeckId,
      decks: [
        ...decks.filter((d) => touched.has(d.id)).map((d) => ({ id: d.id, title: d.title })),
        ...(reviewDeckId ? [{ id: reviewDeckId, title: preview(`Exam review – ${title}`, 120) }] : []),
      ],
    },
    createdAt: now,
  };
  await insertOralExam(user.id, exam);
  return exam;
}
