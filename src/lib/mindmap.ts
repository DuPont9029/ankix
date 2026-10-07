// Mappe mentali e concettuali di un mazzo. Una sola struttura serve entrambe le viste:
// - l'albero (parent) è la mappa mentale: argomento centrale → rami → sotto-concetti;
// - i collegamenti trasversali con etichetta (links) la trasformano in mappa concettuale.
// Modulo puro condiviso tra client e server.
import type { ConceptMapData } from "./conceptmap";
import { plainText } from "./items";
import type { Card } from "./types";

export type MapNode = {
  id: string;
  label: string;
  /** Breve spiegazione del concetto */
  note: string;
  /** null solo per la radice */
  parent: string | null;
  /** Card del mazzo che verificano il concetto */
  cards: string[];
  /** Posizione scelta dallo studente nella vista concettuale */
  x?: number;
  y?: number;
};

export type MapLink = { id: string; from: string; to: string; label: string };

export type MindMapData = { nodes: MapNode[]; links: MapLink[] };

export type MindMap = MindMapData & {
  /** Mappa concettuale (generata a parte; null finché non viene creata) */
  concept: ConceptMapData | null;
  id: string;
  deckId: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
};

export const MAX_NODES = 150;
export const MAX_LINKS = 80;
export const AUTO_MODEL = "Automatic (from tags)";

const clean = (s: unknown, max: number) =>
  plainText(String(s ?? ""))
    .slice(0, max)
    .trim();

/**
 * Rende valida una mappa qualsiasi (prodotta dall'AI o modificata a mano): una sola radice, genitori esistenti,
 * nessun ciclo, id univoci, collegamenti tra nodi esistenti e diversi dagli archi dell'albero, card esistenti.
 */
export function normalizeMap(data: MindMapData, validCards: Set<string>, rootLabel = "Topic"): MindMapData {
  const nodes: MapNode[] = [];
  const ids = new Set<string>();
  for (const raw of data.nodes.slice(0, MAX_NODES)) {
    let id = clean(raw.id, 64).replace(/\s+/g, "-") || `n${nodes.length + 1}`;
    while (ids.has(id)) id = `${id}-${nodes.length + 1}`;
    const label = clean(raw.label, 80);
    if (!label) continue;
    ids.add(id);
    const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.round(raw.x) : undefined;
    const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.round(raw.y) : undefined;
    nodes.push({
      id,
      label,
      note: clean(raw.note, 400),
      parent: raw.parent ? String(raw.parent) : null,
      cards: [...new Set((raw.cards ?? []).map(String).filter((c) => validCards.has(c)))].slice(0, 60),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    });
  }
  // Gli id originali possono essere stati rinominati: si ricollegano i genitori per id esistenti.
  let root = nodes.find((n) => !n.parent || !ids.has(n.parent));
  if (!root) {
    root = { id: "root", label: rootLabel, note: "", parent: null, cards: [] };
    nodes.unshift(root);
    ids.add(root.id);
  }
  root.parent = null;
  for (const n of nodes) {
    if (n === root) continue;
    if (!n.parent || !ids.has(n.parent) || n.parent === n.id) n.parent = root.id;
  }
  // Cicli: risalendo dai genitori si deve arrivare alla radice.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const seen = new Set<string>([n.id]);
    let p = n.parent;
    while (p && p !== root.id) {
      if (seen.has(p)) {
        n.parent = root.id;
        break;
      }
      seen.add(p);
      p = byId.get(p)?.parent ?? null;
    }
  }
  // Radice per prima, poi in ordine di visita (i figli dopo i genitori).
  const children = childrenMap(nodes);
  const ordered: MapNode[] = [];
  const visit = (n: MapNode) => {
    ordered.push(n);
    for (const c of children.get(n.id) ?? []) visit(c);
  };
  visit(root);

  const links: MapLink[] = [];
  const seenLinks = new Set<string>();
  for (const raw of data.links ?? []) {
    const from = String(raw.from ?? "");
    const to = String(raw.to ?? "");
    if (!byId.has(from) || !byId.has(to) || from === to) continue;
    const a = byId.get(from)!;
    const b = byId.get(to)!;
    if (a.parent === b.id || b.parent === a.id) continue;
    const key = [from, to].sort().join("|");
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ id: clean(raw.id, 64) || `l${links.length + 1}`, from, to, label: clean(raw.label, 60) });
    if (links.length >= MAX_LINKS) break;
  }
  const linkIds = new Set<string>();
  for (const l of links) {
    while (linkIds.has(l.id)) l.id = `${l.id}-${linkIds.size}`;
    linkIds.add(l.id);
  }
  return { nodes: ordered, links };
}

export function childrenMap(nodes: MapNode[]): Map<string, MapNode[]> {
  const out = new Map<string, MapNode[]>();
  for (const n of nodes) {
    if (!n.parent) continue;
    const list = out.get(n.parent) ?? [];
    list.push(n);
    out.set(n.parent, list);
  }
  return out;
}

function shortLabel(text: string, words = 7): string {
  const parts = text.split(" ");
  return parts.length > words ? `${parts.slice(0, words).join(" ")}…` : text;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Mappa senza AI: i tag del mazzo diventano i rami, le card le foglie. */
export function autoMap(title: string, cards: Card[]): MindMapData {
  const nodes: MapNode[] = [{ id: "root", label: title.slice(0, 80) || "Deck", note: "", parent: null, cards: [] }];
  const count = new Map<string, number>();
  for (const c of cards) for (const t of c.tags) count.set(t, (count.get(t) ?? 0) + 1);
  const top = [...count.entries()]
    .filter(([, n]) => n >= 2 || count.size <= 8)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const tag = c.tags.find((t) => top.includes(t)) ?? "";
    groups.set(tag, [...(groups.get(tag) ?? []), c]);
  }
  // Senza tag utili: gruppi di card consecutive (di solito seguono l'ordine del materiale).
  if (top.length === 0) {
    groups.clear();
    cards.forEach((c, i) => {
      const g = `Part ${Math.floor(i / 8) + 1}`;
      groups.set(g, [...(groups.get(g) ?? []), c]);
    });
  }
  let n = 0;
  for (const [tag, list] of groups) {
    const branchId = `b${++n}`;
    nodes.push({ id: branchId, label: capitalize(tag.replace(/[_-]+/g, " ")) || "Other concepts", note: "", parent: "root", cards: list.map((c) => c.id) });
    for (const c of list.slice(0, 8)) {
      const text = plainText(c.type === "image_occlusion" ? c.front || c.occlusions.map((o) => o.label).join(", ") : c.front);
      if (!text) continue;
      nodes.push({ id: `c${++n}`, label: shortLabel(text).slice(0, 80), note: "", parent: branchId, cards: [c.id] });
    }
  }
  return { nodes, links: [] };
}

/** Testo delle card numerate per i prompt (#1, #2, …): le card dell'AI si riferiscono a questi numeri. */
export function cardsForPrompt(cards: Card[], maxChars: number, perCard: number): { text: string; ids: string[] } {
  const lines: string[] = [];
  const ids: string[] = [];
  let total = 0;
  for (const c of cards) {
    let q = plainText(c.front);
    let a = "";
    if (c.type === "basic") a = plainText(c.back);
    else if (c.type === "mcq") a = plainText(c.choices.find((x) => x.correct)?.text ?? c.back);
    else if (c.type === "image_occlusion") a = c.occlusions.map((o) => o.label).join(", ");
    if (c.extra) a = `${a}${a ? " — " : ""}${plainText(c.extra)}`;
    q = q.slice(0, perCard);
    a = a.slice(0, perCard);
    const line = `#${ids.length + 1} ${q}${a ? ` → ${a}` : ""}`;
    if (total + line.length > maxChars) break;
    lines.push(line);
    ids.push(c.id);
    total += line.length + 1;
  }
  return { text: lines.join("\n"), ids };
}

/** Numeri di card (#n) → id delle card. */
export function cardRefs(refs: unknown[], ids: string[]): string[] {
  return refs.map((r) => ids[Number(r) - 1]).filter((x): x is string => Boolean(x));
}

/**
 * Formato a schema per il modello locale (più affidabile del JSON per un modello piccolo):
 *   Radice | nota | cards: 1, 2
 *     - Ramo | nota | cards: 3
 *       - Sotto-concetto | nota
 *   LINKS:
 *   Concetto A -> causa -> Concetto B
 */
export function parseOutlineMap(text: string, ids: string[]): MindMapData {
  const nodes: MapNode[] = [];
  const links: MapLink[] = [];
  const stack: { indent: number; id: string }[] = [];
  let inLinks = false;
  for (const rawLine of text.replace(/\r/g, "").split("\n")) {
    if (!rawLine.trim() || /^```/.test(rawLine.trim())) continue;
    if (/^\s*(\*\*)?links:?(\*\*)?\s*$/i.test(rawLine)) {
      inLinks = true;
      continue;
    }
    if (inLinks) {
      const parts = rawLine.replace(/^\s*[-*•]\s*/, "").split(/\s*(?:->|→)\s*/);
      if (parts.length === 3) {
        const find = (label: string) => nodes.find((n) => n.label.toLowerCase() === label.trim().toLowerCase().replace(/\*\*/g, ""));
        const a = find(parts[0]);
        const b = find(parts[2]);
        if (a && b) links.push({ id: `l${links.length + 1}`, from: a.id, to: b.id, label: parts[1].trim() });
      }
      continue;
    }
    const indent = rawLine.replace(/\t/g, "  ").search(/\S/);
    const content = rawLine.trim().replace(/^[-*•]\s*|^\d+[.)]\s*/, "").replace(/^#+\s*/, "").replace(/\*\*/g, "");
    const [labelPart, ...rest] = content.split("|").map((p) => p.trim());
    if (!labelPart) continue;
    let note = "";
    let refs: string[] = [];
    for (const r of rest) {
      const m = r.match(/^cards?\s*:\s*(.*)$/i);
      if (m) refs = cardRefs(m[1].split(/[,\s]+/).map((x) => x.replace("#", "")).filter(Boolean), ids);
      else if (!note) note = r;
    }
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const id = `n${nodes.length + 1}`;
    const parent = nodes.length === 0 ? null : (stack[stack.length - 1]?.id ?? nodes[0].id);
    nodes.push({ id, label: labelPart.slice(0, 80), note: note.slice(0, 400), parent, cards: refs });
    stack.push({ indent, id });
  }
  return { nodes, links };
}

// ---------- layout ----------

export type Box = { x: number; y: number; w: number; h: number; lines: string[] };

const CHAR_W = 7.1;
const LINE_H = 17;

/** Etichetta su più righe (max 3) e dimensioni del riquadro. */
export function measureNode(label: string, isRoot: boolean): Omit<Box, "x" | "y"> {
  const max = isRoot ? 24 : 22;
  const lines: string[] = [];
  let line = "";
  for (const word of label.split(" ")) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > 3) {
    lines.length = 3;
    lines[2] = `${lines[2].slice(0, max - 1)}…`;
  }
  const scale = isRoot ? 1.18 : 1;
  const w = Math.max(64, Math.max(...lines.map((l) => l.length)) * CHAR_W * scale + (isRoot ? 36 : 26));
  return { w, h: lines.length * LINE_H * scale + (isRoot ? 22 : 14), lines };
}

/** Mappa mentale: radice al centro, rami bilanciati a destra e a sinistra, sotto-alberi ordinati. */
export function treeLayout(nodes: MapNode[]): Map<string, Box> {
  const out = new Map<string, Box>();
  const root = nodes.find((n) => !n.parent);
  if (!root) return out;
  const children = childrenMap(nodes);
  const size = new Map(nodes.map((n) => [n.id, measureNode(n.label, n === root)]));
  const GAP_Y = 12;
  const GAP_X = 56;
  const heightOf = new Map<string, number>();
  const measure = (n: MapNode): number => {
    const kids = children.get(n.id) ?? [];
    const own = size.get(n.id)!.h;
    const sum = kids.reduce((a, k) => a + measure(k), 0) + GAP_Y * Math.max(0, kids.length - 1);
    const h = Math.max(own, sum);
    heightOf.set(n.id, h);
    return h;
  };
  const branches = children.get(root.id) ?? [];
  branches.forEach(measure);
  // Ripartizione dei rami tra i due lati per altezza simile.
  const right: MapNode[] = [];
  const left: MapNode[] = [];
  let hr = 0;
  let hl = 0;
  for (const b of branches) {
    if (hr <= hl) {
      right.push(b);
      hr += heightOf.get(b.id)! + GAP_Y * 2;
    } else {
      left.push(b);
      hl += heightOf.get(b.id)! + GAP_Y * 2;
    }
  }
  const rootSize = size.get(root.id)!;
  out.set(root.id, { x: 0, y: 0, ...rootSize });
  const place = (n: MapNode, side: 1 | -1, parentEdge: number, top: number) => {
    const s = size.get(n.id)!;
    const h = heightOf.get(n.id)!;
    const cx = parentEdge + side * (GAP_X + s.w / 2);
    out.set(n.id, { x: cx, y: top + h / 2, ...s });
    const kids = children.get(n.id) ?? [];
    const kidsH = kids.reduce((a, k) => a + heightOf.get(k.id)!, 0) + GAP_Y * Math.max(0, kids.length - 1);
    let y = top + (h - kidsH) / 2;
    for (const k of kids) {
      place(k, side, cx + (side * s.w) / 2, y);
      y += heightOf.get(k.id)! + GAP_Y;
    }
  };
  for (const [list, side, total] of [
    [right, 1, hr],
    [left, -1, hl],
  ] as const) {
    let y = -(total - GAP_Y * 2) / 2;
    for (const b of list) {
      place(b, side, (side * rootSize.w) / 2 + side * 24, y);
      y += heightOf.get(b.id)! + GAP_Y * 2;
    }
  }
  return out;
}

/** Colore del ramo principale a cui appartiene ogni nodo (indice nella tavolozza). */
export function branchIndex(nodes: MapNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => !n.parent);
  const branches = nodes.filter((n) => n.parent === root?.id);
  branches.forEach((b, i) => out.set(b.id, i));
  for (const n of nodes) {
    if (n === root || out.has(n.id)) continue;
    let cur: MapNode | undefined = n;
    while (cur?.parent && cur.parent !== root?.id) cur = byId.get(cur.parent);
    if (cur && out.has(cur.id)) out.set(n.id, out.get(cur.id)!);
  }
  return out;
}
