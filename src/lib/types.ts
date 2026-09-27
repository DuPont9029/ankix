export type CardType = "basic" | "cloze";
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
  createdAt: number;
};

export type GenerationOptions = {
  cardCount: number;
  cardType: "basic" | "cloze" | "mixed";
  difficulty: "base" | "intermedio" | "avanzato";
  language: "it" | "en";
  focus: string;
  materialIds: string[];
  /** true se il titolo va proposto dall'AI */
  autoTitle?: boolean;
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
  createdAt: number;
  updatedAt: number;
};
