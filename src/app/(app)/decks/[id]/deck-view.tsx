"use client";

import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CalendarCheck2,
  Network,
  Bot,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Globe2,
  Lock,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  SquareStack,
  Stethoscope,
  Trash2,
  UserRound,
  ListChecks,
  Layers,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { CardEditorForm, CardEditorModal } from "@/components/cards/card-editor";
import { CardHtml, ChoicesHtml, ClozeMarkedHtml } from "@/components/cards/card-html";
import { OcclusionView } from "@/components/cards/occlusion-view";
import { EnginePicker } from "@/components/ai/engine-picker";
import { useLocalGeneration } from "@/components/ai/local-generation";
import { DeckStatusPill } from "@/components/deck-card";
import { RelativeTime } from "@/components/relative-time";
import { Button, ConfirmDialog, EmptyState, Input, Label, Modal, Pill, Select, SubjectBadge, Switch, Textarea, buttonClass, cn } from "@/components/ui";
import type { LocalMaterial } from "@/lib/ai/local/extract";
import { LOCAL_MODEL_LABEL, PROVIDER_INFO, providerReady, type AiProvider, type AiStatus } from "@/lib/ai/providers";
import { api, errorMessage } from "@/lib/client";
import { SUBJECTS } from "@/lib/subjects";
import type { DeckProgress } from "@/lib/study";
import type { Card, Deck } from "@/lib/types";
import { useApiErrorToast } from "@/lib/use-api-error";
import { useMediaQuery } from "@/lib/use-media-query";

const GENERATING_MESSAGES = [
  "Reading the materials…",
  "Finding high-yield concepts…",
  "Writing questions and clozes…",
  "Checking duplicates and formatting…",
];

function GeneratingBanner({ since, model }: { since: number; model: string }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const first = setTimeout(update, 0);
    const t = setInterval(update, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const message = GENERATING_MESSAGES[Math.floor(elapsed / 6) % GENERATING_MESSAGES.length];
  return (
    <div className="relative mb-6 overflow-hidden rounded-lg border border-accent/25 bg-accent-soft p-5">
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-accent/15">
        <div className="h-full w-1/3 animate-[ankix-progress_1.6s_ease-in-out_infinite] bg-accent" />
      </div>
      <div className="flex items-center gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-highlight text-on-highlight">
          <Sparkles className="size-[18px] animate-pulse" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-heading">{model} is generating the flashcards</p>
          <p className="text-[13px] text-ink-muted" suppressHydrationWarning>
            {message} · {elapsed}s
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-muted">You can leave this page: generation continues on the server.</p>
    </div>
  );
}

/** Avanzamento personale: imparate, in apprendimento, nuove (con la data d'esame, se impostata). */
function ProgressStrip({ progress, deckId }: { progress: DeckProgress; deckId: string }) {
  const learned = progress.total - progress.fresh - progress.learning;
  const segments = [
    { label: "Mastered", value: progress.mature, className: "bg-primary" },
    { label: "Learned", value: learned - progress.mature, className: "bg-primary/55" },
    { label: "Learning", value: progress.learning, className: "bg-warning" },
    { label: "New", value: progress.fresh, className: "bg-muted-strong" },
  ];
  return (
    <div className="mb-6 rounded-lg border border-line bg-card p-4 shadow-card">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow text-ink-muted">Your progress</p>
        <p className="text-[12px] text-ink-muted">
          {progress.due > 0 ? <span className="font-semibold text-ink">{progress.due} due today</span> : "Nothing due today"}
          {progress.exam && (
            <>
              {" · "}exam on {new Date(`${progress.exam}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}
            </>
          )}
          {" · "}
          <Link href="/plan" className="font-semibold text-accent hover:underline">
            {progress.exam ? "Change" : "Set exam date"}
          </Link>
          {" · "}
          <Link href={`/decks/${deckId}/map`} className="font-semibold text-accent hover:underline">
            Mind map
          </Link>
        </p>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {segments.map((seg) => seg.value > 0 && <div key={seg.label} className={seg.className} style={{ width: `${(seg.value / progress.total) * 100}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-muted">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", seg.className)} /> {seg.label} <span className="font-semibold text-ink tabular-nums">{seg.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, icon, children }: { label: string; value?: ReactNode; icon: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-sunken p-4">
      <div className="min-w-0">
        <p className="eyebrow text-ink-muted">{label}</p>
        {value !== undefined && <p className="mt-1 font-serif text-[26px] leading-8 font-semibold text-heading tabular-nums">{value}</p>}
        {children}
      </div>
      <span className="hidden size-10 shrink-0 place-items-center rounded-md border border-line bg-card text-ink-muted sm:grid">{icon}</span>
    </div>
  );
}

function OverflowMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" size="sm" className="px-2" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More actions">
        <MoreVertical className="size-4" />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-md border border-line bg-card py-1 shadow-raised">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, children, onClick, href, danger }: { icon: ReactNode; children: ReactNode; onClick?: () => void; href?: string; danger?: boolean }) {
  const cls = cn("flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium hover:bg-muted", danger ? "text-danger" : "text-ink");
  if (href) {
    return (
      <a role="menuitem" href={href} download className={cls} onClick={onClick}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" className={cls} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

function CardRow({
  card,
  index,
  canEdit,
  active,
  onEdit,
  onDelete,
}: {
  card: Card;
  index: number;
  canEdit: boolean;
  active: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={cn("rounded-lg border bg-card p-4 shadow-card transition sm:p-5", active ? "border-primary shadow-raised" : "border-line")}>
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink-muted tabular-nums">#{index}</span>
        <span
          className={cn(
            "shrink-0 rounded-[4px] px-1.5 py-0.5 text-[11px] font-bold tracking-[0.04em] whitespace-nowrap",
            card.type === "cloze"
              ? "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300"
              : card.type === "mcq"
                ? "bg-violet-50 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
              : card.type === "image_occlusion"
                ? "bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
                : "bg-muted text-ink",
          )}
        >
          {card.type === "cloze" ? "CLOZE" : card.type === "mcq" ? "QUIZ" : card.type === "image_occlusion" ? "IMAGE OCCLUSION" : "BASIC"}
        </span>
        <span className="flex min-w-0 flex-wrap gap-1">
          {card.tags.map((t) => (
            <span key={t} className="truncate rounded-[4px] bg-sunken px-1.5 py-0.5 text-[11px] text-ink-muted">
              #{t}
            </span>
          ))}
        </span>
        {canEdit && (
          <span className="ml-auto flex shrink-0 items-center">
            <button type="button" onClick={onEdit} className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-muted hover:text-ink" aria-label={`Edit card ${index}`}>
              <Pencil className="size-4" />
            </button>
            <button type="button" onClick={onDelete} className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-danger-soft hover:text-danger" aria-label={`Delete card ${index}`}>
              <Trash2 className="size-4" />
            </button>
          </span>
        )}
      </div>

      {card.type === "image_occlusion" && card.imageMaterialId ? (
        <div className="mt-3 rounded-md bg-sunken p-4">
          {card.front && <p className="mb-3 font-serif text-[17px] leading-7 text-ink">{card.front}</p>}
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="flex justify-center">
              <OcclusionView materialId={card.imageMaterialId} occlusions={card.occlusions} mode={{ kind: "overview" }} />
            </div>
            <div>
              <p className="eyebrow mb-2 text-accent">Hidden terms ({card.occlusions.length} cards)</p>
              <ol className="space-y-1 text-[13px] text-ink">
                {card.occlusions.map((o, i) => (
                  <li key={o.id} className="flex gap-2">
                    <span className="grid size-5 shrink-0 place-items-center rounded-[3px] bg-[#ffeba2] text-[10px] font-bold text-[#212121]">{i + 1}</span>
                    <span className="min-w-0 break-words">{o.label || <span className="text-ink-faint italic">no label</span>}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      ) : card.type === "mcq" ? (
        <div className="mt-3 rounded-md bg-sunken p-4">
          <p className="eyebrow mb-1.5 text-ink-muted">Question</p>
          <CardHtml html={card.front} className="mb-3 font-serif text-[17px] leading-7 text-ink" />
          <ChoicesHtml choices={card.choices} reveal className="max-w-none" />
        </div>
      ) : card.type === "cloze" ? (
        <div className="mt-3 rounded-md bg-sunken p-4">
          <p className="eyebrow mb-2 text-ink-muted">Cloze text</p>
          <ClozeMarkedHtml text={card.front} className="font-serif text-[17px] leading-8 text-ink" />
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-md bg-sunken p-4">
            <p className="eyebrow mb-1.5 text-ink-muted">Question (front)</p>
            <CardHtml html={card.front} className="font-serif text-[17px] leading-7 text-ink" />
          </div>
          <div className="rounded-md bg-sunken p-4">
            <p className="eyebrow mb-1.5 text-accent">Answer (back)</p>
            <CardHtml html={card.back} className="leading-6 text-ink" />
          </div>
        </div>
      )}

      {card.extra && (
        <div className="mt-3 flex gap-2 text-[13px] leading-5 text-ink-muted">
          <Stethoscope className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0">
            <span className="font-semibold text-ink">{card.type === "mcq" ? "Explanation: " : "Clinical note: "}</span>
            <CardHtml html={card.extra} className="inline [&>*]:inline" />
          </div>
        </div>
      )}
    </article>
  );
}

type EditorState = { mode: "closed" } | { mode: "new" } | { mode: "edit"; card: Card };

export function DeckView({
  initialDeck,
  initialCards,
  isOwner,
  aiStatus,
  sourceMaterials,
  progress,
}: {
  initialDeck: Deck;
  initialCards: Card[];
  isOwner: boolean;
  /** Solo per il proprietario: motori AI disponibili */
  aiStatus: AiStatus | null;
  /** Materiali ancora esistenti del mazzo (per il modello locale, che li legge nel browser) */
  sourceMaterials: LocalMaterial[];
  /** Avanzamento dello studente con la ripetizione dilazionata */
  progress: DeckProgress;
}) {
  const router = useRouter();
  const showError = useApiErrorToast();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [deck, setDeck] = useState(initialDeck);
  const [cards, setCards] = useState(initialCards);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"" | "basic" | "cloze" | "mcq" | "image_occlusion">("");
  const [editor, setEditor] = useState<EditorState>({ mode: "closed" });
  const [toDeleteCard, setToDeleteCard] = useState<Card | null>(null);
  const [deleteDeckOpen, setDeleteDeckOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingVisibility, setSavingVisibility] = useState(false);
  const [copying, setCopying] = useState(false);
  const localGeneration = useLocalGeneration();

  const refresh = useCallback(async () => {
    const data = await api<{ deck: Deck; cards: Card[] }>(`/api/decks/${deck.id}`);
    setDeck(data.deck);
    setCards(data.cards);
    return data.deck;
  }, [deck.id]);

  useEffect(() => {
    if (deck.status !== "generating") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const updated = await refresh();
        if (cancelled) return;
        if (updated.status === "ready") toast.success(`Deck ready: ${updated.cardCount} flashcards`);
        if (updated.status === "error") toast.error(updated.error ?? "Generation failed");
      } catch {
        /* nuovo tentativo al prossimo giro */
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [deck.status, refresh]);

  const indexOf = useMemo(() => new Map(cards.map((c, i) => [c.id, i + 1])), [cards]);
  const counts = useMemo(
    () => ({
      basic: cards.filter((c) => c.type === "basic").length,
      cloze: cards.filter((c) => c.type === "cloze").length,
      mcq: cards.filter((c) => c.type === "mcq").length,
      occlusion: cards.filter((c) => c.type === "image_occlusion").length,
    }),
    [cards],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter(
      (c) => (!typeFilter || c.type === typeFilter) && (!q || `${c.front} ${c.back} ${c.extra} ${c.tags.join(" ")} ${c.occlusions.map((x) => x.label).join(" ")} ${c.choices.map((x) => x.text).join(" ")}`.toLowerCase().includes(q)),
    );
  }, [cards, query, typeFilter]);

  const generating = deck.status === "generating";
  const editingId = editor.mode === "edit" ? editor.card.id : null;

  async function deleteCard() {
    if (!toDeleteCard) return;
    setBusy(true);
    try {
      await api(`/api/decks/${deck.id}/cards/${toDeleteCard.id}`, { method: "DELETE" });
      setCards((prev) => prev.filter((c) => c.id !== toDeleteCard.id));
      setDeck((d) => ({ ...d, cardCount: d.cardCount - 1 }));
      if (editingId === toDeleteCard.id) setEditor({ mode: "closed" });
      setToDeleteCard(null);
      toast.success("Card deleted");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteDeck() {
    setBusy(true);
    try {
      await api(`/api/decks/${deck.id}`, { method: "DELETE" });
      toast.success("Deck deleted");
      router.push("/decks");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  async function regenerate(body: { cardCount?: number; focus?: string; provider: AiProvider }) {
    if (body.provider === "local") return regenerateLocally(body);
    setBusy(true);
    try {
      await api(`/api/decks/${deck.id}/generate`, { method: "POST", json: body });
      setDeck((d) => ({ ...d, status: "generating", error: null, updatedAt: Date.now() }));
      setMoreOpen(false);
    } catch (err) {
      showError(err);
      setMoreOpen(false);
    } finally {
      setBusy(false);
    }
  }

  // Il modello locale genera nel browser; le card finite vengono salvate in blocco.
  async function regenerateLocally(body: { cardCount?: number; focus?: string }) {
    if (sourceMaterials.length === 0) {
      toast.error("The source materials have been deleted.");
      return;
    }
    setMoreOpen(false);
    setBusy(true);
    try {
      const result = await localGeneration.run({
        materials: sourceMaterials,
        options: { ...deck.options, cardCount: body.cardCount ?? deck.options.cardCount, focus: body.focus ?? deck.options.focus },
        subject: deck.subject,
        skipImageIds: cards.filter((c) => c.type === "image_occlusion").map((c) => c.imageMaterialId ?? ""),
      });
      if (!result) return;
      try {
        const { cards: created } = await api<{ cards: Card[] }>(`/api/decks/${deck.id}/cards/bulk`, { method: "POST", json: { cards: result.cards } });
        setCards((prev) => [...prev, ...created]);
        setDeck((d) => ({ ...d, status: "ready", error: null, model: LOCAL_MODEL_LABEL, cardCount: d.cardCount + created.length }));
        toast.success(`${created.length} cards added${result.stopped ? " (stopped early)" : ""}`);
        result.warnings.forEach((w) => toast.warning(w));
        localGeneration.close();
      } catch (err) {
        localGeneration.fail(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function setVisibility(isPublic: boolean) {
    setSavingVisibility(true);
    try {
      const res = await api<{ deck: Deck }>(`/api/decks/${deck.id}`, { method: "PATCH", json: { isPublic } });
      setDeck((d) => ({ ...d, isPublic: res.deck.isPublic }));
      toast.success(isPublic ? "Deck is public: the class can now see and copy it" : "Deck is private again: only you can see it");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSavingVisibility(false);
    }
  }

  async function copyToMine() {
    setCopying(true);
    try {
      const { id } = await api<{ id: string }>(`/api/decks/${deck.id}/copy`, { method: "POST" });
      toast.success("Copy saved to your decks");
      router.push(`/decks/${id}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setCopying(false);
    }
  }

  const editorProps = {
    deckId: deck.id,
    card: editor.mode === "edit" ? editor.card : null,
    index: editor.mode === "edit" ? indexOf.get(editor.card.id) : undefined,
    onCancel: () => setEditor({ mode: "closed" }),
    onDelete: (card: Card) => setToDeleteCard(card),
    onSaved: (saved: Card, isNew: boolean) => {
      if (isNew) {
        setCards((prev) => [...prev, saved]);
        setDeck((d) => ({ ...d, cardCount: d.cardCount + 1 }));
      } else {
        setCards((prev) => prev.map((c) => (c.id === saved.id ? saved : c)));
      }
      setEditor({ mode: "closed" });
    },
  };

  const exportHref = `/api/decks/${deck.id}/export?format=apkg`;
  const csvHref = `/api/decks/${deck.id}/export?format=csv`;

  return (
    <div>
      <Link href="/decks" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> All decks
      </Link>

      {/* Intestazione */}
      <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 lg:hidden">
            <SubjectBadge subject={deck.subject} />
            <DeckStatusPill deck={deck} />
          </div>
          <h1 className="font-serif text-[28px] leading-9 font-semibold tracking-[-0.015em] break-words text-heading sm:text-[34px] sm:leading-[42px]">{deck.title}</h1>
          {deck.description && <p className="mt-1.5 max-w-3xl text-ink-muted">{deck.description}</p>}
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <UserRound className="size-3.5" /> Created by <span className="font-medium text-ink">{isOwner ? "you" : deck.createdBy}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Clock3 className="size-3.5" /> <RelativeTime ms={deck.createdAt} />
            </span>
            <span className="flex items-center gap-1.5">
              <Bot className="size-3.5" /> {deck.model}
            </span>
          </p>
          {deck.sources.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span className="eyebrow mr-1 text-ink-muted">Sources:</span>
              {deck.sources.map((s) => (
                <span key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-line bg-sunken px-2 py-1 text-xs text-ink">
                  <FileText className="size-3.5 shrink-0 text-ink-muted" />
                  <span className="truncate">{s.title}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 lg:items-end">
          <div className="hidden items-center gap-2 lg:flex">
            <SubjectBadge subject={deck.subject} />
            {deck.status === "ready" ? (
              <Pill tone="primary">
                <CheckCircle2 className="size-3" /> Status: ready
              </Pill>
            ) : (
              <DeckStatusPill deck={deck} />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {!isOwner && (
              <Button variant="outline" onClick={copyToMine} loading={copying} disabled={generating}>
                {!copying && <Copy className="size-4" />} Save a copy
              </Button>
            )}
            {cards.length > 0 && (
              <>
                <Link href={`/decks/${deck.id}/study?mode=due`} className={buttonClass(progress.due > 0 ? "primary" : "secondary")}>
                  <CalendarCheck2 className="size-4" /> {progress.due > 0 ? `Review due (${progress.due})` : "Study"}
                </Link>
                <Link href={`/decks/${deck.id}/study`} className={buttonClass("secondary")} title="Go through every card without affecting the schedule">
                  <BookOpen className="size-4" /> Practise all
                </Link>
                <Link href={`/decks/${deck.id}/map`} className={buttonClass("secondary")}>
                  <Network className="size-4" /> Mind map
                </Link>
                <a href={exportHref} download className={buttonClass(progress.due > 0 ? "secondary" : "primary")}>
                  <Download className="size-4" /> Export to Anki (.apkg)
                </a>
              </>
            )}
          </div>
        </div>
      </div>

      {generating && <GeneratingBanner since={deck.updatedAt} model={deck.model} />}

      {isOwner && deck.status === "error" && deck.error && (
        <div className="mb-6 flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
            <div>
              <p className="font-semibold text-on-danger-soft">Generation failed</p>
              <p className="text-[13px] text-on-danger-soft/90">{deck.error}</p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => setMoreOpen(true)} loading={busy} className="self-start bg-card sm:self-auto">
            <RotateCcw className="size-4" /> Retry
          </Button>
        </div>
      )}

      {progress.total > 0 && <ProgressStrip progress={progress} deckId={deck.id} />}

      {/* Statistiche + visibilità */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total cards" value={cards.length} icon={<Layers className="size-[18px]" strokeWidth={1.75} />} />
        <StatTile label="Basic (Q/A)" value={counts.basic} icon={<SquareStack className="size-[18px]" strokeWidth={1.75} />} />
        <StatTile label="Cloze" value={counts.cloze} icon={<ListChecks className="size-[18px]" strokeWidth={1.75} />} />
        <StatTile label="Visibility" icon={deck.isPublic ? <Globe2 className="size-[18px] text-accent" strokeWidth={1.75} /> : <Lock className="size-[18px]" strokeWidth={1.75} />}>
          <div className="mt-1.5 flex items-center gap-2.5">
            {isOwner && <Switch checked={deck.isPublic} onChange={setVisibility} disabled={savingVisibility} label="Make deck public" />}
            <span className="font-serif text-[20px] font-semibold text-heading">{deck.isPublic ? "Public" : "Private"}</span>
          </div>
        </StatTile>
      </div>

      <div className={cn("grid grid-cols-1 gap-5", wide && "grid-cols-[minmax(0,1fr)_400px]")}>
        {/* Elenco card */}
        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-line bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-ink-muted">
                <span className="font-semibold text-ink">{cards.length} {cards.length === 1 ? "card" : "cards"}</span> · {counts.basic} question/answer · {counts.cloze} cloze
                {counts.mcq > 0 && ` · ${counts.mcq} quiz`}
                {counts.occlusion > 0 && ` · ${counts.occlusion} image occlusion`}
              </p>
              {isOwner && (
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setEditor({ mode: "new" })} disabled={generating}>
                    <Plus className="size-4" /> Add card
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => setMoreOpen(true)} disabled={generating || busy}>
                    <Sparkles className="size-3.5" /> Generate more
                  </Button>
                  <OverflowMenu>
                    {(close) => (
                      <>
                        <MenuItem icon={<Pencil className="size-4" />} onClick={() => { close(); setMetaOpen(true); }}>
                          Edit details
                        </MenuItem>
                        {cards.length > 0 && (
                          <MenuItem icon={<FileSpreadsheet className="size-4" />} href={csvHref} onClick={close}>
                            Export CSV
                          </MenuItem>
                        )}
                        <MenuItem icon={<Trash2 className="size-4" />} danger onClick={() => { close(); setDeleteDeckOpen(true); }}>
                          Delete deck
                        </MenuItem>
                      </>
                    )}
                  </OverflowMenu>
                </div>
              )}
            </div>
            {cards.length > 0 && (
              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="inline-flex rounded-md bg-sunken p-0.5">
                  {([
                    ["", `All (${cards.length})`],
                    ["basic", `Q/A (${counts.basic})`],
                    ["cloze", `Cloze (${counts.cloze})`],
                    ...(counts.mcq > 0 ? ([["mcq", `Quiz (${counts.mcq})`]] as const) : []),
                    ...(counts.occlusion > 0 ? ([["image_occlusion", `Image (${counts.occlusion})`]] as const) : []),
                  ] as const).map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setTypeFilter(v)}
                      className={cn(
                        "cursor-pointer rounded-[4px] px-3 py-1 text-xs font-semibold transition",
                        typeFilter === v ? "bg-card text-heading shadow-card" : "text-ink-muted hover:text-ink",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative sm:w-64">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter concepts or tags…" className="h-9 bg-sunken pl-9" aria-label="Search cards" />
                </div>
              </div>
            )}
          </div>

          {cards.length === 0 ? (
            generating ? (
              Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 animate-pulse rounded-lg bg-muted" />)
            ) : (
              <EmptyState
                icon={<Layers className="size-5" />}
                title="No cards in this deck"
                description={isOwner ? "Generate new cards from the materials or add them manually." : "This deck doesn’t have any cards yet."}
                action={
                  isOwner ? (
                    <Button onClick={() => setEditor({ mode: "new" })}>
                      <Plus className="size-4" /> Add card
                    </Button>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              {filtered.map((card) => (
                <CardRow
                  key={card.id}
                  card={card}
                  index={indexOf.get(card.id) ?? 0}
                  canEdit={isOwner}
                  active={editingId === card.id}
                  onEdit={() => setEditor({ mode: "edit", card })}
                  onDelete={() => setToDeleteCard(card)}
                />
              ))}
              {filtered.length === 0 && <p className="py-10 text-center text-sm text-ink-muted">No cards match the filters.</p>}
            </>
          )}
        </div>

        {/* Colonna laterale (schermi larghi) */}
        {wide && (
          <aside className="space-y-3 self-start xl:sticky xl:top-24">
            {isOwner ? (
              editor.mode === "closed" ? (
                <div className="rounded-lg border border-dashed border-line-strong bg-sunken p-6 text-center">
                  <Pencil className="mx-auto size-5 text-ink-faint" />
                  <p className="mt-2 font-serif text-lg font-semibold text-heading">Card editor</p>
                  <p className="mt-1 text-[13px] text-ink-muted">Click the pencil on a card to edit it here, or add a new one.</p>
                  <Button size="sm" className="mt-4" onClick={() => setEditor({ mode: "new" })} disabled={generating}>
                    <Plus className="size-4" /> New card
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-line bg-card p-5 shadow-raised">
                  <CardEditorForm key={editor.mode === "edit" ? editor.card.id : "new"} {...editorProps} />
                </div>
              )
            ) : (
              <div className="rounded-lg border border-line bg-sunken p-5">
                <p className="flex items-center gap-2 font-serif text-lg font-semibold text-heading">
                  <Globe2 className="size-[18px] text-accent" /> Shared deck
                </p>
                <p className="mt-1.5 text-[13px] text-ink-muted">
                  Shared by <span className="font-semibold text-ink">{deck.createdBy}</span>. You can study and export it; to edit it, save a private copy.
                </p>
                <Button variant="outline" size="sm" className="mt-4" onClick={copyToMine} loading={copying} disabled={generating}>
                  {!copying && <Copy className="size-4" />} Save a copy
                </Button>
              </div>
            )}
            {cards.length > 0 && (
              <a href={csvHref} download className="flex items-center justify-between rounded-lg border border-line bg-sunken px-4 py-3 text-[13px] hover:border-line-strong">
                <span className="flex items-center gap-2 font-medium text-ink">
                  <FileSpreadsheet className="size-4 text-ink-muted" /> CSV export
                </span>
                <span className="font-semibold text-accent">Download table (.csv)</span>
              </a>
            )}
          </aside>
        )}
      </div>

      {!wide && isOwner && <CardEditorModal open={editor.mode !== "closed"} {...editorProps} />}

      {aiStatus && <MoreCardsDialog open={moreOpen} onClose={() => setMoreOpen(false)} deck={deck} busy={busy} aiStatus={aiStatus} onSubmit={regenerate} />}
      {localGeneration.dialog}
      <DeckMetaDialog
        open={metaOpen}
        onClose={() => setMetaOpen(false)}
        deck={deck}
        onSaved={(d) => setDeck((prev) => ({ ...prev, title: d.title, subject: d.subject, description: d.description }))}
      />
      <ConfirmDialog
        open={toDeleteCard !== null}
        onClose={() => setToDeleteCard(null)}
        onConfirm={deleteCard}
        loading={busy}
        title="Delete this card?"
        description="The card will be permanently removed from the deck."
      />
      <ConfirmDialog
        open={deleteDeckOpen}
        onClose={() => setDeleteDeckOpen(false)}
        onConfirm={deleteDeck}
        loading={busy}
        title="Delete this deck?"
        description={
          <>
            <strong>{deck.title}</strong> and all of its {cards.length} cards will be permanently deleted, together with its study history in the calendar and its mind map.
          </>
        }
        confirmLabel="Delete deck"
      />
    </div>
  );
}

function MoreCardsDialog({
  open,
  onClose,
  deck,
  busy,
  aiStatus,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  deck: Deck;
  busy: boolean;
  aiStatus: AiStatus;
  onSubmit: (body: { cardCount: number; focus: string; provider: AiProvider }) => void;
}) {
  const [count, setCount] = useState(20);
  const [focus, setFocus] = useState("");
  const [provider, setProvider] = useState<AiProvider>(aiStatus.provider);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate more cards"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit({ cardCount: count, focus, provider })} loading={busy} disabled={!providerReady(aiStatus, provider)}>
            <Sparkles className="size-4" /> Generate {count} cards
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] text-ink-muted">
          {PROVIDER_INFO[provider].label} rereads the same materials ({deck.sources.length}) and avoids cards already in the deck.
        </p>
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="more-count" className="eyebrow text-ink-muted">
              How many cards to add
            </label>
            <span className="font-serif text-xl font-semibold text-heading tabular-nums">{count}</span>
          </div>
          <input id="more-count" type="range" min={5} max={100} step={5} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full cursor-pointer accent-[var(--c-primary)]" />
        </div>
        <div>
          <Label htmlFor="more-focus" hint="Optional">
            What to focus on
          </Label>
          <Textarea id="more-focus" rows={3} maxLength={1000} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="E.g. more cards on the pharmacology of diuretics" />
        </div>
        <div>
          <Label>AI engine</Label>
          <EnginePicker status={aiStatus} value={provider} onChange={setProvider} />
        </div>
      </div>
    </Modal>
  );
}

type DeckMetaProps = { open: boolean; onClose: () => void; deck: Deck; onSaved: (deck: Deck) => void };

// Il contenuto viene montato solo all'apertura, così lo stato parte sempre dai dati attuali.
function DeckMetaDialog(props: DeckMetaProps) {
  return props.open ? <DeckMetaDialogInner {...props} /> : null;
}

function DeckMetaDialogInner({ open, onClose, deck, onSaved }: DeckMetaProps) {
  const [title, setTitle] = useState(deck.title);
  const [subject, setSubject] = useState(deck.subject);
  const [description, setDescription] = useState(deck.description);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return toast.error("The title cannot be empty.");
    setSaving(true);
    try {
      const res = await api<{ deck: Deck }>(`/api/decks/${deck.id}`, {
        method: "PATCH",
        json: { title: title.trim(), subject, description: description.trim() },
      });
      onSaved(res.deck);
      toast.success("Details updated");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Deck details"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="meta-title">Title</Label>
          <Input id="meta-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
        </div>
        <div>
          <Label htmlFor="meta-subject">Subject</Label>
          <Select id="meta-subject" value={subject} onChange={(e) => setSubject(e.target.value)}>
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="meta-desc">Description</Label>
          <Textarea id="meta-desc" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <p className="text-xs text-ink-faint">
          In Anki the deck will be imported as <span className="font-semibold text-ink-muted">Medicine::{subject}::{title || "…"}</span>
        </p>
      </div>
    </Modal>
  );
}
