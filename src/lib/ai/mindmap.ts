import "server-only";
import { z } from "zod";
import { normalizeConceptMap, type ConceptMapData } from "../conceptmap";
import { cardRefs, cardsForPrompt, normalizeMap, type MindMapData } from "../mindmap";
import type { Card, Deck } from "../types";
import { AiError, type JsonSchema } from "./common";
import { generateStructured } from "./generate";
import type { AiCredentials } from "./settings";

// Mappa mentale e mappa concettuale di un mazzo generate da un provider cloud a partire dalle card.
// Sono due richieste distinte: strutture e regole diverse (albero radiale vs rete di proposizioni).

const SYSTEM = "You are an expert medical educator who designs clear mind maps and concept maps (Novak) for university students.";

const language = (deck: Pick<Deck, "options">) => (deck.options.language === "it" ? "Italian" : "English");

// ---------- mappa mentale ----------

const MIND_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: { type: "string", description: "Central topic of the deck, max 6 words" },
    nodes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short unique id, e.g. n1" },
          label: { type: "string", description: "Keyword or short noun phrase (max 5 words)" },
          note: { type: "string", description: "One short sentence. May be empty." },
          parent: { type: "string", description: "id of the parent node; empty string only for the central topic" },
          cards: { type: "array", items: { type: "integer" }, description: "Numbers (#) of the flashcards about this node" },
        },
        required: ["id", "label", "note", "parent", "cards"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "nodes"],
  additionalProperties: false,
};

const MindResponse = z.object({
  title: z.string(),
  nodes: z.array(z.object({ id: z.string(), label: z.string(), note: z.string(), parent: z.string(), cards: z.array(z.number()) })),
});

function mindInstructions(deck: Pick<Deck, "title" | "subject" | "options">): string {
  return [
    `Build a MIND MAP of the flashcard deck "${deck.title}" (subject: ${deck.subject}). Write everything in ${language(deck)}.`,
    "A mind map is radial: the central topic, main branches around it and sub-branches with keywords.",
    "- Exactly one central node (parent = empty string).",
    "- 3 to 8 main branches, each with 2 to 6 sub-branches; at most 4 levels; 15 to 50 nodes overall.",
    "- Labels are keywords or short noun phrases (max 5 words), never questions or sentences.",
    "- Organise by theme (definition, phases, mechanisms, regulation, clinical aspects…), not one node per card.",
    "- For each node list the numbers of the flashcards about it (each card in at most 2 nodes).",
    "- Use only information found in the flashcards.",
  ].join("\n");
}

// ---------- mappa concettuale ----------

const CONCEPT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    focus_question: { type: "string", description: "The focus question the concept map answers" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Short unique id, e.g. c1" },
          label: { type: "string", description: "Concept: a noun or short noun phrase (1-4 words)" },
          level: { type: "integer", description: "Hierarchy level: 0 = most general/inclusive concept, higher = more specific" },
          note: { type: "string", description: "One short sentence. May be empty." },
          cards: { type: "array", items: { type: "integer" }, description: "Numbers (#) of the flashcards about this concept" },
        },
        required: ["id", "label", "level", "note", "cards"],
        additionalProperties: false,
      },
    },
    propositions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string", description: "id of the first concept" },
          linking_words: { type: "string", description: "Verb or short phrase so that 'from + linking words + to' reads as a true sentence" },
          to: { type: "string", description: "id of the second concept" },
          cross_link: { type: "boolean", description: "true if it links concepts of different branches/segments of the map" },
          cards: { type: "array", items: { type: "integer" }, description: "Numbers (#) of the flashcards that test this relation" },
        },
        required: ["from", "linking_words", "to", "cross_link", "cards"],
        additionalProperties: false,
      },
    },
  },
  required: ["focus_question", "concepts", "propositions"],
  additionalProperties: false,
};

const ConceptResponse = z.object({
  focus_question: z.string(),
  concepts: z.array(z.object({ id: z.string(), label: z.string(), level: z.number(), note: z.string(), cards: z.array(z.number()) })),
  propositions: z.array(z.object({ from: z.string(), linking_words: z.string(), to: z.string(), cross_link: z.boolean(), cards: z.array(z.number()) })),
});

function conceptInstructions(deck: Pick<Deck, "title" | "subject" | "options">): string {
  return [
    `Build a CONCEPT MAP (Novak) of the flashcard deck "${deck.title}" (subject: ${deck.subject}). Write everything in ${language(deck)}.`,
    "A concept map is a network of propositions: concept → linking words → concept, each one a true, meaningful sentence.",
    "- Start from a focus question that the map answers.",
    "- Concepts are nouns or short noun phrases (1-4 words), NEVER sentences, verbs or questions. Each concept appears only once.",
    "- Hierarchy: level 0 holds the 1-2 most general concepts, then increasingly specific concepts at lower levels (3 to 5 levels). Hierarchical links go from a more general concept to a more specific one.",
    "- EVERY link has linking words (a verb or a short phrase: 'produces', 'occurs during', 'is caused by', 'consists of', 'reduces'). 'from + linking words + to' must read as a correct sentence.",
    "- A concept can be linked to several others: it is a network, not a tree.",
    "- Add 3 to 8 cross-links (cross_link = true) between concepts in different segments of the map: they show the deeper relations.",
    "- 15 to 35 concepts and 20 to 50 propositions.",
    "- For concepts and propositions list the numbers of the flashcards that test them.",
    "- Use only information found in the flashcards.",
  ].join("\n");
}

function prompt(instructions: string, cards: Card[]) {
  const { text, ids } = cardsForPrompt(cards, 150_000, 400);
  if (ids.length === 0) throw new AiError("The deck has no cards to build a map from.");
  return { text: `${instructions}\n\nFlashcards (question → answer):\n${text}`, ids };
}

export async function generateMindMap(deck: Deck, cards: Card[], cred: AiCredentials): Promise<MindMapData & { title: string }> {
  const { text, ids } = prompt(mindInstructions(deck), cards);
  const parsed = await generateStructured(
    cred,
    { system: SYSTEM, sources: [], prompt: text, schema: MIND_SCHEMA, schemaName: "mind_map", temperature: 0.3 },
    (json) => MindResponse.parse(json),
  );
  const data = normalizeMap(
    { nodes: parsed.nodes.map((n) => ({ id: n.id, label: n.label, note: n.note, parent: n.parent || null, cards: cardRefs(n.cards, ids) })), links: [] },
    new Set(cards.map((c) => c.id)),
    deck.title,
  );
  if (data.nodes.length < 3) throw new AiError("The AI did not return a usable mind map. Try again or use another engine.");
  return { ...data, title: parsed.title.trim().slice(0, 120) || deck.title };
}

export async function generateConceptMap(deck: Deck, cards: Card[], cred: AiCredentials): Promise<ConceptMapData> {
  const { text, ids } = prompt(conceptInstructions(deck), cards);
  const parsed = await generateStructured(
    cred,
    { system: SYSTEM, sources: [], prompt: text, schema: CONCEPT_SCHEMA, schemaName: "concept_map", temperature: 0.3 },
    (json) => ConceptResponse.parse(json),
  );
  const data = normalizeConceptMap(
    {
      focus: parsed.focus_question,
      concepts: parsed.concepts.map((c) => ({ id: c.id, label: c.label, level: c.level, note: c.note, cards: cardRefs(c.cards, ids) })),
      propositions: parsed.propositions.map((p, i) => ({
        id: `p${i + 1}`,
        from: p.from,
        to: p.to,
        label: p.linking_words,
        cross: p.cross_link,
        cards: cardRefs(p.cards, ids),
      })),
    },
    new Set(cards.map((c) => c.id)),
  );
  if (data.concepts.length < 3 || data.propositions.length < 2) throw new AiError("The AI did not return a usable concept map. Try again or use another engine.");
  return data;
}
