import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { plainText } from "@/lib/items";
import { canViewDeck, getDecksByIds, getOralExam, listCardsForDecks } from "@/lib/repo";
import { ExamResultView } from "./exam-result";

export const metadata: Metadata = { title: "Exam result" };
export const dynamic = "force-dynamic";

export default async function ExamResultPage({ params }: PageProps<"/exam/[id]">) {
  const { id } = await params;
  const user = (await getCurrentUser())!;
  const exam = await getOralExam(user.id, id);
  if (!exam) notFound();
  // Domande delle card collegate (cloze nascoste, per non svelare le risposte) agli argomenti (i mazzi eliminati nel frattempo spariscono dai link).
  const decks = (await getDecksByIds(exam.scheduling.decks.map((d) => d.id))).filter((d) => canViewDeck(d, user.id));
  const wanted = new Set(exam.result.topics.flatMap((t) => [...t.cardIds, ...t.newCardIds]));
  const cards = (await listCardsForDecks(decks.map((d) => d.id))).filter((c) => wanted.has(c.id));
  const cardTexts = Object.fromEntries(cards.map((c) => [c.id, { deckId: c.deckId, text: plainText(c.front.replace(/\{\{c\d+::[\s\S]*?\}\}/g, "[…]")).slice(0, 200) }]));
  return <ExamResultView exam={exam} decks={decks.map((d) => ({ id: d.id, title: d.title }))} cardTexts={cardTexts} />;
}
