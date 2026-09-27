import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { canViewDeck, getDeck, listCards } from "@/lib/repo";
import { StudyView } from "./study-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Study" };

export default async function StudyPage({ params }: PageProps<"/decks/[id]/study">) {
  const { id } = await params;
  const [user, deck] = await Promise.all([getCurrentUser(), getDeck(id)]);
  if (!user || !deck || !canViewDeck(deck, user.id)) notFound();
  const cards = await listCards(id);
  return <StudyView deck={deck} cards={cards} />;
}
