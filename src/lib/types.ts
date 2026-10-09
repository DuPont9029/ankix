import type { AiProvider } from "./ai/providers";

export type CardType = "basic" | "cloze" | "image_occlusion" | "mcq";

/** Opzione di una domanda a scelta multipla (esattamente una è corretta). */
export type Choice = { text: string; correct: boolean };

/** Maschera di image occlusion: coordinate relative all'immagine (0–1). */
export type Occlusion = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
export type DeckStatus = "generating" | "ready" | "error";

export type Material = {
  id: string;
  title: string;
  subject: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploadedById: string | null;
  /** Visibile a tutta la classe; se false solo chi l'ha caricato lo vede e lo usa */
  isPublic: boolean;
  createdAt: number;
};

export type GenerationOptions = {
  cardCount: number;
  cardType: "basic" | "cloze" | "mixed" | "mcq" | "image_occlusion";
  difficulty: "base" | "intermedio" | "avanzato";
  language: "it" | "en";
  focus: string;
  materialIds: string[];
  /** true se il titolo va proposto dall'AI */
  autoTitle?: boolean;
  /** Motore usato per l'ultima generazione (assente nei mazzi creati prima dei motori multipli = Gemini) */
  provider?: AiProvider;
};

export type DeckSource = { id: string; title: string };

export type Deck = {
  id: string;
  title: string;
  subject: string;
  description: string;
  status: DeckStatus;
  error: string | null;
  options: GenerationOptions;
  sources: DeckSource[];
  model: string;
  createdBy: string;
  createdById: string | null;
  /** I mazzi sono privati finché il proprietario non li rende pubblici */
  isPublic: boolean;
  createdAt: number;
  updatedAt: number;
  cardCount: number;
};

export type Card = {
  id: string;
  deckId: string;
  position: number;
  type: CardType;
  front: string;
  back: string;
  extra: string;
  tags: string[];
  /** Solo image occlusion: materiale (immagine) e maschere */
  imageMaterialId: string | null;
  occlusions: Occlusion[];
  /** Solo scelta multipla ("mcq"): opzioni nell'ordine mostrato. `back` contiene il testo della risposta corretta. */
  choices: Choice[];
  createdAt: number;
  updatedAt: number;
};
