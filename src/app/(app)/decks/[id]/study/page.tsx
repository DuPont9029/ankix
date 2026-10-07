import { CalendarCheck2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ScheduledSession } from "@/components/study/session";
import { EmptyState, buttonClass } from "@/components/ui";
import { getCurrentUser } from "@/lib/current-user";
import { canViewDeck, getDeck, listCards } from "@/lib/repo";
import { buildPlan } from "@/lib/study";
import { StudyView } from "./study-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Study" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * `?mode=due`: sessione programmata (ripetizione dilazionata) solo per questo mazzo.
 * Altrimenti ripasso libero di tutte le card, oppure solo di quelle in `?cards=id1,id2` (es. da una mappa mentale).
 */
export default async function StudyPage({ params, searchParams }: PageProps<"/decks/[id]/study">) {
  const { id } = await params;
  const query = await searchParams;
  const [user, deck] = await Promise.all([getCurrentUser(), getDeck(id)]);
  if (!user || !deck || !canViewDeck(deck, user.id)) notFound();

  if (first(query.mode) === "due") {
    const plan = await buildPlan(user.id, { deckId: id });
    if (plan.items.length === 0) {
      return (
        <EmptyState
          icon={<CalendarCheck2 className="size-5" />}
          title="All caught up"
          description="No cards of this deck are due today. Come back tomorrow, or practise freely without affecting the schedule."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`/decks/${id}`} className={buttonClass("secondary")}>
                Back to deck
              </Link>
              <Link href={`/decks/${id}/study`} className={buttonClass()}>
                Practise all cards
              </Link>
            </div>
          }
        />
      );
    }
    return <ScheduledSession plan={plan} title={deck.title} backHref={`/decks/${id}`} />;
  }

  const only = new Set((first(query.cards) ?? "").split(",").filter(Boolean));
  const cards = (await listCards(id)).filter((c) => only.size === 0 || only.has(c.id));
  return <StudyView deck={deck} cards={cards} />;
}
