import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { getGeminiKey } from "@/lib/gemini-key";
import { canViewDeck, getDeck, isDeckOwner, listCards } from "@/lib/repo";
import { DeckView } from "./deck-view";

export const dynamic = "force-dynamic";

async function loadVisibleDeck(id: string) {
  const user = await getCurrentUser();
  const deck = await getDeck(id);
  if (!user || !deck || !canViewDeck(deck, user.id)) return null;
  return { user, deck };
}

export async function generateMetadata({ params }: PageProps<"/decks/[id]">): Promise<Metadata> {
  const { id } = await params;
  const found = await loadVisibleDeck(id);
  return { title: found?.deck.title ?? "Deck not found" };
}

export default async function DeckPage({ params }: PageProps<"/decks/[id]">) {
  const { id } = await params;
  const found = await loadVisibleDeck(id);
  if (!found) notFound();
  const { user, deck } = found;
  const owner = isDeckOwner(deck, user.id);
  const [cards, key] = await Promise.all([listCards(id), owner ? getGeminiKey(user) : null]);
  return <DeckView initialDeck={deck} initialCards={cards} isOwner={owner} hasGeminiKey={Boolean(key)} model={env.geminiModel} />;
}
