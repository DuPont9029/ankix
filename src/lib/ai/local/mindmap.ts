// Mappe con il modello locale (nel browser). Il modello piccolo produce formati a righe, più affidabili
// del JSON, che poi vengono convertiti e validati come quelli dei provider cloud.
import { normalizeConceptMap, parseConceptOutline, type ConceptMapData } from "../../conceptmap";
import { cardsForPrompt, normalizeMap, parseOutlineMap, type MindMapData } from "../../mindmap";
import type { Card, Deck } from "../../types";
import { contextChars, ensureEngine, runPrompt } from "./engine";

type Options = { onText?: (chunk: string) => void; signal?: AbortSignal };

const SYSTEM = "You are an expert medical educator who designs clear mind maps and concept maps for students.";

// Le card stanno nel contesto del motore (8k–32k token, vedi engine.ts) lasciando spazio alla risposta.
async function promptCards(cards: Card[]) {
  await ensureEngine();
  return cardsForPrompt(cards, Math.min(60_000, contextChars(3500)), 200);
}
const language = (deck: Pick<Deck, "options">) => (deck.options.language === "it" ? "Italian" : "English");

export async function generateMindMapLocally(deck: Pick<Deck, "title" | "subject" | "options">, cards: Card[], { onText, signal }: Options = {}): Promise<MindMapData> {
  const { text, ids } = await promptCards(cards);
  const prompt = [
    `Build a mind map of the flashcard deck "${deck.title}" (subject: ${deck.subject}). Write in ${language(deck)}.`,
    "Output ONLY an indented outline, two spaces per level:",
    "- The first line is the central topic, without indentation.",
    "- Then 3 to 7 main branches, each with 2 to 5 sub-branches (at most 3 levels below the topic).",
    '- Each line: "- Keyword | one short sentence | cards: 3, 7" (the numbers of the flashcards about it).',
    "- Keywords are short noun phrases (max 5 words), never questions.",
    "",
    "Flashcards:",
    text,
  ].join("\n");
  const output = await runPrompt(prompt, { system: SYSTEM, onText, signal, maxChars: 7000 });
  const data = normalizeMap({ ...parseOutlineMap(output, ids), links: [] }, new Set(cards.map((c) => c.id)), deck.title);
  if (data.nodes.length < 3) throw new Error("The local model did not produce a usable mind map. Try again or use a cloud AI.");
  return data;
}

export async function generateConceptMapLocally(
  deck: Pick<Deck, "title" | "subject" | "options">,
  cards: Card[],
  { onText, signal }: Options = {},
): Promise<ConceptMapData> {
  const { text, ids } = await promptCards(cards);
  const prompt = [
    `Build a CONCEPT MAP (Novak) of the flashcard deck "${deck.title}" (subject: ${deck.subject}). Write in ${language(deck)}.`,
    "A concept map is made of propositions: Concept -> linking words -> Concept, each one a true sentence.",
    "Use exactly this format and nothing else:",
    "FOCUS: <the question the map answers>",
    "CONCEPTS:",
    "0 | <most general concept> | cards: 1, 2",
    "1 | <more specific concept> | cards: 3",
    "2 | <even more specific concept>",
    "PROPOSITIONS:",
    "<Concept> -> <linking words> -> <Concept> | cards: 4",
    "CROSS-LINKS:",
    "<Concept> -> <linking words> -> <Concept>",
    "",
    "Rules:",
    "- 12 to 25 concepts: nouns or short noun phrases (1-4 words), never sentences. The number before each concept is its level: 0 = most general, higher = more specific.",
    "- 15 to 30 propositions from more general to more specific concepts. EVERY arrow has linking words (a verb or short phrase like 'produces', 'occurs during', 'is caused by').",
    "- 2 to 5 cross-links between concepts of different branches.",
    "- Use the exact concept names of the CONCEPTS list in propositions and cross-links.",
    "",
    "Flashcards:",
    text,
  ].join("\n");
  const output = await runPrompt(prompt, { system: SYSTEM, onText, signal, maxChars: 8000 });
  const data = normalizeConceptMap(parseConceptOutline(output, ids), new Set(cards.map((c) => c.id)));
  if (data.concepts.length < 3 || data.propositions.length < 2) {
    throw new Error("The local model did not produce a usable concept map. Try again or use a cloud AI.");
  }
  return data;
}
