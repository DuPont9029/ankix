import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAiStatus } from "@/lib/ai/settings";
import { getCurrentUser } from "@/lib/current-user";
import { canViewDeck, getDeck, getMindMap, listCards } from "@/lib/repo";
import { MapView } from "./map-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mind map" };

export default async function MindMapPage({ params }: PageProps<"/decks/[id]/map">) {
  const { id } = await params;
  const [user, deck] = await Promise.all([getCurrentUser(), getDeck(id)]);
  if (!user || !deck || !canViewDeck(deck, user.id)) notFound();
  const [cards, map, aiStatus] = await Promise.all([listCards(id), getMindMap(user.id, id), getAiStatus(user)]);
  return <MapView deck={deck} cards={cards} initialMap={map} aiStatus={aiStatus} />;
}
