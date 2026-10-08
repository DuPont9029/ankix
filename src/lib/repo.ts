import "server-only";
import { randomUUID } from "node:crypto";
import { exec, query, refresh, transaction, type Row } from "./db";
import type { ConceptMapData } from "./conceptmap";
import type { OralExam, OralExamSummary } from "./exam-types";
import type { MindMap, MindMapData } from "./mindmap";
import type { Card, CardType, Choice, Deck, DeckSource, DeckStatus, GenerationOptions, Material, Occlusion } from "./types";

const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? "" : String(v));

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const newId = () => randomUUID();

/** Cerca una riga; se non c'è rilegge subito il bucket (potrebbe averla appena creata un'altra istanza). */
async function findOne(sql: string, params: (string | number)[]): Promise<Row | undefined> {
  const [row] = await query(sql, params);
  if (row) return row;
  await refresh();
  const [again] = await query(sql, params);
  return again;
}

// ---------- Materiali ----------

function toMaterial(r: Row): Material {
  return {
    id: str(r.id),
    title: str(r.title),
    subject: str(r.subject),
    filename: str(r.filename),
    mimeType: str(r.mime_type),
    sizeBytes: num(r.size_bytes),
    uploadedBy: str(r.uploaded_by),
    uploadedById: r.uploaded_by_id == null ? null : str(r.uploaded_by_id),
    createdAt: num(r.created_at),
  };
}

export async function listMaterials(): Promise<Material[]> {
  const rows = await query(`SELECT * FROM materials ORDER BY created_at DESC`);
  return rows.map(toMaterial);
}

export async function getMaterial(id: string): Promise<(Material & { s3Key: string }) | null> {
  const row = await findOne(`SELECT * FROM materials WHERE id = $1`, [id]);
  return row ? { ...toMaterial(row), s3Key: str(row.s3_key) } : null;
}

export async function getMaterialsByIds(ids: string[]): Promise<(Material & { s3Key: string })[]> {
  const out: (Material & { s3Key: string })[] = [];
  for (const id of ids) {
    const m = await getMaterial(id);
    if (m) out.push(m);
  }
  return out;
}

export async function insertMaterial(m: Material & { s3Key: string }): Promise<void> {
  await exec(
    `INSERT INTO materials (id, title, subject, filename, mime_type, size_bytes, s3_key, uploaded_by, uploaded_by_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [m.id, m.title, m.subject, m.filename, m.mimeType, m.sizeBytes, m.s3Key, m.uploadedBy, m.uploadedById, m.createdAt],
  );
}

export async function deleteMaterial(id: string): Promise<void> {
  await exec(`DELETE FROM materials WHERE id = $1`, [id]);
}

// ---------- Mazzi ----------

// Una generazione non può durare più della durata massima di una funzione (maxDuration = 300 s):
// oltre questo limite l'istanza che la eseguiva è stata interrotta.
const STALE_GENERATION_MS = 15 * 60 * 1000;

function toDeck(r: Row): Deck {
  const stale = str(r.status) === "generating" && Date.now() - num(r.updated_at) > STALE_GENERATION_MS;
  return {
    id: str(r.id),
    title: str(r.title),
    subject: str(r.subject),
    description: str(r.description),
    status: (stale ? "error" : str(r.status)) as DeckStatus,
    error: stale ? "Generation interrupted. Please try again." : r.error == null ? null : str(r.error),
    options: parseJson<GenerationOptions>(r.options, {
      cardCount: 20,
      cardType: "mixed",
      difficulty: "intermedio",
      language: "en",
      focus: "",
      materialIds: [],
    }),
    sources: parseJson<DeckSource[]>(r.sources, []),
    model: str(r.model),
    createdBy: str(r.created_by),
    createdById: r.created_by_id == null ? null : str(r.created_by_id),
    isPublic: r.is_public === true,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    cardCount: num(r.card_count),
  };
}

const DECK_SELECT = `
  SELECT d.*, (SELECT count(*) FROM cards c WHERE c.deck_id = d.id) AS card_count
  FROM decks d`;

/** "mine" = mazzi dell'utente (privati e pubblici); "public" = mazzi pubblici degli altri. */
export async function listDecks(userId: string, scope: "mine" | "public"): Promise<Deck[]> {
  const rows =
    scope === "mine"
      ? await query(`${DECK_SELECT} WHERE d.created_by_id = $1 ORDER BY d.created_at DESC`, [userId])
      : await query(
          `${DECK_SELECT} WHERE d.is_public = true AND (d.created_by_id IS NULL OR d.created_by_id <> $1)
           ORDER BY d.updated_at DESC`,
          [userId],
        );
  return rows.map(toDeck);
}

export function canViewDeck(deck: Deck, userId: string): boolean {
  return deck.createdById === userId || deck.isPublic;
}

export function isDeckOwner(deck: Deck, userId: string): boolean {
  return deck.createdById === userId;
}

export async function getDeck(id: string): Promise<Deck | null> {
  const row = await findOne(`${DECK_SELECT} WHERE d.id = $1`, [id]);
  return row ? toDeck(row) : null;
}

export async function insertDeck(d: Omit<Deck, "cardCount">): Promise<void> {
  await exec(
    `INSERT INTO decks (id, title, subject, description, status, error, options, sources, model, created_by, created_by_id, is_public, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      d.id, d.title, d.subject, d.description, d.status, d.error,
      JSON.stringify(d.options), JSON.stringify(d.sources), d.model,
      d.createdBy, d.createdById, d.isPublic, d.createdAt, d.updatedAt,
    ],
  );
}

export async function updateDeckMeta(
  id: string,
  patch: { title?: string; subject?: string; description?: string; isPublic?: boolean },
): Promise<void> {
  const current = await getDeck(id);
  if (!current) return;
  await exec(
    `UPDATE decks SET title = $1, subject = $2, description = $3, is_public = $4, updated_at = $5 WHERE id = $6`,
    [
      patch.title ?? current.title,
      patch.subject ?? current.subject,
      patch.description ?? current.description,
      patch.isPublic ?? current.isPublic,
      Date.now(),
      id,
    ],
  );
}

export async function setDeckStatus(
  id: string,
  status: DeckStatus,
  extra: { error?: string | null; model?: string } = {},
): Promise<void> {
  await exec(
    `UPDATE decks SET status = $1, error = $2, model = COALESCE($3, model), updated_at = $4 WHERE id = $5`,
    [status, extra.error ?? null, extra.model ?? null, Date.now(), id],
  );
}

export async function deleteDeck(id: string): Promise<void> {
  await deleteDecks([id]);
}

/**
 * Elimina i mazzi con le loro card e tutto ciò che vi fa riferimento: stato di studio, storico delle
 * ripetizioni (il calendario non conta più quelle sessioni) e mappe mentali.
 */
export async function deleteDecks(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const list = ids.map((_, i) => `$${i + 1}`).join(", ");
  await transaction(async (tx) => {
    for (const table of ["cards", "card_states", "review_log", "mind_maps"]) {
      await tx.exec(`DELETE FROM ${table} WHERE deck_id IN (${list})`, ids);
    }
    await tx.exec(`DELETE FROM decks WHERE id IN (${list})`, ids);
  });
}

/** Mazzi generati da un materiale (come sorgente o come immagine di image occlusion). */
export async function listDecksUsingMaterial(materialId: string): Promise<Deck[]> {
  const rows = await query(
    `${DECK_SELECT} WHERE d.options LIKE $1 OR d.sources LIKE $1
        OR d.id IN (SELECT deck_id FROM cards WHERE image_material_id = $2)`,
    [`%${materialId}%`, materialId],
  );
  // Gli id sono UUID: la ricerca nel JSON di opzioni e sorgenti non può dare falsi positivi.
  return rows.map(toDeck);
}

// ---------- Card ----------

// Scelta multipla: le opzioni stanno nella colonna JSON "occlusions" (array di {text, correct}), così lo schema
// dei Parquet non cambia; "back" contiene il testo della risposta corretta, quindi le versioni precedenti
// dell'app le mostrano come normali card domanda/risposta.
function toCard(r: Row): Card {
  const type = (["cloze", "image_occlusion", "mcq"].includes(str(r.type)) ? str(r.type) : "basic") as CardType;
  const json = parseJson<unknown[]>(r.occlusions, []);
  return {
    id: str(r.id),
    deckId: str(r.deck_id),
    position: num(r.position),
    type,
    front: str(r.front),
    back: str(r.back),
    extra: str(r.extra),
    tags: parseJson<string[]>(r.tags, []),
    imageMaterialId: r.image_material_id == null ? null : str(r.image_material_id),
    occlusions: type === "mcq" ? [] : (json as Occlusion[]),
    choices: type === "mcq" ? (json as Choice[]) : [],
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export type CardInput = {
  type: CardType;
  front: string;
  back: string;
  extra: string;
  tags: string[];
  imageMaterialId?: string | null;
  occlusions?: Occlusion[];
  choices?: Choice[];
};

/** Contenuto della colonna JSON "occlusions": maschere oppure, per la scelta multipla, le opzioni. */
function jsonColumn(input: CardInput): string {
  return JSON.stringify(input.type === "mcq" ? (input.choices ?? []) : (input.occlusions ?? []));
}

export async function listCards(deckId: string): Promise<Card[]> {
  const rows = await query(`SELECT * FROM cards WHERE deck_id = $1 ORDER BY position, created_at`, [deckId]);
  return rows.map(toCard);
}

/** Card di più mazzi in una sola query, ordinate per mazzo e posizione. */
export async function listCardsForDecks(deckIds: string[]): Promise<Card[]> {
  if (deckIds.length === 0) return [];
  const placeholders = deckIds.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query(`SELECT * FROM cards WHERE deck_id IN (${placeholders}) ORDER BY deck_id, position, created_at`, deckIds);
  return rows.map(toCard);
}

/** Mazzi con gli id indicati (quelli inesistenti vengono ignorati). */
export async function getDecksByIds(ids: string[]): Promise<Deck[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query(`${DECK_SELECT} WHERE d.id IN (${placeholders})`, ids);
  return rows.map(toDeck);
}

export async function getCard(deckId: string, cardId: string): Promise<Card | null> {
  const row = await findOne(`SELECT * FROM cards WHERE id = $1 AND deck_id = $2`, [cardId, deckId]);
  return row ? toCard(row) : null;
}

/** Aggiunge card in coda al mazzo. */
export async function appendCards(deckId: string, inputs: CardInput[]): Promise<Card[]> {
  return transaction(async (tx) => {
    const [{ max_pos }] = await tx.query<{ max_pos: unknown }>(
      `SELECT COALESCE(max(position), -1) AS max_pos FROM cards WHERE deck_id = $1`,
      [deckId],
    );
    let position = num(max_pos) + 1;
    const now = Date.now();
    const created: Card[] = [];
    for (const input of inputs) {
      const card: Card = {
        id: newId(),
        deckId,
        position: position++,
        ...input,
        imageMaterialId: input.imageMaterialId ?? null,
        occlusions: input.type === "mcq" ? [] : (input.occlusions ?? []),
        choices: input.type === "mcq" ? (input.choices ?? []) : [],
        createdAt: now,
        updatedAt: now,
      };
      await tx.exec(
        `INSERT INTO cards (id, deck_id, position, type, front, back, extra, tags, image_material_id, occlusions, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          card.id, deckId, card.position, card.type, card.front, card.back, card.extra, JSON.stringify(card.tags),
          card.imageMaterialId, jsonColumn(input), now, now,
        ],
      );
      created.push(card);
    }
    await tx.exec(`UPDATE decks SET updated_at = $1 WHERE id = $2`, [now, deckId]);
    return created;
  });
}

export async function updateCard(deckId: string, cardId: string, input: CardInput): Promise<void> {
  const now = Date.now();
  await transaction(async (tx) => {
    await tx.exec(
      `UPDATE cards SET type = $1, front = $2, back = $3, extra = $4, tags = $5, image_material_id = $6, occlusions = $7, updated_at = $8
       WHERE id = $9 AND deck_id = $10`,
      [
        input.type, input.front, input.back, input.extra, JSON.stringify(input.tags),
        input.imageMaterialId ?? null, jsonColumn(input), now, cardId, deckId,
      ],
    );
    await tx.exec(`UPDATE decks SET updated_at = $1 WHERE id = $2`, [now, deckId]);
  });
}

export async function deleteCard(deckId: string, cardId: string): Promise<void> {
  await transaction(async (tx) => {
    await tx.exec(`DELETE FROM cards WHERE id = $1 AND deck_id = $2`, [cardId, deckId]);
    await tx.exec(`DELETE FROM card_states WHERE card_id = $1 AND deck_id = $2`, [cardId, deckId]);
    await tx.exec(`DELETE FROM review_log WHERE card_id = $1 AND deck_id = $2`, [cardId, deckId]);
  });
}

/** Copia privata di un mazzo (con tutte le card) per un altro utente. */
export async function copyDeck(source: Deck, owner: { id: string; name: string }): Promise<string> {
  const cards = await listCards(source.id);
  const id = newId();
  const now = Date.now();
  await insertDeck({
    ...source,
    id,
    title: source.title,
    status: "ready",
    error: null,
    createdBy: owner.name,
    createdById: owner.id,
    isPublic: false,
    createdAt: now,
    updatedAt: now,
  });
  if (cards.length) {
    await appendCards(
      id,
      cards.map((c) => ({
        type: c.type,
        front: c.front,
        back: c.back,
        extra: c.extra,
        tags: c.tags,
        imageMaterialId: c.imageMaterialId,
        occlusions: c.occlusions,
        choices: c.choices,
      })),
    );
  }
  return id;
}

export async function stats(userId: string): Promise<{ materials: number; decks: number; cards: number }> {
  const [row] = await query(
    `SELECT (SELECT count(*) FROM materials) AS materials,
            (SELECT count(*) FROM decks WHERE created_by_id = $1) AS decks,
            (SELECT count(*) FROM cards c JOIN decks d ON d.id = c.deck_id WHERE d.created_by_id = $1) AS cards`,
    [userId],
  );
  return { materials: num(row?.materials), decks: num(row?.decks), cards: num(row?.cards) };
}

// ---------- Mappe mentali ----------

// Una mappa per studente e per mazzo: anche chi studia un mazzo pubblico di altri può crearne una sua.
function toMindMap(r: Row): MindMap {
  const data = parseJson<MindMapData & { concept?: ConceptMapData | null }>(r.data, { nodes: [], links: [] });
  return {
    id: str(r.id),
    deckId: str(r.deck_id),
    title: str(r.title),
    model: str(r.model),
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    links: Array.isArray(data.links) ? data.links : [],
    concept: data.concept && Array.isArray(data.concept.concepts) ? data.concept : null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

export async function getMindMap(userId: string, deckId: string): Promise<MindMap | null> {
  const [row] = await query(`SELECT * FROM mind_maps WHERE user_id = $1 AND deck_id = $2`, [userId, deckId]);
  return row ? toMindMap(row) : null;
}

export type MindMapInput = MindMapData & { title: string; model: string; concept: ConceptMapData | null };

export async function saveMindMap(userId: string, deckId: string, map: MindMapInput): Promise<MindMap> {
  const data = JSON.stringify({ nodes: map.nodes, links: map.links, concept: map.concept });
  const now = Date.now();
  return transaction(async (tx) => {
    const [row] = await tx.query(`SELECT id, created_at FROM mind_maps WHERE user_id = $1 AND deck_id = $2`, [userId, deckId]);
    if (row) {
      await tx.exec(`UPDATE mind_maps SET title = $1, data = $2, model = $3, updated_at = $4 WHERE id = $5`, [map.title, data, map.model, now, str(row.id)]);
      return { ...map, id: str(row.id), deckId, createdAt: num(row.created_at), updatedAt: now };
    }
    const id = newId();
    await tx.exec(
      `INSERT INTO mind_maps (id, deck_id, user_id, title, data, model, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, deckId, userId, map.title, data, map.model, now, now],
    );
    return { ...map, id, deckId, createdAt: now, updatedAt: now };
  });
}

export async function deleteMindMap(userId: string, deckId: string): Promise<void> {
  await exec(`DELETE FROM mind_maps WHERE user_id = $1 AND deck_id = $2`, [userId, deckId]);
}

// ---------- Esami orali ----------

// Ogni esame è privato: lo vede solo lo studente che l'ha sostenuto.
type OralExamData = Omit<OralExam, "id" | "title" | "model" | "createdAt">;

function toOralExam(r: Row): OralExam | null {
  const data = parseJson<(OralExamData & { question?: string; transcript?: string }) | null>(r.data, null);
  if (!data?.result) return null;
  // Esami della prima versione: una sola risposta libera, senza giudizio per domanda.
  const answers = data.answers ?? [{ question: data.question || "Free presentation", transcript: data.transcript ?? "", durationSec: data.durationSec }];
  return {
    ...data,
    mode: data.mode ?? "custom",
    answers,
    result: { ...data.result, answers: data.result.answers ?? [] },
    id: str(r.id),
    title: str(r.title),
    model: str(r.model),
    createdAt: num(r.created_at),
  };
}

export async function listOralExams(userId: string): Promise<OralExamSummary[]> {
  const rows = await query(`SELECT * FROM oral_exams WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
  return rows
    .map(toOralExam)
    .filter((e): e is OralExam => e !== null)
    .map((e) => ({ id: e.id, title: e.title, createdAt: e.createdAt, durationSec: e.durationSec, grade: e.result.grade, honors: e.result.honors }));
}

export async function getOralExam(userId: string, id: string): Promise<OralExam | null> {
  const row = await findOne(`SELECT * FROM oral_exams WHERE id = $1 AND user_id = $2`, [id, userId]);
  return row ? toOralExam(row) : null;
}

export async function insertOralExam(userId: string, exam: OralExam): Promise<void> {
  const { id, title, model, createdAt, ...data } = exam;
  await exec(
    `INSERT INTO oral_exams (id, user_id, title, grade, data, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, userId, title, exam.result.grade, JSON.stringify(data), model, createdAt],
  );
}

export async function deleteOralExam(userId: string, id: string): Promise<void> {
  await exec(`DELETE FROM oral_exams WHERE id = $1 AND user_id = $2`, [id, userId]);
}
