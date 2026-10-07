import { ArrowRight, BookOpenCheck, CalendarDays, CheckCircle2, Flame, Play, Route, Download, FileUp, FolderOpen, GalleryVerticalEnd, Layers, LayoutGrid, Sparkles, Upload, Zap } from "lucide-react";
import Link from "next/link";
import { DeckCard } from "@/components/deck-card";
import { FileIcon, fileKind } from "@/components/file-icon";
import { RelativeTime } from "@/components/relative-time";
import { buttonClass } from "@/components/styles";
import { EmptyState, SectionTitle, SubjectBadge } from "@/components/ui";
import { getCurrentUser } from "@/lib/current-user";
import { formatBytes } from "@/lib/files";
import { listDecks, listMaterials, stats } from "@/lib/repo";
import { buildPlan } from "@/lib/study";

export const dynamic = "force-dynamic";

function SeeAll({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent hover:underline">
      {children} <ArrowRight className="size-3.5" />
    </Link>
  );
}

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const [totals, myDecks, publicDecks, materials, plan] = await Promise.all([
    stats(user.id),
    listDecks(user.id, "mine"),
    listDecks(user.id, "public"),
    listMaterials(),
    buildPlan(user.id),
  ]);
  const planCounts = { review: 0, fresh: 0 };
  for (const it of plan.items) {
    if (it.stage === "new") planCounts.fresh++;
    else planCounts.review++;
  }
  const planMinutes = Math.max(1, Math.round(((planCounts.review + planCounts.fresh * 2.5) * plan.adaptation.avgSeconds) / 60));
  const firstName = user.name.split(" ")[0];

  const tiles = [
    { label: "Class materials", value: totals.materials, unit: "shared files", link: "Manage materials", icon: FolderOpen, href: "/materials" },
    { label: "Your decks", value: totals.decks, unit: "personal decks", link: "Browse decks", icon: GalleryVerticalEnd, href: "/decks" },
    { label: "Your flashcards", value: totals.cards, unit: "cards generated", link: "Export to Anki", icon: Layers, href: "/decks" },
  ];

  const steps = [
    {
      icon: FileUp,
      title: "Upload materials",
      text: "PDF slides, handouts, photos of notes or text files, shared in the class library.",
      foot: "PDF, images and text",
      footIcon: CheckCircle2,
    },
    {
      icon: Sparkles,
      title: "Generate flashcards",
      text: "The AI extracts the high-yield concepts and writes questions and clozes based only on your material.",
      foot: "Free local AI, or Gemini, Claude, OpenAI",
      footIcon: Zap,
    },
    {
      icon: BookOpenCheck,
      title: "Study with Anki",
      text: "Review and fix the cards, study them in the browser and export the deck ready to import into Anki.",
      foot: "One-click .apkg export",
      footIcon: Download,
    },
  ];

  return (
    <div className="flex flex-col gap-9">
      <section className="relative overflow-hidden rounded-lg border border-line bg-card p-6 shadow-card sm:p-9">
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 size-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="eyebrow flex flex-wrap items-center gap-2 text-accent">
              Digital medical notebook <span className="text-ink-faint/50">/</span>
              <span className="font-semibold tracking-normal text-ink-muted normal-case">Class archive</span>
            </p>
            <p className="mt-2 font-serif text-lg text-ink-muted italic">Hi {firstName},</p>
            <h1 className="mt-1 font-serif text-[28px] leading-9 font-semibold tracking-[-0.02em] text-heading sm:text-[36px] sm:leading-[44px]">
              Turn lectures into flashcards in seconds.
            </h1>
            <p className="mt-3 text-ink-muted">
              Upload course handouts and slides, let the AI extract the key concepts and take the cards straight to Anki.
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:w-auto sm:flex-row">
            <Link href="/generate" className={buttonClass("primary", "lg")}>
              <Zap className="size-[18px]" /> Generate flashcards
            </Link>
            <Link href="/materials" className={buttonClass("secondary", "lg")}>
              <Upload className="size-[18px]" /> Upload materials
            </Link>
          </div>
        </div>
      </section>

      {plan.decks.length > 0 && (
        <section className="flex flex-col gap-4 rounded-lg border border-primary/40 bg-primary-soft p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-md bg-primary text-on-primary">
              <Route className="size-5" />
            </span>
            <div>
              <p className="eyebrow text-accent">Today&apos;s path{plan.restDay ? " · rest day" : ""}</p>
              {plan.items.length > 0 ? (
                <p className="mt-0.5 font-serif text-[22px] leading-7 font-semibold text-heading">
                  {planCounts.review} reviews · {planCounts.fresh} new cards · ~{planMinutes} min
                </p>
              ) : (
                <p className="mt-0.5 font-serif text-[22px] leading-7 font-semibold text-heading">
                  {plan.done.reviews > 0 ? "Done for today. See you tomorrow!" : "Nothing due today."}
                </p>
              )}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-muted">
                {plan.streak > 0 && (
                  <span className="flex items-center gap-1">
                    <Flame className="size-3.5 text-accent" /> {plan.streak}-day streak
                  </span>
                )}
                <span>Spaced repetition, starting easy and adding new material gradually.</span>
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            {plan.items.length > 0 && (
              <Link href="/today" className={buttonClass("primary", "lg")}>
                <Play className="size-[18px]" /> Start
              </Link>
            )}
            <Link href="/plan" className={buttonClass("secondary", "lg")}>
              <CalendarDays className="size-[18px]" /> Calendar
            </Link>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {tiles.map(({ label, value, unit, link, icon: Icon, href }) => (
          <Link key={label} href={href} className="group flex flex-col rounded-lg border border-line bg-card p-5 shadow-card transition hover:border-primary">
            <div className="flex items-center justify-between">
              <span className="eyebrow text-ink-muted">{label}</span>
              <span className="grid size-8 place-items-center rounded-md border border-line bg-sunken text-primary transition-transform group-hover:scale-105">
                <Icon className="size-4" strokeWidth={1.75} />
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="font-serif text-[40px] leading-[44px] font-semibold text-heading tabular-nums">{value.toLocaleString("en-GB")}</span>
              <span className="text-[13px] text-ink-muted">{unit}</span>
            </div>
            <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-accent">
              {link} <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>

      <section>
        <SectionTitle eyebrow="Study method" title="How Ankix works" aside={<span className="hidden text-[13px] text-ink-muted sm:block">From material to deck in three steps</span>} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {steps.map(({ icon: Icon, title, text, foot, footIcon: FootIcon }, i) => (
            <div key={title} className="flex flex-col rounded-lg border border-line bg-sunken p-5">
              <div className="flex items-center justify-between">
                <span className="grid size-8 place-items-center rounded-md bg-primary text-xs font-bold text-on-primary">0{i + 1}</span>
                <Icon className="size-5 text-ink-faint" strokeWidth={1.75} />
              </div>
              <h3 className="mt-3 font-serif text-[19px] leading-7 font-semibold text-heading">{title}</h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-muted">{text}</p>
              <p className="mt-4 flex items-center gap-1.5 text-[12px] font-semibold text-accent">
                <FootIcon className="size-3.5" /> {foot}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle title={<span className="flex items-center gap-2"><LayoutGrid className="size-5 text-ink-muted" strokeWidth={1.75} /> Your recent decks</span>} aside={myDecks.length > 0 && <SeeAll href="/decks">See all</SeeAll>} />
        {myDecks.length === 0 ? (
          <EmptyState
            icon={<GalleryVerticalEnd className="size-5" />}
            title="No decks yet"
            description="Pick a material and generate your first deck. It stays private until you decide to share it."
            action={
              <Link href="/generate" className={buttonClass()}>
                <Sparkles className="size-4" /> Generate your first deck
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {myDecks.slice(0, 4).map((deck) => (
              <DeckCard key={deck.id} deck={deck} />
            ))}
          </div>
        )}
      </section>

      {publicDecks.length > 0 && (
        <section>
          <SectionTitle eyebrow="From the class" title="Recently shared decks" aside={<SeeAll href="/decks?view=public">See all</SeeAll>} />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {publicDecks.slice(0, 2).map((deck) => (
              <DeckCard key={deck.id} deck={deck} showOwner />
            ))}
          </div>
        </section>
      )}

      {materials.length > 0 && (
        <section>
          <SectionTitle title={<span className="flex items-center gap-2"><FolderOpen className="size-5 text-ink-muted" strokeWidth={1.75} /> Latest materials</span>} aside={<SeeAll href="/materials">See all materials</SeeAll>} />
          <div className="overflow-hidden rounded-lg border border-line bg-card shadow-card">
            <div className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_90px] gap-4 border-b border-line bg-sunken px-5 py-2.5 md:grid">
              {["Document title", "Subject", "Details", "Author", "Date"].map((h, i) => (
                <span key={h} className={`eyebrow text-ink-muted ${i === 4 ? "text-right" : ""}`}>{h}</span>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {materials.slice(0, 5).map((m) => (
                <li key={m.id} className="grid grid-cols-1 gap-2 px-5 py-3 md:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_90px] md:items-center md:gap-4">
                  <span className="flex min-w-0 items-center gap-3">
                    <FileIcon mimeType={m.mimeType} className="size-7" />
                    <span className="truncate font-medium text-ink">{m.title}</span>
                  </span>
                  <span><SubjectBadge subject={m.subject} /></span>
                  <span className="text-[13px] text-ink-muted">{fileKind(m.mimeType)} · {formatBytes(m.sizeBytes)}</span>
                  <span className="truncate text-[13px] text-ink-muted">{m.uploadedBy}</span>
                  <span className="text-[13px] text-ink-muted md:text-right"><RelativeTime ms={m.createdAt} /></span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
