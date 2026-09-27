"use client";

import { GalleryVerticalEnd, Globe2, Lock, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DeckCard } from "@/components/deck-card";
import { EmptyState, Input, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { api } from "@/lib/client";
import type { Deck } from "@/lib/types";

type Tab = "mine" | "public";

export function DecksView({ initialMine, initialPublic, initialTab }: { initialMine: Deck[]; initialPublic: Deck[]; initialTab: Tab }) {
  const [mine, setMine] = useState(initialMine);
  const [publicDecks] = useState(initialPublic);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");

  // Aggiorna i propri mazzi mentre una generazione è in corso
  const anyGenerating = mine.some((d) => d.status === "generating");
  useEffect(() => {
    if (!anyGenerating) return;
    const timer = setInterval(() => {
      api<{ decks: Deck[] }>("/api/decks?scope=mine")
        .then((res) => setMine(res.decks))
        .catch(() => undefined);
    }, 4000);
    return () => clearInterval(timer);
  }, [anyGenerating]);

  function switchTab(next: Tab) {
    setTab(next);
    setSubject("");
    const url = new URL(window.location.href);
    if (next === "public") url.searchParams.set("view", "public");
    else url.searchParams.delete("view");
    window.history.replaceState(null, "", url);
  }

  const decks = tab === "mine" ? mine : publicDecks;
  const subjects = useMemo(() => [...new Set(decks.map((d) => d.subject))].sort((a, b) => a.localeCompare(b, "en")), [decks]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decks.filter(
      (d) =>
        (!subject || d.subject === subject) &&
        (!q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.createdBy.toLowerCase().includes(q)),
    );
  }, [decks, query, subject]);

  const tabs: { id: Tab; label: string; icon: typeof Lock; count: number }[] = [
    { id: "mine", label: "My decks", icon: Lock, count: mine.length },
    { id: "public", label: "Shared by the class", icon: Globe2, count: publicDecks.length },
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Personal archive"
        title="Decks"
        description="Your decks are private: make them public to share them with the class."
        actions={
          <Link href="/generate" className={buttonClass()}>
            <Sparkles className="size-4" /> New deck
          </Link>
        }
      />

      <div role="tablist" className="mb-5 flex gap-1 border-b border-line">
        {tabs.map(({ id, label, icon: Icon, count }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
            className={cn(
              "-mb-px flex cursor-pointer items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition",
              tab === id ? "border-primary text-heading" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} />
            {label}
            <span className="rounded-full bg-muted px-1.5 text-[11px] text-ink-muted tabular-nums">{count}</span>
          </button>
        ))}
      </div>

      {decks.length === 0 ? (
        tab === "mine" ? (
          <EmptyState
            icon={<GalleryVerticalEnd className="size-5" />}
            title="No decks yet"
            description="Generate your first deck from the uploaded materials."
            action={
              <Link href="/generate" className={buttonClass()}>
                <Sparkles className="size-4" /> Generate flashcards
              </Link>
            }
          />
        ) : (
          <EmptyState
            icon={<Globe2 className="size-5" />}
            title="No public decks"
            description="When a classmate makes a deck public, you will find it here and can study it or save a copy."
          />
        )
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, description or author…" className="pl-10" aria-label="Search decks" />
            </div>
            <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="sm:w-56" aria-label="Filter by subject">
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">No decks match the filters.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((deck) => (
                <DeckCard key={deck.id} deck={deck} showOwner={tab === "public"} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
