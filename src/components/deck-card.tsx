import { AlertCircle, Globe2, Loader2, Lock } from "lucide-react";
import Link from "next/link";
import type { Deck } from "@/lib/types";
import { RelativeTime } from "./relative-time";
import { cn } from "./styles";
import { Pill, SubjectBadge } from "./ui";

export function DeckStatusPill({ deck }: { deck: Pick<Deck, "status" | "cardCount"> }) {
  if (deck.status === "generating") {
    return (
      <Pill tone="primary">
        <Loader2 className="size-3 animate-spin" /> Generating
      </Pill>
    );
  }
  if (deck.status === "error") {
    return (
      <Pill tone="danger">
        <AlertCircle className="size-3" /> {deck.cardCount > 0 ? "Last generation failed" : "Error"}
      </Pill>
    );
  }
  return null;
}

export function VisibilityPill({ isPublic, className }: { isPublic: boolean; className?: string }) {
  return isPublic ? (
    <Pill tone="primary" className={className}>
      <Globe2 className="size-3" /> Public
    </Pill>
  ) : (
    <Pill className={className}>
      <Lock className="size-3" /> Private
    </Pill>
  );
}

export function DeckCard({ deck, showOwner = false }: { deck: Deck; showOwner?: boolean }) {
  const generating = deck.status === "generating";
  return (
    <Link
      href={`/decks/${deck.id}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-card shadow-card transition hover:border-primary hover:shadow-raised"
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <SubjectBadge subject={deck.subject} />
          <div className="flex shrink-0 items-center gap-1.5">
            <DeckStatusPill deck={deck} />
            {!generating && deck.status !== "error" && <span className="text-xs text-ink-muted">{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}</span>}
          </div>
        </div>
        <h3 className="mt-3 line-clamp-2 font-serif text-[20px] leading-7 font-semibold text-heading group-hover:text-primary">{deck.title}</h3>
        {deck.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-muted">{deck.description}</p>}
      </div>
      <div className={cn("flex items-center justify-between gap-3 border-t border-line bg-sunken px-5 py-2.5 text-xs text-ink-muted")}>
        <span className="flex min-w-0 items-center gap-2">
          {showOwner ? <span className="truncate font-semibold text-ink">{deck.createdBy}</span> : <VisibilityPill isPublic={deck.isPublic} />}
          {generating && <span className="truncate text-accent">Generating…</span>}
        </span>
        <RelativeTime ms={deck.updatedAt} />
      </div>
    </Link>
  );
}
