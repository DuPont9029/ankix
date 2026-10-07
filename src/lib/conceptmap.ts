// Mappe concettuali (Novak): concetti collegati da frecce con parola-legame, che si leggono come
// proposizioni ("Meiosi → produce → cellule aploidi"); gerarchiche dall'alto (concetti generali) verso il
// basso (specifici), con legami trasversali tra rami diversi e una domanda focale.
// Modulo puro condiviso tra client e server.
import { plainText } from "./items";
import { cardRefs, measureNode, type Box } from "./mindmap";

export type Concept = {
  id: string;
  label: string;
  note: string;
  /** 0 = concetto più generale (in alto) */
  level: number;
  cards: string[];
  x?: number;
  y?: number;
};

export type Proposition = {
  id: string;
  from: string;
  to: string;
  /** Parola-legame: verbo o locuzione che rende la coppia una frase ("produce", "avviene durante") */
  label: string;
  /** Legame trasversale tra rami diversi della gerarchia */
  cross: boolean;
  cards: string[];
};

export type ConceptMapData = { focus: string; concepts: Concept[]; propositions: Proposition[] };

export const MAX_CONCEPTS = 80;
export const MAX_PROPOSITIONS = 160;

const clean = (s: unknown, max: number) => plainText(String(s ?? "")).slice(0, max).trim();

/**
 * Rende valida una mappa concettuale: id univoci, ogni proposizione con parola-legame tra concetti esistenti
 * e diversi, livelli coerenti (nei legami gerarchici il concetto di arrivo sta sotto quello di partenza).
 */
export function normalizeConceptMap(data: ConceptMapData, validCards: Set<string>): ConceptMapData {
  const concepts: Concept[] = [];
  const ids = new Map<string, string>();
  const byLabel = new Map<string, string>();
  for (const raw of (data.concepts ?? []).slice(0, MAX_CONCEPTS)) {
    const label = clean(raw.label, 80);
    if (!label) continue;
    const key = label.toLowerCase();
    // Lo stesso concetto ripetuto due volte diventa uno solo (una mappa concettuale non è un albero).
    if (byLabel.has(key)) {
      ids.set(String(raw.id), byLabel.get(key)!);
      continue;
    }
    let id = clean(raw.id, 64).replace(/\s+/g, "-") || `c${concepts.length + 1}`;
    while (concepts.some((c) => c.id === id)) id = `${id}-${concepts.length + 1}`;
    ids.set(String(raw.id), id);
    byLabel.set(key, id);
    const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.round(raw.x) : undefined;
    const y = typeof raw.y === "number" && Number.isFinite(raw.y) ? Math.round(raw.y) : undefined;
    concepts.push({
      id,
      label,
      note: clean(raw.note, 400),
      level: Math.min(Math.max(Math.round(Number(raw.level) || 0), 0), 8),
      cards: [...new Set((raw.cards ?? []).map(String).filter((c) => validCards.has(c)))].slice(0, 60),
      ...(x !== undefined && y !== undefined ? { x, y } : {}),
    });
  }
  const byId = new Map(concepts.map((c) => [c.id, c]));

  const propositions: Proposition[] = [];
  const seen = new Set<string>();
  for (const raw of data.propositions ?? []) {
    const from = ids.get(String(raw.from)) ?? (byId.has(String(raw.from)) ? String(raw.from) : undefined);
    const to = ids.get(String(raw.to)) ?? (byId.has(String(raw.to)) ? String(raw.to) : undefined);
    if (!from || !to || from === to) continue;
    const key = [from, to].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    let id = clean(raw.id, 64) || `p${propositions.length + 1}`;
    while (propositions.some((p) => p.id === id)) id = `${id}-${propositions.length + 1}`;
    propositions.push({
      id,
      from,
      to,
      label: clean(raw.label, 60) || "is related to",
      cross: Boolean(raw.cross),
      cards: [...new Set((raw.cards ?? []).map(String).filter((c) => validCards.has(c)))].slice(0, 40),
    });
    if (propositions.length >= MAX_PROPOSITIONS) break;
  }

  // Livelli coerenti: nei legami gerarchici l'arrivo deve stare più in basso; se un ciclo lo impedisce
  // il legame diventa trasversale.
  for (let pass = 0; pass < concepts.length + 1; pass++) {
    let changed = false;
    for (const p of propositions) {
      if (p.cross) continue;
      const a = byId.get(p.from)!;
      const b = byId.get(p.to)!;
      if (b.level <= a.level) {
        if (pass >= concepts.length || a.level + 1 > 8) p.cross = true;
        else b.level = a.level + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Livelli compatti (0, 1, 2… senza buchi).
  const levels = [...new Set(concepts.map((c) => c.level))].sort((a, b) => a - b);
  for (const c of concepts) c.level = levels.indexOf(c.level);

  return { focus: clean(data.focus, 200), concepts, propositions };
}

/**
 * Formato per il modello locale:
 *   FOCUS: domanda focale
 *   CONCEPTS:
 *   0 | Meiosi | nota | cards: 1, 2
 *   1 | Cellule aploidi
 *   PROPOSITIONS:
 *   Meiosi -> produce -> Cellule aploidi | cards: 3
 *   CROSS-LINKS:
 *   Crossing-over -> aumenta -> Variabilità genetica
 */
export function parseConceptOutline(text: string, ids: string[]): ConceptMapData {
  const concepts: Concept[] = [];
  const propositions: Proposition[] = [];
  let focus = "";
  let section: "concepts" | "propositions" | "cross" | null = null;
  const find = (label: string) => {
    const k = label.replace(/\*\*/g, "").trim().toLowerCase();
    return concepts.find((c) => c.label.toLowerCase() === k);
  };
  const ensure = (label: string, level: number) => {
    const found = find(label);
    if (found) return found;
    const c: Concept = { id: `c${concepts.length + 1}`, label: label.replace(/\*\*/g, "").trim().slice(0, 80), note: "", level, cards: [] };
    if (c.label) concepts.push(c);
    return c;
  };
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\*\*/g, "").replace(/^\s*[-*•]\s*/, "").trim();
    if (!line || line.startsWith("```")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(?:focus(?: question)?|domanda focale)\s*:\s*(.*)$/i))) {
      focus = m[1];
      continue;
    }
    if (/^concepts?\s*:?$/i.test(line) || /^concetti\s*:?$/i.test(line)) {
      section = "concepts";
      continue;
    }
    if (/^(propositions?|proposizioni)\s*:?$/i.test(line)) {
      section = "propositions";
      continue;
    }
    if (/^(cross[- ]?links?|legami trasversali)\s*:?$/i.test(line)) {
      section = "cross";
      continue;
    }
    const [main, ...rest] = line.split("|").map((p) => p.trim());
    const fields = (list: string[]) => {
      let note = "";
      let refs: string[] = [];
      for (const r of list) {
        const cm = r.match(/^cards?\s*:\s*(.*)$/i);
        if (cm) refs = cardRefs(cm[1].split(/[,\s]+/).map((x) => x.replace("#", "")).filter(Boolean), ids);
        else if (!note) note = r;
      }
      return { note, refs };
    };
    const arrow = main.split(/\s*(?:->|→)\s*/);
    if (arrow.length === 3) {
      const a = ensure(arrow[0], 0);
      const b = ensure(arrow[2], a.level + 1);
      if (a.label && b.label) {
        propositions.push({ id: `p${propositions.length + 1}`, from: a.id, to: b.id, label: arrow[1], cross: section === "cross", cards: fields(rest).refs });
      }
      continue;
    }
    if (section === "concepts") {
      // "0 | Meiosi | nota | cards: 1" oppure "0. Meiosi | nota"
      let level = 0;
      let label = main;
      let extra = rest;
      if (/^\d+$/.test(main) && rest.length) {
        level = Number(main);
        label = rest[0];
        extra = rest.slice(1);
      } else {
        const lm = main.match(/^(\d+)\s*[.)-]\s*(.+)$/);
        if (lm) {
          level = Number(lm[1]);
          label = lm[2];
        }
      }
      const { note, refs } = fields(extra);
      const c = ensure(label, level);
      c.level = level;
      if (note) c.note = note.slice(0, 400);
      if (refs.length) c.cards = refs;
    }
  }
  return { focus, concepts, propositions };
}

// ---------- layout gerarchico ----------

const GAP_X = 34;
const GAP_Y = 96;

/**
 * Disposizione a livelli (dall'alto in basso): ordine nei livelli per baricentro dei vicini, così le frecce
 * si incrociano il meno possibile. Le posizioni scelte dallo studente restano fisse.
 */
export function conceptMapLayout(data: ConceptMapData): Map<string, Box> {
  const out = new Map<string, Box>();
  const { concepts, propositions } = data;
  if (concepts.length === 0) return out;
  const size = new Map(concepts.map((c) => [c.id, measureNode(c.label, c.level === 0)]));
  const maxLevel = Math.max(...concepts.map((c) => c.level));
  const layers: Concept[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const c of concepts) layers[c.level].push(c);

  const up = new Map<string, string[]>();
  const down = new Map<string, string[]>();
  for (const p of propositions) {
    if (p.cross) continue;
    up.set(p.to, [...(up.get(p.to) ?? []), p.from]);
    down.set(p.from, [...(down.get(p.from) ?? []), p.to]);
  }

  const x = new Map<string, number>();
  const pack = (layer: Concept[], desired?: Map<string, number>) => {
    const widths = layer.map((c) => size.get(c.id)!.w);
    const total = widths.reduce((a, b) => a + b, 0) + GAP_X * Math.max(0, layer.length - 1);
    let cursor = -total / 2;
    const pos = layer.map((c, i) => {
      const center = cursor + widths[i] / 2;
      cursor += widths[i] + GAP_X;
      return desired?.get(c.id) ?? center;
    });
    // Nessuna sovrapposizione: si spinge a destra, poi si ricentra il livello.
    for (let i = 1; i < layer.length; i++) {
      const min = pos[i - 1] + widths[i - 1] / 2 + GAP_X + widths[i] / 2;
      if (pos[i] < min) pos[i] = min;
    }
    if (desired && layer.length) {
      const shift = (pos.reduce((a, b) => a + b, 0) - [...layer].reduce((a, c) => a + (desired.get(c.id) ?? 0), 0)) / layer.length;
      for (let i = 0; i < pos.length; i++) pos[i] -= shift;
    }
    layer.forEach((c, i) => x.set(c.id, pos[i]));
  };
  layers.forEach((l) => pack(l));

  const bary = (c: Concept, nbrs: Map<string, string[]>) => {
    const list = (nbrs.get(c.id) ?? []).filter((id) => x.has(id));
    return list.length ? list.reduce((a, id) => a + x.get(id)!, 0) / list.length : undefined;
  };
  for (let sweep = 0; sweep < 6; sweep++) {
    const order = sweep % 2 === 0 ? layers.slice(1) : layers.slice(0, -1).reverse();
    const nbrs = sweep % 2 === 0 ? up : down;
    for (const layer of order) {
      const desired = new Map<string, number>();
      for (const c of layer) desired.set(c.id, bary(c, nbrs) ?? x.get(c.id)!);
      layer.sort((a, b) => desired.get(a.id)! - desired.get(b.id)!);
      pack(layer, desired);
    }
  }

  let y = 0;
  layers.forEach((layer) => {
    const h = Math.max(...layer.map((c) => size.get(c.id)!.h), 30);
    for (const c of layer) {
      const s = size.get(c.id)!;
      out.set(c.id, c.x !== undefined && c.y !== undefined ? { x: c.x, y: c.y, ...s } : { x: x.get(c.id)!, y: y + h / 2, ...s });
    }
    y += h + GAP_Y;
  });
  return out;
}

/** Proposizione leggibile: "Meiosi → produce → cellule aploidi". */
export function propositionText(p: Proposition, concepts: Concept[]): string {
  const label = (id: string) => concepts.find((c) => c.id === id)?.label ?? "?";
  return `${label(p.from)} — ${p.label} → ${label(p.to)}`;
}

/** Confronto tollerante per la modalità esercizio (maiuscole, accenti, articoli, piccoli errori di battitura). */
export function answerMatches(answer: string, expected: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\p{L}\p{N} ]+/gu, " ")
      .replace(/\b(il|lo|la|i|gli|le|l|un|una|uno|the|a|an|di|del|della|dei|delle|of)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const a = norm(answer);
  const b = norm(expected);
  if (!a) return false;
  if (a === b) return true;
  if (b.length >= 6 && (a.includes(b) || (b.includes(a) && a.length >= b.length * 0.6))) return true;
  // Distanza di modifica entro il 20% della lunghezza.
  const d: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] <= Math.max(1, Math.floor(b.length * 0.2));
}
