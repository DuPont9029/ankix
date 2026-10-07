"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Check,
  Cpu,
  Download,
  Dumbbell,
  Eye,
  GitBranch,
  HelpCircle,
  Network,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EnginePicker } from "@/components/ai/engine-picker";
import { ModelProgress, useLocalModelStatus } from "@/components/ai/local-model";
import { ConceptMapCanvas, type ConceptSelection, type Practice } from "@/components/mindmap/concept-canvas";
import { MindMapCanvas } from "@/components/mindmap/map-canvas";
import type { SurfaceHandle } from "@/components/mindmap/surface";
import { Button, Input, Label, Modal, Select, Spinner, SubjectBadge, Textarea, buttonClass, cn } from "@/components/ui";
import { AbortedError } from "@/lib/ai/local/engine";
import { generateConceptMapLocally, generateMindMapLocally } from "@/lib/ai/local/mindmap";
import { LOCAL_MODEL_LABEL, providerReady, type AiProvider, type AiStatus } from "@/lib/ai/providers";
import { api } from "@/lib/client";
import { answerMatches, propositionText, type Concept, type ConceptMapData, type Proposition } from "@/lib/conceptmap";
import { plainText } from "@/lib/items";
import { autoMap, childrenMap, type MapNode, type MindMap } from "@/lib/mindmap";
import type { Card, Deck } from "@/lib/types";
import { useApiErrorToast } from "@/lib/use-api-error";

type Tab = "mind" | "concept";
type Engine = AiProvider | "auto";
type Generating = { kind: "server"; label: string } | { kind: "local"; label: string; text: string; stopping: boolean } | { kind: "error"; message: string };
type PracticeMode = "links" | "concepts" | "both";

function freshId(prefix: string, taken: { id: string }[]) {
  let i = taken.length + 1;
  while (taken.some((t) => t.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

function sample<T>(list: T[], n: number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function stripPositions<T extends { x?: number; y?: number }>(list: T[]): T[] {
  return list.map((item) => {
    const copy = { ...item };
    delete copy.x;
    delete copy.y;
    return copy;
  });
}

export function MapView({ deck, cards, initialMap, aiStatus }: { deck: Deck; cards: Card[]; initialMap: MindMap | null; aiStatus: AiStatus }) {
  const showError = useApiErrorToast();
  const surface = useRef<SurfaceHandle>(null);
  const [map, setMap] = useState(initialMap);
  const [mind, setMind] = useState<MapNode[] | null>(initialMap?.nodes.length ? initialMap.nodes : null);
  const [concept, setConcept] = useState<ConceptMapData | null>(initialMap?.concept ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>(initialMap?.concept ? "concept" : "mind");
  const [mindSel, setMindSel] = useState<string | null>(null);
  const [conceptSel, setConceptSel] = useState<ConceptSelection>(null);
  const [practice, setPractice] = useState<(Practice & { mode: PracticeMode }) | null>(null);
  const [picker, setPicker] = useState<Tab | "both" | null>(null);
  const [engine, setEngine] = useState<Engine>(providerReady(aiStatus, aiStatus.provider) ? aiStatus.provider : "auto");
  const [generating, setGenerating] = useState<Generating | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const modelStatus = useLocalModelStatus();
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const editMind = (fn: (nodes: MapNode[]) => MapNode[]) => {
    setMind((m) => (m ? fn(m) : m));
    setDirty(true);
  };
  const editConcept = (fn: (c: ConceptMapData) => ConceptMapData) => {
    setConcept((c) => (c ? fn(c) : c));
    setDirty(true);
  };

  function apply(m: MindMap) {
    setMap(m);
    setMind(m.nodes.length ? m.nodes : null);
    setConcept(m.concept);
    setDirty(false);
    setMindSel(null);
    setConceptSel(null);
    setPractice(null);
  }

  async function put(body: { model?: string; nodes: MapNode[]; concept: ConceptMapData | null }) {
    const res = await api<{ map: MindMap }>(`/api/decks/${deck.id}/map`, {
      method: "PUT",
      json: { title: map?.title ?? deck.title, links: [], ...body },
    });
    return res.map;
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await put({ nodes: mind ?? autoMap(deck.title, cards).nodes, concept });
      setMap(saved);
      setDirty(false);
      toast.success("Saved");
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  }

  async function generate(kind: Tab | "both") {
    setPicker(null);
    if (engine === "local") {
      const controller = new AbortController();
      abortRef.current = controller;
      const onText = (chunk: string) => setGenerating((g) => (g?.kind === "local" ? { ...g, text: (g.text + chunk).slice(-2000) } : g));
      try {
        let nodes = mind;
        let cmap = concept;
        if (kind !== "concept") {
          setGenerating({ kind: "local", label: "Building the mind map…", text: "", stopping: false });
          nodes = (await generateMindMapLocally(deck, cards, { signal: controller.signal, onText })).nodes;
        }
        if (kind !== "mind") {
          setGenerating({ kind: "local", label: "Building the concept map…", text: "", stopping: false });
          cmap = await generateConceptMapLocally(deck, cards, { signal: controller.signal, onText });
        }
        apply(await put({ model: LOCAL_MODEL_LABEL, nodes: nodes ?? autoMap(deck.title, cards).nodes, concept: cmap }));
        setGenerating(null);
        if (kind !== "both") setTab(kind);
      } catch (err) {
        if (err instanceof AbortedError) setGenerating(null);
        else setGenerating({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        abortRef.current = null;
      }
      return;
    }
    setGenerating({
      kind: "server",
      label: engine === "auto" ? "Building the mind map from the tags…" : kind === "mind" ? "The AI is organising the topics…" : "The AI is finding the concepts and how they are related…",
    });
    try {
      const res = await api<{ map: MindMap }>(`/api/decks/${deck.id}/map`, { method: "POST", json: { provider: engine, kind } });
      apply(res.map);
      setGenerating(null);
      if (kind !== "both") setTab(kind);
    } catch (err) {
      setGenerating(null);
      showError(err);
    }
  }

  function exportSvg() {
    const svg = surface.current?.exportSvg();
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(map?.title ?? deck.title).replace(/[^\w\- ]+/g, "").trim() || "map"} - ${tab === "mind" ? "mind map" : "concept map"}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function startPractice(mode: PracticeMode) {
    if (!concept) return;
    const links = mode === "concepts" ? [] : sample(concept.propositions, Math.min(15, Math.max(1, Math.round(concept.propositions.length * 0.4))));
    const specific = concept.concepts.filter((c) => c.level > 0);
    const nodes = mode === "links" ? [] : sample(specific, Math.min(8, Math.max(1, Math.round(specific.length * 0.3))));
    setPractice({ mode, hidden: new Set([...links.map((p) => p.id), ...nodes.map((c) => c.id)]), results: {} });
    setConceptSel(null);
  }

  // ---------- finestre ----------

  const pickerDialog = (
    <Modal
      open={picker !== null}
      onClose={() => setPicker(null)}
      title={picker === "concept" ? "Generate the concept map" : picker === "mind" ? "Generate the mind map" : "Generate the maps"}
      footer={
        <>
          <Button variant="secondary" onClick={() => setPicker(null)}>
            Cancel
          </Button>
          <Button onClick={() => picker && generate(picker)} disabled={picker === "concept" && engine === "auto"}>
            <Sparkles className="size-4" /> Generate
          </Button>
        </>
      }
    >
      <EngineChoice aiStatus={aiStatus} value={engine} onChange={setEngine} allowAuto={picker !== "concept"} />
      {picker && (picker === "mind" ? mind : picker === "concept" ? concept : mind || concept) && (
        <p className="mt-3 text-[12px] text-ink-faint">The current {picker === "both" ? "maps" : "map"} and your changes will be replaced.</p>
      )}
    </Modal>
  );

  const progressDialog = (
    <Modal
      open={generating !== null}
      onClose={() => (generating?.kind === "error" ? setGenerating(null) : undefined)}
      title={
        <span className="flex items-center gap-2">
          {generating?.kind === "local" ? <Cpu className="size-5 text-ink-muted" /> : <Network className="size-5 text-ink-muted" />}
          {generating?.kind === "local" ? LOCAL_MODEL_LABEL : "Maps"}
        </span>
      }
      size="lg"
      footer={
        generating?.kind === "local" ? (
          <Button
            variant="secondary"
            loading={generating.stopping}
            onClick={() => {
              abortRef.current?.abort();
              setGenerating((g) => (g?.kind === "local" ? { ...g, stopping: true } : g));
            }}
          >
            {!generating.stopping && <Square className="size-3.5" />} Stop
          </Button>
        ) : generating?.kind === "error" ? (
          <Button variant="secondary" onClick={() => setGenerating(null)}>
            Close
          </Button>
        ) : undefined
      }
    >
      {generating?.kind === "server" && (
        <p className="flex items-center gap-3 text-sm text-ink">
          <Spinner className="size-5 shrink-0" /> {generating.label}
        </p>
      )}
      {generating?.kind === "local" && (
        <div className="space-y-4">
          <p className="flex items-center gap-3 text-sm font-semibold text-heading">
            <Spinner className="size-5 shrink-0 text-accent" /> {generating.label}
          </p>
          <ModelProgress status={modelStatus} />
          {generating.text && (
            <pre className="max-h-56 overflow-y-auto rounded-md border border-line bg-sunken p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
              {generating.text}
            </pre>
          )}
          <p className="text-xs text-ink-faint">Everything runs on this device. With many cards only the first ones fit in the local model.</p>
        </div>
      )}
      {generating?.kind === "error" && (
        <p className="flex gap-2 rounded-md bg-danger-soft px-3.5 py-2.5 text-sm text-on-danger-soft">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {generating.message}
        </p>
      )}
    </Modal>
  );

  const current = tab === "mind" ? mind : concept;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <Link href={`/decks/${deck.id}`} className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4 shrink-0" /> <span className="truncate">{deck.title}</span>
          </Link>
          <h1 className="mt-1 font-serif text-[28px] leading-9 font-semibold text-heading sm:text-[32px]">{map?.title || deck.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
            <SubjectBadge subject={deck.subject} />
            {map && <span>{map.model}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Map type" className="inline-flex rounded-md border border-line bg-sunken p-0.5">
            {(
              [
                ["mind", "Mind map", GitBranch],
                ["concept", "Concept map", Network],
              ] as const
            ).map(([t, label, Icon]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  setPractice(null);
                }}
                className={cn(
                  "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-[13px] font-semibold transition",
                  tab === t ? "bg-card text-heading shadow-card" : "text-ink-muted hover:text-ink",
                )}
              >
                <Icon className="size-4" /> {label}
              </button>
            ))}
          </div>
          {current && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setPicker(tab)}>
                <Sparkles className="size-4" /> Regenerate
              </Button>
              <Button variant="secondary" size="sm" onClick={exportSvg}>
                <Download className="size-4" /> SVG
              </Button>
            </>
          )}
          {(mind || concept) && (
            <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
              {!saving && <Save className="size-4" />} Save
            </Button>
          )}
        </div>
      </div>

      {cards.length === 0 ? (
        <Intro tab={tab} cards={0} />
      ) : tab === "mind" ? (
        mind ? (
          <Layout
            canvas={<MindMapCanvas ref={surface} nodes={mind} selected={mindSel} onSelect={setMindSel} className="h-[62vh] min-h-[420px] lg:h-[calc(100dvh-230px)]" />}
            hint="Drag to move · scroll to zoom · click a branch"
            panel={
              <MindPanel
                nodes={mind}
                selected={mindSel}
                onSelect={setMindSel}
                edit={editMind}
                deckId={deck.id}
                cardById={cardById}
                autoModel={Boolean(map?.model.startsWith("Automatic"))}
              />
            }
          />
        ) : (
          <Intro tab="mind" cards={cards.length}>
            <EngineChoice aiStatus={aiStatus} value={engine} onChange={setEngine} allowAuto />
            <Button className="mt-4 w-full" onClick={() => generate(concept ? "mind" : "both")}>
              <Sparkles className="size-4" /> {concept ? "Create the mind map" : "Create the maps"}
            </Button>
          </Intro>
        )
      ) : concept ? (
        <>
          <div className="mb-3 flex flex-col gap-2 rounded-lg border border-line bg-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex min-w-0 items-start gap-2 text-[14px] text-ink">
              <HelpCircle className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <span className="eyebrow mr-2 text-ink-muted">Focus question</span>
                <span className="font-serif text-[16px] italic">{concept.focus || "—"}</span>
              </span>
            </p>
            {practice ? (
              <PracticeBar practice={practice} onRestart={() => startPractice(practice.mode)} onEnd={() => setPractice(null)} />
            ) : (
              <div className="flex shrink-0 items-center gap-1.5">
                <Dumbbell className="size-4 text-ink-muted" />
                <span className="text-[12px] font-semibold text-ink-muted">Practice:</span>
                <Button variant="outline" size="sm" onClick={() => startPractice("links")}>
                  Linking words
                </Button>
                <Button variant="outline" size="sm" onClick={() => startPractice("concepts")}>
                  Concepts
                </Button>
                <Button variant="outline" size="sm" onClick={() => startPractice("both")}>
                  Both
                </Button>
              </div>
            )}
          </div>
          <Layout
            canvas={
              <ConceptMapCanvas
                ref={surface}
                data={concept}
                selected={conceptSel}
                onSelect={setConceptSel}
                practice={practice}
                onMove={(id, all) => editConcept((c) => ({ ...c, concepts: c.concepts.map((n) => ({ ...n, ...(all.get(n.id) ?? {}) })) }))}
                className="h-[58vh] min-h-[420px] lg:h-[calc(100dvh-290px)]"
              />
            }
            hint={practice ? "Click a ? to answer" : "Read each arrow as a sentence · drag concepts to arrange them"}
            corner={
              !practice &&
              concept.concepts.some((c) => c.x !== undefined) && (
                <Button variant="secondary" size="sm" onClick={() => editConcept((c) => ({ ...c, concepts: stripPositions(c.concepts) }))}>
                  <RotateCcw className="size-3.5" /> Auto layout
                </Button>
              )
            }
            panel={
              practice ? (
                <PracticePanel
                  key={conceptSel?.id ?? "none"}
                  data={concept}
                  practice={practice}
                  selected={conceptSel}
                  onSelect={setConceptSel}
                  onResult={(id, r) => setPractice((p) => (p ? { ...p, results: { ...p.results, [id]: r } } : p))}
                />
              ) : (
                <ConceptPanel data={concept} selected={conceptSel} onSelect={setConceptSel} edit={editConcept} deckId={deck.id} cardById={cardById} />
              )
            }
          />
        </>
      ) : (
        <Intro tab="concept" cards={cards.length}>
          <EngineChoice aiStatus={aiStatus} value={engine} onChange={setEngine} allowAuto={false} />
          <Button className="mt-4 w-full" onClick={() => generate(mind ? "concept" : "both")} disabled={engine === "auto"}>
            <Sparkles className="size-4" /> {mind ? "Create the concept map" : "Create the maps"}
          </Button>
        </Intro>
      )}
      {pickerDialog}
      {progressDialog}
    </div>
  );
}

// ---------- impaginazione ----------

function Layout({ canvas, panel, hint, corner }: { canvas: ReactNode; panel: ReactNode; hint: string; corner?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="relative">
        {canvas}
        <span className="pointer-events-none absolute top-3 left-3 rounded-full border border-line bg-card/90 px-2.5 py-1 text-[11px] text-ink-muted shadow-card">{hint}</span>
        {corner && <div className="absolute top-3 right-3">{corner}</div>}
      </div>
      <aside className="rounded-lg border border-line bg-card p-4 shadow-card lg:max-h-[calc(100dvh-230px)] lg:overflow-y-auto">{panel}</aside>
    </div>
  );
}

function Intro({ tab, cards, children }: { tab: Tab; cards: number; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-6 rounded-lg border border-line bg-card p-6 shadow-card sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div>
        <span className="grid size-11 place-items-center rounded-md border border-line bg-sunken text-primary">
          {tab === "mind" ? <GitBranch className="size-5" /> : <Network className="size-5" />}
        </span>
        {tab === "mind" ? (
          <>
            <h2 className="mt-4 font-serif text-[24px] font-semibold text-heading">Mind map</h2>
            <p className="mt-2 text-ink-muted">
              The topic at the centre, the main themes around it and the details on the branches: a radial overview to see the whole deck at a glance and
              revise its structure.
            </p>
          </>
        ) : (
          <>
            <h2 className="mt-4 font-serif text-[24px] font-semibold text-heading">Concept map</h2>
            <p className="mt-2 text-ink-muted">
              Concepts linked by arrows with <span className="font-semibold text-ink">linking words</span>, so that every link reads as a sentence (
              <span className="italic">Meiosis → produces → haploid cells</span>). It goes from the most general concepts at the top to the most specific
              ones, answers a <span className="font-semibold text-ink">focus question</span> and shows cross-links between different areas.
            </p>
            <ul className="mt-4 space-y-1.5 text-[13px] text-ink-muted">
              <li>• Every proposition is listed and editable, with the cards that test it</li>
              <li>• Practice mode hides linking words or concepts for you to fill in</li>
            </ul>
          </>
        )}
      </div>
      <div className="rounded-lg border border-line bg-sunken p-4">{cards === 0 ? <p className="text-sm text-ink-muted">This deck has no cards yet.</p> : children}</div>
    </div>
  );
}

function EngineChoice({ aiStatus, value, onChange, allowAuto }: { aiStatus: AiStatus; value: Engine; onChange: (v: Engine) => void; allowAuto: boolean }) {
  return (
    <div className="space-y-1.5">
      <p className="eyebrow mb-2 text-ink-muted">How to build it</p>
      {allowAuto ? (
        <button
          type="button"
          role="radio"
          aria-checked={value === "auto"}
          onClick={() => onChange("auto")}
          className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2.5 text-left transition hover:border-line-strong",
            value === "auto" ? "border-primary" : "border-line",
          )}
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-ink-muted">
            <Tags className="size-4" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-ink">Quick mind map from tags</span>
            <span className="block text-[12px] text-ink-muted">Instant, no AI: branches are the card tags</span>
          </span>
        </button>
      ) : (
        <p className="mb-2 text-[12px] text-ink-muted">A concept map needs an AI: the relations between concepts cannot be derived from the tags.</p>
      )}
      <EnginePicker status={aiStatus} value={value === "auto" ? ("" as AiProvider) : value} onChange={onChange} />
    </div>
  );
}

function CardList({ ids, cardById, deckId }: { ids: string[]; cardById: Map<string, Card>; deckId: string }) {
  if (ids.length === 0) return <p className="text-[12px] text-ink-faint">No card is linked.</p>;
  return (
    <>
      <ul className="space-y-1.5">
        {ids.slice(0, 10).map((id) => {
          const c = cardById.get(id);
          if (!c) return null;
          return (
            <li key={id} className="line-clamp-3 rounded-md border border-line bg-sunken px-2.5 py-1.5 text-[12px] leading-4 text-ink">
              {plainText(c.type === "image_occlusion" ? c.front || "Image occlusion" : c.front)}
            </li>
          );
        })}
      </ul>
      {ids.length > 10 && <p className="mt-1 text-[11px] text-ink-faint">and {ids.length - 10} more</p>}
      <Link href={`/decks/${deckId}/study?cards=${ids.join(",")}`} className={buttonClass("primary", "sm", "mt-2 w-full")}>
        <BookOpen className="size-4" /> Study these {ids.length} cards
      </Link>
    </>
  );
}

function PanelHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <p className="eyebrow text-accent">{title}</p>
      <button type="button" onClick={onClose} className="grid size-7 cursor-pointer place-items-center rounded-md text-ink-faint hover:bg-muted hover:text-ink" aria-label="Close">
        <X className="size-4" />
      </button>
    </div>
  );
}

// ---------- mappa mentale ----------

function MindPanel({
  nodes,
  selected,
  onSelect,
  edit,
  deckId,
  cardById,
  autoModel,
}: {
  nodes: MapNode[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  edit: (fn: (nodes: MapNode[]) => MapNode[]) => void;
  deckId: string;
  cardById: Map<string, Card>;
  autoModel: boolean;
}) {
  const node = nodes.find((n) => n.id === selected);
  if (!node) {
    return (
      <div className="space-y-3 text-[13px] text-ink-muted">
        <p className="eyebrow text-accent">Mind map</p>
        <p>The central topic with its main themes and details. Read it from the centre outwards, one branch at a time, and try to recall what each branch holds before opening it.</p>
        <p>Click a branch to rename it, add sub-branches and study only the cards about it. The number on each branch is how many cards it covers.</p>
        {autoModel && (
          <p className="flex items-center gap-2 rounded-md border border-line bg-sunken p-2.5 text-[12px]">
            <Tags className="size-4 shrink-0 text-accent" /> Built from the card tags, without AI. Regenerate it with an AI engine for a better structure.
          </p>
        )}
      </div>
    );
  }
  const set = (patch: Partial<MapNode>) => edit((list) => list.map((n) => (n.id === node.id ? { ...n, ...patch } : n)));
  const kids = childrenMap(nodes).get(node.id) ?? [];
  return (
    <div className="space-y-4">
      <PanelHead title={node.parent ? "Branch" : "Central topic"} onClose={() => onSelect(null)} />
      <div>
        <Label htmlFor="mind-label">Name</Label>
        <Input id="mind-label" value={node.label} maxLength={80} onChange={(e) => set({ label: e.target.value })} />
      </div>
      <div>
        <Label htmlFor="mind-note">Note</Label>
        <Textarea id="mind-note" rows={3} value={node.note} maxLength={400} placeholder="A short explanation" onChange={(e) => set({ note: e.target.value })} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const id = freshId("n", nodes);
            edit((list) => [...list, { id, label: "New branch", note: "", parent: node.id, cards: [] }]);
            onSelect(id);
          }}
        >
          <Plus className="size-4" /> Add sub-branch
        </Button>
        {node.parent && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              edit((list) => list.filter((n) => n.id !== node.id).map((n) => (n.parent === node.id ? { ...n, parent: node.parent } : n)));
              onSelect(null);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        )}
      </div>
      {kids.length > 0 && (
        <div>
          <p className="eyebrow mb-1.5 text-ink-muted">Sub-branches</p>
          <div className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <button key={k.id} type="button" onClick={() => onSelect(k.id)} className="cursor-pointer rounded-full border border-line bg-sunken px-2.5 py-0.5 text-[12px] text-ink hover:border-primary">
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <p className="eyebrow mb-1.5 text-ink-muted">Cards ({node.cards.length})</p>
        <CardList ids={node.cards} cardById={cardById} deckId={deckId} />
      </div>
    </div>
  );
}

// ---------- mappa concettuale ----------

function ConceptPanel({
  data,
  selected,
  onSelect,
  edit,
  deckId,
  cardById,
}: {
  data: ConceptMapData;
  selected: ConceptSelection;
  onSelect: (s: ConceptSelection) => void;
  edit: (fn: (c: ConceptMapData) => ConceptMapData) => void;
  deckId: string;
  cardById: Map<string, Card>;
}) {
  const label = (id: string) => data.concepts.find((c) => c.id === id)?.label ?? "?";
  const setProp = (id: string, patch: Partial<Proposition>) => edit((c) => ({ ...c, propositions: c.propositions.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setConceptNode = (id: string, patch: Partial<Concept>) => edit((c) => ({ ...c, concepts: c.concepts.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));

  if (selected?.kind === "prop") {
    const p = data.propositions.find((x) => x.id === selected.id);
    if (!p) return null;
    return (
      <div className="space-y-4">
        <PanelHead title={p.cross ? "Cross-link" : "Proposition"} onClose={() => onSelect(null)} />
        <p className="rounded-md border border-line bg-sunken p-3 font-serif text-[16px] leading-6 text-heading">
          {label(p.from)} <span className="italic text-accent">{p.label}</span> {label(p.to)}
        </p>
        <div>
          <Label htmlFor="prop-label">Linking words</Label>
          <Input id="prop-label" value={p.label} maxLength={60} onChange={(e) => setProp(p.id, { label: e.target.value })} />
          <p className="mt-1 text-[12px] text-ink-faint">A verb or short phrase: the arrow must read as a correct sentence.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setProp(p.id, { from: p.to, to: p.from })}>
            <ArrowLeftRight className="size-4" /> Reverse
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setProp(p.id, { cross: !p.cross })}>
            {p.cross ? "Make hierarchical" : "Make cross-link"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              edit((c) => ({ ...c, propositions: c.propositions.filter((x) => x.id !== p.id) }));
              onSelect(null);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
        <div>
          <p className="eyebrow mb-1.5 text-ink-muted">Cards that test it ({p.cards.length})</p>
          <CardList ids={p.cards} cardById={cardById} deckId={deckId} />
        </div>
      </div>
    );
  }

  if (selected?.kind === "concept") {
    const c = data.concepts.find((x) => x.id === selected.id);
    if (!c) return null;
    const links = data.propositions.filter((p) => p.from === c.id || p.to === c.id);
    return (
      <div className="space-y-4">
        <PanelHead title={`Concept · level ${c.level + 1}`} onClose={() => onSelect(null)} />
        <div>
          <Label htmlFor="concept-label">Concept</Label>
          <Input id="concept-label" value={c.label} maxLength={80} onChange={(e) => setConceptNode(c.id, { label: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="concept-note">Note</Label>
          <Textarea id="concept-note" rows={2} value={c.note} maxLength={400} placeholder="A short explanation" onChange={(e) => setConceptNode(c.id, { note: e.target.value })} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled={c.level === 0} onClick={() => setConceptNode(c.id, { level: c.level - 1, x: undefined, y: undefined })}>
            <ArrowUp className="size-4" /> More general
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConceptNode(c.id, { level: c.level + 1, x: undefined, y: undefined })}>
            <ArrowDown className="size-4" /> More specific
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              edit((m) => ({ ...m, concepts: m.concepts.filter((x) => x.id !== c.id), propositions: m.propositions.filter((p) => p.from !== c.id && p.to !== c.id) }));
              onSelect(null);
            }}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
        <div>
          <p className="eyebrow mb-1.5 text-ink-muted">Propositions ({links.length})</p>
          <ul className="space-y-1">
            {links.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onSelect({ kind: "prop", id: p.id })} className="w-full cursor-pointer rounded-md px-2 py-1 text-left text-[12px] leading-4 text-ink-muted hover:bg-muted">
                  <span className="font-semibold text-ink">{label(p.from)}</span> <span className="italic text-accent">{p.label}</span>{" "}
                  <span className="font-semibold text-ink">{label(p.to)}</span>
                </button>
              </li>
            ))}
          </ul>
          <AddProposition data={data} from={c.id} edit={edit} />
        </div>
        <div>
          <p className="eyebrow mb-1.5 text-ink-muted">Cards ({c.cards.length})</p>
          <CardList ids={c.cards} cardById={cardById} deckId={deckId} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="focus">Focus question</Label>
        <Textarea id="focus" rows={2} value={data.focus} maxLength={200} onChange={(e) => edit((c) => ({ ...c, focus: e.target.value }))} />
      </div>
      <div>
        <p className="eyebrow mb-1.5 text-ink-muted">
          Propositions ({data.propositions.length}) · {data.propositions.filter((p) => p.cross).length} cross-links
        </p>
        <ul className="space-y-0.5">
          {data.propositions.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onSelect({ kind: "prop", id: p.id })}
                className={cn("w-full cursor-pointer rounded-md px-2 py-1 text-left text-[12px] leading-4 text-ink-muted hover:bg-muted", p.cross && "border-l-2 border-accent")}
                title={propositionText(p, data.concepts)}
              >
                <span className="font-semibold text-ink">{label(p.from)}</span> <span className="italic text-accent">{p.label}</span>{" "}
                <span className="font-semibold text-ink">{label(p.to)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow mb-1.5 text-ink-muted">Add</p>
        <AddProposition data={data} edit={edit} />
        <AddConcept data={data} edit={edit} onAdded={(id) => onSelect({ kind: "concept", id })} />
      </div>
    </div>
  );
}

function AddProposition({ data, from: fixedFrom, edit }: { data: ConceptMapData; from?: string; edit: (fn: (c: ConceptMapData) => ConceptMapData) => void }) {
  const [from, setFrom] = useState(fixedFrom ?? "");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const source = fixedFrom ?? from;
  const exists = (a: string, b: string) => data.propositions.some((p) => (p.from === a && p.to === b) || (p.from === b && p.to === a));
  const options = (exclude: string) => data.concepts.filter((c) => c.id !== exclude && !(exclude && exists(exclude, c.id)));
  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-dashed border-line-strong p-2">
      {!fixedFrom && (
        <Select value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 text-[13px]" aria-label="From concept">
          <option value="">From concept…</option>
          {data.concepts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Linking words, e.g. produces" maxLength={60} className="h-8 text-[13px]" />
      <div className="flex gap-1.5">
        <Select value={to} onChange={(e) => setTo(e.target.value)} className="h-8 min-w-0 flex-1 text-[13px]" aria-label="To concept">
          <option value="">To concept…</option>
          {options(source).map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={!source || !to || !label.trim()}
          onClick={() => {
            edit((c) => {
              const a = c.concepts.find((x) => x.id === source);
              const b = c.concepts.find((x) => x.id === to);
              const cross = Boolean(a && b && b.level <= a.level);
              return { ...c, propositions: [...c.propositions, { id: freshId("p", c.propositions), from: source, to, label: label.trim(), cross, cards: [] }] };
            });
            setTo("");
            setLabel("");
          }}
        >
          <Plus className="size-4" /> Link
        </Button>
      </div>
    </div>
  );
}

function AddConcept({ data, edit, onAdded }: { data: ConceptMapData; edit: (fn: (c: ConceptMapData) => ConceptMapData) => void; onAdded: (id: string) => void }) {
  const [label, setLabel] = useState("");
  const maxLevel = Math.max(0, ...data.concepts.map((c) => c.level));
  const [level, setLevel] = useState(Math.min(1, maxLevel));
  return (
    <div className="mt-2 flex gap-1.5">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New concept" maxLength={80} className="h-8 min-w-0 flex-1 text-[13px]" />
      <Select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="h-8 w-24 text-[13px]" aria-label="Level">
        {Array.from({ length: maxLevel + 2 }, (_, i) => (
          <option key={i} value={i}>
            Level {i + 1}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="secondary"
        disabled={!label.trim()}
        onClick={() => {
          const id = freshId("c", data.concepts);
          edit((c) => ({ ...c, concepts: [...c.concepts, { id, label: label.trim(), note: "", level, cards: [] }] }));
          setLabel("");
          onAdded(id);
        }}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}

// ---------- esercizio ----------

function PracticeBar({ practice, onRestart, onEnd }: { practice: Practice & { mode: PracticeMode }; onRestart: () => void; onEnd: () => void }) {
  const total = practice.hidden.size;
  const answered = Object.keys(practice.results).length;
  const correct = Object.values(practice.results).filter((r) => r === "correct").length;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <span className="text-[13px] font-semibold text-ink tabular-nums">
        {correct} correct · {answered}/{total} answered
      </span>
      <Button variant="secondary" size="sm" onClick={onRestart}>
        <RotateCcw className="size-3.5" /> New round
      </Button>
      <Button variant="ghost" size="sm" onClick={onEnd}>
        End practice
      </Button>
    </div>
  );
}

function PracticePanel({
  data,
  practice,
  selected,
  onSelect,
  onResult,
}: {
  data: ConceptMapData;
  practice: Practice;
  selected: ConceptSelection;
  onSelect: (s: ConceptSelection) => void;
  onResult: (id: string, r: "correct" | "wrong" | "shown") => void;
}) {
  const [guess, setGuess] = useState("");
  const label = (id: string) => data.concepts.find((c) => c.id === id)?.label ?? "?";
  const pending = [...practice.hidden].filter((id) => !practice.results[id]);
  const id = selected?.id;
  const isHiddenTarget = Boolean(id && practice.hidden.has(id));

  if (!id || !isHiddenTarget) {
    const done = pending.length === 0;
    const correct = Object.values(practice.results).filter((r) => r === "correct").length;
    return (
      <div className="space-y-3 text-[13px] text-ink-muted">
        <p className="eyebrow text-accent">Practice</p>
        {done ? (
          <p className="rounded-md border border-line bg-sunken p-3 text-ink">
            Round complete: <span className="font-semibold">{correct}</span> of {practice.hidden.size} right. Start a new round to practise other links.
          </p>
        ) : (
          <>
            <p>Some linking words or concepts are hidden. Click a highlighted <span className="font-semibold text-ink">?</span> on the map and write what is missing.</p>
            <p>Think of the whole sentence: concept → linking words → concept.</p>
            <Button
              size="sm"
              onClick={() => {
                const next = pending[0];
                onSelect(data.propositions.some((p) => p.id === next) ? { kind: "prop", id: next } : { kind: "concept", id: next });
                setGuess("");
              }}
            >
              Next blank ({pending.length} left)
            </Button>
          </>
        )}
      </div>
    );
  }

  const prop = data.propositions.find((p) => p.id === id);
  const concept = data.concepts.find((c) => c.id === id);
  const expected = prop ? prop.label : (concept?.label ?? "");
  const result = practice.results[id];
  const context = prop
    ? [prop]
    : data.propositions.filter((p) => p.from === id || p.to === id);
  const blank = <span className="rounded bg-highlight px-1.5 font-sans text-[13px] font-bold text-on-highlight">?</span>;

  function check() {
    if (!guess.trim()) return;
    onResult(id!, answerMatches(guess, expected) ? "correct" : "wrong");
  }

  return (
    <div className="space-y-4">
      <PanelHead title={prop ? "Missing linking words" : "Missing concept"} onClose={() => onSelect(null)} />
      <ul className="space-y-1.5">
        {context.map((p) => (
          <li key={p.id} className="rounded-md border border-line bg-sunken p-2.5 font-serif text-[15px] leading-6 text-heading">
            {p.from === id && !result ? blank : label(p.from)}{" "}
            {prop && !result ? blank : <span className="italic text-accent">{practice.hidden.has(p.id) && !practice.results[p.id] && p.id !== id ? "…" : p.label}</span>}{" "}
            {p.to === id && !result ? blank : label(p.to)}
          </li>
        ))}
      </ul>
      {!result ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            check();
          }}
        >
          <Input autoFocus value={guess} onChange={(e) => setGuess(e.target.value)} placeholder={prop ? "Linking words…" : "Concept…"} maxLength={80} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!guess.trim()}>
              <Check className="size-4" /> Check
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onResult(id, "shown")}>
              <Eye className="size-4" /> Show answer
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={cn(
            "rounded-md border p-3 text-[13px]",
            result === "correct" ? "border-accent bg-accent-soft text-ink" : result === "wrong" ? "border-danger/40 bg-danger-soft text-on-danger-soft" : "border-line bg-sunken text-ink",
          )}
        >
          <p className="font-semibold">{result === "correct" ? "Correct!" : result === "wrong" ? `Not quite: you wrote “${guess}”.` : "Answer"}</p>
          <p className="mt-1">
            Expected: <span className="font-semibold">{expected}</span>
          </p>
        </div>
      )}
      {result && pending.length > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const next = pending[0];
            onSelect(data.propositions.some((p) => p.id === next) ? { kind: "prop", id: next } : { kind: "concept", id: next });
            setGuess("");
          }}
        >
          Next blank ({pending.length} left)
        </Button>
      )}
    </div>
  );
}
