"use client";

import { ArrowRight, Bot, Check, CheckCircle2, FolderOpen, Hourglass, ImageIcon, Layers, ListChecks, NotebookPen, Search, SquareStack, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { GeminiKeyNotice } from "@/components/gemini-key-notice";
import { Button, EmptyState, Input, Label, PageHeader, Select, Textarea, buttonClass, cn } from "@/components/ui";
import { api } from "@/lib/client";
import { formatBytes, OCCLUSION_IMAGE_TYPES } from "@/lib/files";
import { SUBJECTS } from "@/lib/subjects";
import { subjectTone } from "@/lib/subjects-style";
import type { GenerationOptions, Material } from "@/lib/types";
import { useApiErrorToast } from "@/lib/use-api-error";

function Segmented<T extends string>({
  value,
  onChange,
  options,
  name,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; hint?: string; icon?: ReactNode }[];
  name: string;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-1 rounded-md bg-muted p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer rounded-[5px] px-2.5 py-2 text-center transition",
              active ? "bg-card shadow-card" : "hover:bg-muted-strong",
            )}
          >
            <span className={cn("flex items-center justify-center gap-1.5 text-[13px] font-semibold", active ? "text-heading" : "text-ink-muted")}>
              {o.icon}
              {o.label}
            </span>
            {o.hint && <span className={cn("mt-0.5 hidden text-[11px] sm:block", active ? "text-accent" : "text-ink-faint")}>{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Section({ step, title, aside, description, children }: { step: number; title: string; aside?: ReactNode; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-sunken p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-3 font-serif text-[20px] leading-7 font-semibold text-heading">
          <span className="grid size-6 place-items-center rounded-[4px] bg-primary font-sans text-xs font-bold text-on-primary">{step}</span>
          {title}
        </h2>
        {aside}
      </div>
      {description && <p className="mt-2 text-[13px] text-ink-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const PRESETS = [10, 20, 40, 60];

export function GenerateForm({
  materials,
  initialSelection,
  hasGeminiKey,
  model,
}: {
  materials: Material[];
  initialSelection: string[];
  hasGeminiKey: boolean;
  model: string;
}) {
  const router = useRouter();
  const showError = useApiErrorToast();
  const [selected, setSelected] = useState<string[]>(initialSelection);
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState<string>(materials.find((m) => m.id === initialSelection[0])?.subject ?? SUBJECTS[0]);
  const [subjectTouched, setSubjectTouched] = useState(false);
  const [cardCount, setCardCount] = useState(20);
  const [cardType, setCardType] = useState<GenerationOptions["cardType"]>("mixed");
  const [difficulty, setDifficulty] = useState<GenerationOptions["difficulty"]>("intermedio");
  const [language, setLanguage] = useState<GenerationOptions["language"]>("en");
  const [focus, setFocus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return materials;
    return materials.filter((m) => m.title.toLowerCase().includes(q) || m.subject.toLowerCase().includes(q) || m.filename.toLowerCase().includes(q));
  }, [materials, query]);

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
    if (next.length > 10) {
      toast.error("You can select up to 10 materials.");
      return;
    }
    setSelected(next);
    if (!subjectTouched && next.length > 0) {
      const first = byId.get(next[0]);
      if (first) setSubject(first.subject);
    }
  }

  const totalSize = selected.reduce((sum, id) => sum + (byId.get(id)?.sizeBytes ?? 0), 0);
  const isOcclusion = cardType === "image_occlusion";
  const selectedImages = selected.filter((id) => OCCLUSION_IMAGE_TYPES.includes(byId.get(id)?.mimeType ?? "")).length;
  const occlusionBlocked = isOcclusion && selectedImages === 0;
  const tone = subjectTone(subject);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      toast.error("Select at least one material.");
      return;
    }
    setSubmitting(true);
    try {
      const { id } = await api<{ id: string }>("/api/decks", {
        method: "POST",
        json: { materialIds: selected, title: title.trim(), subject, cardCount, cardType, difficulty, language, focus },
      });
      toast.success("Generation started: you can follow it on the deck page.");
      router.push(`/decks/${id}`);
    } catch (err) {
      showError(err);
      setSubmitting(false);
    }
  }

  if (materials.length === 0) {
    return (
      <div>
        <PageHeader eyebrow="New deck" title="Generate flashcards" description="Create an Anki deck from the course materials." />
        <EmptyState
          icon={<FolderOpen className="size-5" />}
          title="You need at least one material"
          description="Upload a PDF, some images or text notes first."
          action={
            <Link href="/materials" className={buttonClass()}>
              <Upload className="size-4" /> Go to materials
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <PageHeader eyebrow="New deck" title="Generate flashcards" description="Pick the materials and customise the deck: Gemini does the rest." />
      {!hasGeminiKey && <GeminiKeyNotice className="mb-6" />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Section
            step={1}
            title="Source materials"
            description="Up to 10 files. The more focused the material, the more precise the cards."
            aside={<span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">{selected.length} selected (max 10)</span>}
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search uploaded notes, handouts and slides…" className="pl-10" aria-label="Search materials" />
            </div>
            <ul className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
              {filtered.map((m) => {
                const active = selected.includes(m.id);
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      aria-pressed={active}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3.5 py-3 text-left transition",
                        active ? "border-primary" : "border-line hover:border-line-strong",
                      )}
                    >
                      <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[4px] border", active ? "border-heading bg-heading text-bg" : "border-line-strong")}>
                        {active && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-ink">{m.title}</span>
                        <span className="block truncate text-[11px] font-medium text-ink-muted">
                          {m.subject} · {m.filename}
                        </span>
                      </span>
                      <span className="rounded-[4px] bg-muted px-2 py-0.5 text-[11px] font-semibold text-ink-muted tabular-nums">{formatBytes(m.sizeBytes)}</span>
                      <CheckCircle2 className={cn("size-[18px] shrink-0", active ? "text-heading" : "text-transparent")} />
                    </button>
                  </li>
                );
              })}
              {filtered.length === 0 && <li className="py-6 text-center text-sm text-ink-muted">No results.</li>}
            </ul>
          </Section>

          <Section step={2} title="Flashcard type">
            <div className="space-y-5">
              <div>
                <Label>Study format</Label>
                <Segmented
                  name="Format"
                  value={cardType}
                  onChange={setCardType}
                  options={[
                    { value: "mixed", label: "Mixed", hint: "Q&A + cloze", icon: <Layers className="size-3.5" /> },
                    { value: "basic", label: "Q&A", hint: "Front and back", icon: <SquareStack className="size-3.5" /> },
                    { value: "cloze", label: "Cloze", hint: "Fill in the blanks", icon: <ListChecks className="size-3.5" /> },
                    { value: "image_occlusion", label: "Image", hint: "Masks on images", icon: <ImageIcon className="size-3.5" /> },
                  ]}
                />
                {isOcclusion && (
                  <p className={cn("mt-2 rounded-md px-3 py-2 text-xs", occlusionBlocked ? "bg-warning-soft text-warning" : "bg-primary-soft text-accent")}>
                    {occlusionBlocked
                      ? "Image occlusion uses the images among your materials (PNG, JPG or WEBP): select at least one."
                      : `Gemini will mask the labels and structures on ${selectedImages} ${selectedImages === 1 ? "image" : "images"}; other materials are ignored. Requires Anki 23.10 or newer.`}
                  </p>
                )}
              </div>
              <div className={cn(isOcclusion && "hidden")}>
                <Label>Depth level</Label>
                <Segmented
                  name="Level"
                  value={difficulty}
                  onChange={setDifficulty}
                  options={[
                    { value: "base", label: "Basic", hint: "Key concepts" },
                    { value: "intermedio", label: "Intermediate", hint: "Exam level" },
                    { value: "avanzato", label: "Advanced", hint: "Clinical details" },
                  ]}
                />
              </div>
              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <label htmlFor="count" className="eyebrow text-ink-muted">
                    {isOcclusion ? "Maximum masks (in total)" : "Number of flashcards"}
                  </label>
                  <span className="text-[13px] text-ink-muted">
                    <span className="font-serif text-[22px] font-semibold text-heading tabular-nums">{cardCount}</span> cards
                  </span>
                </div>
                <input
                  id="count"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={cardCount}
                  onChange={(e) => setCardCount(Number(e.target.value))}
                  className="w-full cursor-pointer accent-[var(--c-primary)]"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setCardCount(n)}
                      className={cn(
                        "min-w-10 cursor-pointer rounded-[4px] px-2.5 py-1 text-xs font-semibold transition",
                        cardCount === n ? "bg-primary text-on-primary" : "bg-muted text-ink-muted hover:bg-muted-strong",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section step={3} title="Additional instructions" aside={<span className="text-xs text-ink-faint">Optional</span>}>
            <Textarea
              value={focus}
              onChange={(e) => setFocus(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="E.g. focus on the cardiac cycle and pressure-volume loops; skip the historical introduction."
            />
          </Section>
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-lg border border-line bg-card p-5 shadow-raised sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
                <NotebookPen className="size-5 text-ink-muted" strokeWidth={1.75} /> Deck sheet
              </h2>
              <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">Setting up</span>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <Label htmlFor="title" hint="optional">
                  Deck title
                </Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Suggested by AI" className="bg-sunken" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div>
                  <Label htmlFor="subject">Subject</Label>
                  <div className="relative">
                    <span className={cn("pointer-events-none absolute top-1/2 left-3 size-2 -translate-y-1/2 rounded-full", tone.dot)} />
                    <Select
                      id="subject"
                      value={subject}
                      className="bg-sunken pl-7"
                      onChange={(e) => {
                        setSubject(e.target.value);
                        setSubjectTouched(true);
                      }}
                    >
                      {SUBJECTS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div>
                  <Label>Card language</Label>
                  <Segmented
                    name="Language"
                    value={language}
                    onChange={setLanguage}
                    options={[
                      { value: "en", label: "English" },
                      { value: "it", label: "Italiano" },
                    ]}
                  />
                </div>
              </div>

              <div className="rounded-md bg-sunken p-3.5">
                <div className="flex items-center justify-between">
                  <span className="eyebrow text-ink-muted">Selected materials</span>
                  <span className="text-xs text-ink-muted">{formatBytes(totalSize)} total</span>
                </div>
                {selected.length === 0 ? (
                  <p className="mt-2 text-[13px] text-ink-faint">No material selected.</p>
                ) : (
                  <ul className="mt-2.5 flex flex-wrap gap-1.5">
                    {selected.map((id) => {
                      const m = byId.get(id);
                      if (!m) return null;
                      return (
                        <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-card py-0.5 pr-1 pl-2.5 text-xs font-medium text-ink">
                          <span className="truncate">{m.title.length > 26 ? `${m.title.slice(0, 26)}…` : m.title}</span>
                          <button type="button" onClick={() => toggle(id)} className="grid size-5 cursor-pointer place-items-center rounded-full text-ink-faint hover:bg-muted hover:text-ink" aria-label={`Remove ${m.title}`}>
                            <X className="size-3" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="flex items-start gap-3 rounded-md border border-line p-3">
                <Bot className="mt-0.5 size-5 shrink-0 text-ink-muted" strokeWidth={1.75} />
                <div className="min-w-0 text-xs">
                  <p className="font-semibold text-ink">
                    Google Gemini <span className="font-normal text-ink-muted">({model})</span>
                  </p>
                  <p className={hasGeminiKey ? "text-ink-muted" : "text-warning"}>
                    {hasGeminiKey ? "Connected with your personal key" : "Personal key not configured"}
                  </p>
                </div>
              </div>

              <Button type="submit" size="lg" className="w-full" loading={submitting} disabled={selected.length === 0 || !hasGeminiKey || occlusionBlocked}>
                {isOcclusion ? "Generate image occlusion" : `Generate ${cardCount} flashcards`} {!submitting && <ArrowRight className="size-4" />}
              </Button>
              <p className="flex items-start gap-2 text-xs text-ink-muted">
                <Hourglass className="mt-0.5 size-3.5 shrink-0" />
                Generation usually takes from 20 seconds to a couple of minutes. The deck will be private: you can make it public later.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line bg-sunken px-4 py-3 text-xs">
            <span className="flex items-center gap-2 font-medium text-ink">
              <CheckCircle2 className="size-4 text-accent" /> Anki-compatible package (.apkg)
            </span>
            <span className="font-semibold text-accent">Anki 2.1+</span>
          </div>
        </div>
      </div>
    </form>
  );
}
