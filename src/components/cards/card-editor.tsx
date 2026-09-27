"use client";

import { Code2, Eye, ImageIcon, PenLine, Trash2, X } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/client";
import { clozeNumbers, hasCloze } from "@/lib/cloze";
import { sanitizeClient } from "@/lib/sanitize-client";
import type { Card, CardType, Occlusion } from "@/lib/types";
import { Button, Input, Label, Modal, Textarea, cn } from "../ui";
import { CardHtml, ClozeHtml } from "./card-html";
import { OcclusionCanvas, OcclusionView } from "./occlusion-view";

type Draft = {
  type: CardType;
  front: string;
  back: string;
  extra: string;
  tags: string[];
  imageMaterialId: string | null;
  occlusions: Occlusion[];
};

function toDraft(card?: Card | null): Draft {
  return {
    type: card?.type ?? "basic",
    front: card?.front ?? "",
    back: card?.back ?? "",
    extra: card?.extra ?? "",
    tags: card?.tags ?? [],
    imageMaterialId: card?.imageMaterialId ?? null,
    occlusions: card?.occlusions ?? [],
  };
}

export type CardEditorProps = {
  deckId: string;
  card: Card | null;
  /** Numero progressivo mostrato nell'intestazione (solo in modifica) */
  index?: number;
  onSaved: (card: Card, isNew: boolean) => void;
  onCancel: () => void;
  onDelete?: (card: Card) => void;
};

/** Form di modifica/creazione card, usato nel pannello laterale o dentro un dialog. */
export function CardEditorForm({ deckId, card, index, onSaved, onCancel, onDelete, inModal = false }: CardEditorProps & { inModal?: boolean }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(card));
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [selectedMask, setSelectedMask] = useState<string | null>(null);
  const frontRef = useRef<HTMLTextAreaElement>(null);
  const isOcclusion = draft.type === "image_occlusion";

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  function insertCloze() {
    const el = frontRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    const selectedText = value.slice(selectionStart, selectionEnd) || "answer";
    const next = (clozeNumbers(value).at(-1) ?? 0) + 1;
    const snippet = `{{c${next}::${selectedText}}}`;
    set({ front: value.slice(0, selectionStart) + snippet + value.slice(selectionEnd) });
    requestAnimationFrame(() => {
      el.focus();
      const start = selectionStart + `{{c${next}::`.length;
      el.setSelectionRange(start, start + selectedText.length);
    });
  }

  function onFrontKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (draft.type === "cloze" && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      insertCloze();
    }
  }

  function addTags(raw: string) {
    const parts = raw.split(/[\s,]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
    if (parts.length) set({ tags: [...new Set([...draft.tags, ...parts])].slice(0, 12) });
    setTagInput("");
  }

  async function save() {
    const pendingTags = tagInput.trim() ? [...new Set([...draft.tags, ...tagInput.split(/[\s,]+/).map((t) => t.replace(/^#/, "")).filter(Boolean)])] : draft.tags;
    if (isOcclusion && draft.occlusions.length === 0) return toast.error("Draw at least one mask on the image.");
    if (!isOcclusion && !draft.front.trim()) return toast.error("The front cannot be empty.");
    if (draft.type === "basic" && !draft.back.trim()) return toast.error("The back cannot be empty.");
    if (draft.type === "cloze" && !hasCloze(draft.front)) return toast.error("Add at least one cloze deletion, e.g. {{c1::answer}}.");
    setSaving(true);
    try {
      const body = {
        type: draft.type,
        front: draft.front,
        back: draft.type === "basic" ? draft.back : "",
        extra: draft.extra,
        tags: pendingTags,
        ...(isOcclusion ? { imageMaterialId: draft.imageMaterialId, occlusions: draft.occlusions } : {}),
      };
      const res = card
        ? await api<{ card: Card }>(`/api/decks/${deckId}/cards/${card.id}`, { method: "PATCH", json: body })
        : await api<{ card: Card }>(`/api/decks/${deckId}/cards`, { method: "POST", json: body });
      onSaved(res.card, !card);
      toast.success(card ? "Card updated" : "Card added");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col">
      {!inModal && (
        <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
          <h3 className="flex items-center gap-2 font-serif text-[20px] font-semibold text-heading">
            <PenLine className="size-[18px] text-ink-muted" strokeWidth={1.75} />
            {card ? "Edit card" : "New card"}
            {card && index !== undefined && <span className="rounded-[4px] bg-muted px-1.5 py-0.5 font-sans text-[11px] font-semibold text-ink-muted">#{index}</span>}
          </h3>
          {isOcclusion ? <OcclusionBadge /> : <TypeToggle value={draft.type} onChange={(t) => set({ type: t })} />}
        </div>
      )}
      {inModal && (
        <div className="mb-3 flex justify-end">
          {isOcclusion ? <OcclusionBadge /> : <TypeToggle value={draft.type} onChange={(t) => set({ type: t })} />}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1 rounded-md bg-sunken p-1">
        {[
          { v: false, label: "Edit", icon: PenLine },
          { v: true, label: "Preview", icon: Eye },
        ].map(({ v, label, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => setPreview(v)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-xs font-semibold transition",
              preview === v ? "bg-primary text-on-primary" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon className="size-3.5" /> {label}
          </button>
        ))}
        <span className="ml-auto pr-2 text-[11px] text-ink-faint">Simple HTML · Anki</span>
      </div>

      {preview ? (
        <div className="mt-4 space-y-3 rounded-md border border-line bg-card p-5">
          {isOcclusion && draft.imageMaterialId ? (
            <div className="space-y-3 text-center">
              {draft.front && <CardHtml html={sanitizeClient(draft.front)} className="font-serif text-lg" />}
              <OcclusionView materialId={draft.imageMaterialId} occlusions={draft.occlusions} mode={{ kind: "overview" }} />
            </div>
          ) : draft.type === "cloze" ? (
            <ClozeHtml text={sanitizeClient(draft.front)} className="text-center font-serif text-lg leading-relaxed" />
          ) : (
            <>
              <CardHtml html={sanitizeClient(draft.front)} className="text-center font-serif text-lg leading-relaxed" />
              <hr className="border-line" />
              <CardHtml html={sanitizeClient(draft.back)} className="text-center" />
            </>
          )}
          {draft.extra && <CardHtml html={sanitizeClient(draft.extra)} className="border-l-2 border-accent pl-3 text-[13px] text-ink-muted" />}
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {isOcclusion && draft.imageMaterialId && (
            <OcclusionMasksEditor
              materialId={draft.imageMaterialId}
              occlusions={draft.occlusions}
              selected={selectedMask}
              onSelect={setSelectedMask}
              onChange={(occlusions) => set({ occlusions })}
            />
          )}
          <div>
            <Label htmlFor="card-front" hint={isOcclusion ? "Optional" : undefined}>
              {isOcclusion ? "Header" : draft.type === "cloze" ? "Cloze text" : "Question (front)"}
            </Label>
            <Textarea
              id="card-front"
              ref={frontRef}
              rows={isOcclusion ? 2 : draft.type === "cloze" ? 4 : 3}
              value={draft.front}
              onChange={(e) => set({ front: e.target.value })}
              onKeyDown={onFrontKeyDown}
              maxLength={5000}
              className="bg-sunken font-serif text-[17px] leading-relaxed"
              placeholder={
                isOcclusion
                  ? "Label the chambers and valves of the heart"
                  : draft.type === "cloze"
                    ? "The {{c1::sinoatrial}} node is the physiological pacemaker of the heart."
                    : "What is the physiological pacemaker of the heart?"
              }
            />
          </div>
          {draft.type === "basic" && (
            <div>
              <Label htmlFor="card-back">Answer (back)</Label>
              <Textarea id="card-back" rows={3} value={draft.back} onChange={(e) => set({ back: e.target.value })} maxLength={5000} className="bg-sunken" />
            </div>
          )}
          <div>
            <Label htmlFor="card-extra" hint="Optional">
              Clinical note / extra
            </Label>
            <Textarea
              id="card-extra"
              rows={2}
              value={draft.extra}
              onChange={(e) => set({ extra: e.target.value })}
              maxLength={5000}
              className="bg-sunken"
              placeholder="Clinical correlation, mnemonic…"
            />
          </div>
          <div>
            <Label htmlFor="card-tags">Tags</Label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-sunken p-2 focus-within:border-primary focus-within:ring-[1.5px] focus-within:ring-primary">
              {draft.tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-[4px] border border-line bg-card py-0.5 pr-1 pl-2 text-xs font-medium text-ink">
                  #{t}
                  <button type="button" onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })} className="grid size-4 cursor-pointer place-items-center rounded-sm text-ink-faint hover:text-danger" aria-label={`Remove tag ${t}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id="card-tags"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "," || e.key === " ") {
                    e.preventDefault();
                    addTags(tagInput);
                  } else if (e.key === "Backspace" && !tagInput && draft.tags.length) {
                    set({ tags: draft.tags.slice(0, -1) });
                  }
                }}
                onBlur={() => tagInput.trim() && addTags(tagInput)}
                placeholder={draft.tags.length ? "" : "+ Add tag…"}
                className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-xs text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
          {draft.type === "cloze" ? (
            <div className="flex gap-2.5 rounded-md border border-line bg-sunken p-3 text-xs leading-5 text-ink-muted">
              <Code2 className="mt-0.5 size-4 shrink-0 text-accent" />
              <p>
                <span className="font-semibold text-ink">Anki cloze syntax:</span> select the text and press{" "}
                <kbd className="rounded-[3px] border border-line bg-card px-1 font-semibold">Ctrl+Shift+C</kbd> or{" "}
                <button type="button" onClick={insertCloze} className="cursor-pointer font-semibold text-accent hover:underline">
                  create a cloze deletion
                </button>{" "}
                in the format <code className="font-semibold text-ink">{"{{c1::term}}"}</code>.
              </p>
            </div>
          ) : (
            <p className="text-[11px] text-ink-faint">Allowed formatting: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;sub&gt;, &lt;sup&gt;, &lt;br&gt;, &lt;ul&gt;/&lt;li&gt;.</p>
          )}
        </div>
      )}

      <div
        className={cn(
          "mt-5 flex items-center gap-2 border-t border-line pt-4",
          // Nel dialog su mobile: pulsanti a tutta larghezza, "Salva" sempre in vista
          inModal && "sticky bottom-0 -mx-5 -mb-4 flex-col-reverse items-stretch bg-card px-5 pb-4 sm:flex-row sm:items-center",
        )}
      >
        {card && onDelete && (
          <button type="button" onClick={() => onDelete(card)} className={cn("cursor-pointer text-[13px] font-semibold text-danger hover:underline", inModal ? "py-1 sm:mr-auto" : "mr-auto")}>
            Delete card
          </button>
        )}
        <Button variant="secondary" onClick={onCancel} disabled={saving} className={cn(!card && !inModal && "ml-auto", !card && inModal && "sm:ml-auto")}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          {card ? "Save changes" : "Add card"}
        </Button>
      </div>
    </div>
  );
}

function TypeToggle({ value, onChange }: { value: CardType; onChange: (t: CardType) => void }) {
  return (
    <div className="inline-flex rounded-md border border-line bg-sunken p-0.5" role="radiogroup" aria-label="Card type">
      {(["basic", "cloze"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={value === t}
          onClick={() => onChange(t)}
          className={cn(
            "cursor-pointer rounded-[4px] px-2.5 py-1 text-xs font-semibold transition",
            value === t ? "bg-card text-heading shadow-card" : "text-ink-muted hover:text-ink",
          )}
        >
          {t === "basic" ? "Q / A" : "Cloze"}
        </button>
      ))}
    </div>
  );
}

/** Versione in dialog (schermi piccoli). */
export function CardEditorModal(props: CardEditorProps & { open: boolean }) {
  if (!props.open) return null;
  return (
    <Modal open onClose={props.onCancel} title={props.card ? `Edit card${props.index ? ` #${props.index}` : ""}` : "New card"} size="lg">
      <CardEditorForm key={props.card?.id ?? "new"} {...props} inModal />
    </Modal>
  );
}

function OcclusionBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-sunken px-2.5 py-1 text-xs font-semibold text-heading">
      <ImageIcon className="size-3.5" /> Image occlusion
    </span>
  );
}

/** Immagine con maschere disegnabili + elenco delle maschere con etichetta. */
function OcclusionMasksEditor({
  materialId,
  occlusions,
  selected,
  onSelect,
  onChange,
}: {
  materialId: string;
  occlusions: Occlusion[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (occlusions: Occlusion[]) => void;
}) {
  return (
    <div>
      <Label hint="Drag on the image to add a mask">Masks</Label>
      <div className="flex justify-center rounded-md bg-sunken p-2">
        <OcclusionCanvas
          materialId={materialId}
          occlusions={occlusions}
          selected={selected}
          onSelect={onSelect}
          onDraw={(box) => {
            const id = Math.random().toString(36).slice(2, 10);
            onChange([...occlusions, { id, label: "", ...box }]);
            onSelect(id);
          }}
        />
      </div>
      <ol className="mt-2 space-y-1.5">
        {occlusions.map((o, i) => (
          <li key={o.id} className={cn("flex items-center gap-2 rounded-md border p-1.5", selected === o.id ? "border-primary" : "border-line")}>
            <span className="grid size-6 shrink-0 place-items-center rounded-[4px] bg-[#ffeba2] text-[11px] font-bold text-[#212121]">{i + 1}</span>
            <Input
              value={o.label}
              onFocus={() => onSelect(o.id)}
              onChange={(e) => onChange(occlusions.map((x) => (x.id === o.id ? { ...x, label: e.target.value } : x)))}
              placeholder="Hidden term (answer)"
              maxLength={200}
              className="h-8 bg-sunken text-[13px]"
              aria-label={`Label of mask ${i + 1}`}
            />
            <button
              type="button"
              onClick={() => onChange(occlusions.filter((x) => x.id !== o.id))}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-danger-soft hover:text-danger"
              aria-label={`Delete mask ${i + 1}`}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {occlusions.length === 0 && <li className="text-[13px] text-ink-faint">No masks yet: drag on the image to draw one.</li>}
      </ol>
    </div>
  );
}
