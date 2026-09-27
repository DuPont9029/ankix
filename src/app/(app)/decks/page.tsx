import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/current-user";
import { listDecks } from "@/lib/repo";
import { DecksView } from "./decks-view";

export const metadata: Metadata = { title: "Decks" };
export const dynamic = "force-dynamic";

export default async function DecksPage({ searchParams }: PageProps<"/decks">) {
  const params = await searchParams;
  const user = (await getCurrentUser())!;
  const [mine, publicDecks] = await Promise.all([listDecks(user.id, "mine"), listDecks(user.id, "public")]);
  return <DecksView initialMine={mine} initialPublic={publicDecks} initialTab={params.view === "public" ? "public" : "mine"} />;
}
