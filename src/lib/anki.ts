import "server-only";
import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { clozeNumbers } from "./cloze";
import { sanitizeTag } from "./sanitize";
import type { Card, Deck } from "./types";

// Genera un pacchetto .apkg (schema collection v11, importabile da tutte le versioni di Anki).

const BASIC_MODEL_ID = 1718200000201;
const CLOZE_MODEL_ID = 1718200000202;
const OCCLUSION_MODEL_ID = 1718200000203;

// Template del note type "Image Occlusion" ufficiale di Anki (23.10+): il rendering delle maschere è fatto
// da anki.imageOcclusion (desktop, AnkiMobile e AnkiDroid aggiornati).
const OCCLUSION_QFMT = `{{#Header}}<div>{{Header}}</div>{{/Header}}
<div style="display: none">{{cloze:Occlusion}}</div>
<div id="err"></div>
<div id="image-occlusion-container">
    {{Image}}
    <canvas id="image-occlusion-canvas"></canvas>
</div>
<script>
try {
    anki.imageOcclusion.setup();
} catch (exc) {
    document.getElementById("err").innerHTML = \`Error loading image occlusion. Is your Anki version up to date?<br><br>\${exc}\`;
}
</script>
`;
const OCCLUSION_AFMT = `${OCCLUSION_QFMT}
<div><button id="toggle">Toggle Masks</button></div>
{{#Back Extra}}<div>{{Back Extra}}</div>{{/Back Extra}}
`;
const OCCLUSION_CSS = `#image-occlusion-canvas {
    --inactive-shape-color: #ffeba2;
    --active-shape-color: #ff8e8e;
    --inactive-shape-border: 1px #212121;
    --active-shape-border: 1px #212121;
    --highlight-shape-color: #ff8e8e00;
    --highlight-shape-border: 1px #ff8e8e;
}

.card {
    font-family: arial;
    font-size: 20px;
    text-align: center;
    color: black;
    background-color: white;
}
`;

const CSS = `.card {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: #0f172a;
  background-color: #ffffff;
  padding: 16px;
}
.card.nightMode, .nightMode .card { color: #e2e8f0; background-color: #0f172a; }
hr#answer { border: none; border-top: 1px solid #cbd5e1; margin: 18px 0; }
.extra { margin-top: 18px; font-size: 16px; color: #475569; text-align: left; border-left: 3px solid #14b8a6; padding: 6px 12px; }
.nightMode .extra { color: #94a3b8; }
.cloze { font-weight: bold; color: #0d9488; }
.nightMode .cloze { color: #2dd4bf; }
ul, ol { display: inline-block; text-align: left; }
`;

let sqlPromise: Promise<SqlJsStatic> | null = null;
function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs();
    sqlPromise.catch(() => {
      sqlPromise = null;
    });
  }
  return sqlPromise;
}

function field(name: string, ord: number) {
  return { name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] };
}

function models(deckId: number, nowSec: number) {
  const common = {
    css: CSS,
    did: deckId,
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    mod: nowSec,
    sortf: 0,
    tags: [],
    usn: -1,
    vers: [],
  };
  return {
    [BASIC_MODEL_ID]: {
      ...common,
      id: BASIC_MODEL_ID,
      name: "Ankix Basic",
      type: 0,
      flds: [field("Front", 0), field("Back", 1), field("Extra", 2)],
      req: [[0, "any", [0]]],
      tmpls: [
        {
          name: "Card 1",
          ord: 0,
          qfmt: "{{Front}}",
          afmt: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}\n{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}',
          bqfmt: "",
          bafmt: "",
          did: null,
        },
      ],
    },
    [CLOZE_MODEL_ID]: {
      ...common,
      id: CLOZE_MODEL_ID,
      name: "Ankix Cloze",
      type: 1,
      flds: [field("Text", 0), field("Extra", 1)],
      tmpls: [
        {
          name: "Cloze",
          ord: 0,
          qfmt: "{{cloze:Text}}",
          afmt: '{{cloze:Text}}\n{{#Extra}}<div class="extra">{{Extra}}</div>{{/Extra}}',
          bqfmt: "",
          bafmt: "",
          did: null,
        },
      ],
    },
    [OCCLUSION_MODEL_ID]: {
      ...common,
      id: OCCLUSION_MODEL_ID,
      name: "Ankix Image Occlusion",
      type: 1,
      css: OCCLUSION_CSS,
      originalStockKind: 6,
      flds: [field("Occlusion", 0), field("Image", 1), field("Header", 2), field("Back Extra", 3), field("Comments", 4)],
      tmpls: [{ name: "Image Occlusion", ord: 0, qfmt: OCCLUSION_QFMT, afmt: OCCLUSION_AFMT, bqfmt: "", bafmt: "", did: null }],
    },
  };
}

/** Coordinata relativa nel formato di Anki (es. ".2839"). */
function coord(value: number): string {
  const v = Math.min(Math.max(value, 0), 1);
  const s = v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return s.startsWith("0.") ? s.slice(1) : s === "" ? "0" : s;
}

/** Campo "Occlusion": una cancellatura cN per maschera (ogni maschera diventa una card). */
export function occlusionField(card: Pick<Card, "occlusions">): string {
  return card.occlusions
    .map((o, i) => `{{c${i + 1}::image-occlusion:rect:left=${coord(o.x)}:top=${coord(o.y)}:width=${coord(o.w)}:height=${coord(o.h)}:oi=1}}`)
    .join("<br>");
}

function imageExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

export type ImageLoader = (materialId: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;

function deckJson(id: number, name: string, desc: string, nowSec: number) {
  return {
    id,
    name,
    desc,
    mod: nowSec,
    usn: -1,
    collapsed: false,
    browserCollapsed: false,
    conf: 1,
    dyn: 0,
    extendNew: 10,
    extendRev: 50,
    lrnToday: [0, 0],
    newToday: [0, 0],
    revToday: [0, 0],
    timeToday: [0, 0],
  };
}

const DCONF = {
  1: {
    id: 1,
    name: "Default",
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    dyn: false,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
  },
};

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function checksum(text: string): number {
  return Number.parseInt(createHash("sha1").update(text, "utf8").digest("hex").slice(0, 8), 16);
}

/** ID numerico stabile (entro Number.MAX_SAFE_INTEGER) derivato da una stringa. */
function stableId(value: string): number {
  const hex = createHash("sha1").update(value).digest("hex").slice(0, 12);
  return 1_000_000_000_000 + (Number.parseInt(hex, 16) % 8_000_000_000_000);
}

/** GUID stabile: reimportando lo stesso mazzo Anki aggiorna le note invece di duplicarle. */
function guidFor(cardId: string): string {
  return createHash("sha1").update(`ankix:${cardId}`).digest("base64").replace(/[+/=]/g, "").slice(0, 16);
}

export function ankiDeckName(deck: Pick<Deck, "subject" | "title">): string {
  const clean = (s: string) => s.replace(/::/g, ":").replace(/[\r\n\t"]/g, " ").trim() || "Untitled";
  return `Medicine::${clean(deck.subject)}::${clean(deck.title)}`;
}

export function exportTags(deck: Pick<Deck, "subject">, card: Pick<Card, "tags">): string[] {
  const subjectTag = sanitizeTag(`Medicine::${deck.subject}`);
  return [...new Set([subjectTag, ...card.tags.map(sanitizeTag)].filter(Boolean))];
}

export async function buildApkg(deck: Deck, cards: Card[], loadImage?: ImageLoader): Promise<Uint8Array> {
  const SQL = await getSql();
  const db = new SQL.Database();
  try {
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const deckId = stableId(`deck:${deck.id}`);

    db.run(SCHEMA);

    const conf = {
      activeDecks: [deckId],
      curDeck: deckId,
      newSpread: 0,
      collapseTime: 1200,
      timeLim: 0,
      estTimes: true,
      dueCounts: true,
      curModel: String(BASIC_MODEL_ID),
      nextPos: cards.length + 1,
      sortType: "noteFld",
      sortBackwards: false,
      addToCur: true,
    };
    const decks = {
      1: deckJson(1, "Default", "", nowSec),
      [deckId]: deckJson(deckId, ankiDeckName(deck), deck.description, nowSec),
    };

    db.run(`INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')`, [
      Math.floor(new Date().setHours(4, 0, 0, 0) / 1000),
      nowMs,
      nowMs,
      JSON.stringify(conf),
      JSON.stringify(models(deckId, nowSec)),
      JSON.stringify(decks),
      JSON.stringify(DCONF),
    ]);

    const noteStmt = db.prepare(`INSERT INTO notes VALUES (?, ?, ?, ?, -1, ?, ?, ?, ?, 0, '')`);
    const cardStmt = db.prepare(`INSERT INTO cards VALUES (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')`);
    let nextId = nowMs;
    let due = 1;
    // Media del pacchetto: file "0", "1"… e la mappa {"0": "nome-file.png"}
    const mediaFiles: Record<string, Uint8Array> = {};
    const mediaMap: Record<string, string> = {};
    const mediaNames = new Map<string, string>();
    try {
      for (const card of cards) {
        if (card.type === "image_occlusion") {
          if (!card.imageMaterialId || card.occlusions.length === 0 || !loadImage) continue;
          let fileName = mediaNames.get(card.imageMaterialId);
          if (!fileName) {
            const image = await loadImage(card.imageMaterialId);
            if (!image) continue; // immagine eliminata: la card non si può esportare
            fileName = `ankix-${card.imageMaterialId}.${imageExtension(image.mimeType)}`;
            const index = String(Object.keys(mediaMap).length);
            mediaFiles[index] = image.bytes;
            mediaMap[index] = fileName;
            mediaNames.set(card.imageMaterialId, fileName);
          }
          const occlusion = occlusionField(card);
          const comments = card.occlusions.map((o, i) => `c${i + 1}: ${o.label}`).join("<br>");
          const tags = exportTags(deck, card);
          const noteId = nextId++;
          noteStmt.run([
            noteId,
            guidFor(card.id),
            OCCLUSION_MODEL_ID,
            nowSec,
            tags.length ? ` ${tags.join(" ")} ` : "",
            [occlusion, `<img src="${fileName}">`, card.front, card.extra, comments].join("\x1f"),
            stripHtml(occlusion),
            checksum(stripHtml(occlusion)),
          ]);
          for (let ord = 0; ord < card.occlusions.length; ord++) {
            cardStmt.run([nextId++, noteId, deckId, ord, nowSec, due]);
          }
          due++;
          continue;
        }
        const isCloze = card.type === "cloze";
        const ords = isCloze ? clozeNumbers(card.front).map((n) => n - 1) : [0];
        if (ords.length === 0) continue;
        const fields = isCloze ? [card.front, card.extra] : [card.front, card.back, card.extra];
        const sortField = stripHtml(fields[0]);
        const tags = exportTags(deck, card);
        const noteId = nextId++;
        noteStmt.run([
          noteId,
          guidFor(card.id),
          isCloze ? CLOZE_MODEL_ID : BASIC_MODEL_ID,
          nowSec,
          tags.length ? ` ${tags.join(" ")} ` : "",
          fields.join("\x1f"),
          sortField,
          checksum(sortField),
        ]);
        for (const ord of ords) {
          cardStmt.run([nextId++, noteId, deckId, ord, nowSec, due]);
        }
        due++;
      }
    } finally {
      noteStmt.free();
      cardStmt.free();
    }

    const collection = db.export();
    return zipSync({
      "collection.anki2": collection,
      media: strToU8(JSON.stringify(mediaMap)),
      ...mediaFiles,
    });
  } finally {
    db.close();
  }
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export function buildCsv(deck: Deck, cards: Card[]): string {
  const header = ["type", "front", "back", "extra", "tags"].map(csvCell).join(",");
  const rows = cards.map((c) =>
    [
      c.type,
      c.front,
      c.type === "image_occlusion" ? c.occlusions.map((o) => o.label).join("; ") : c.back,
      c.extra,
      exportTags(deck, c).join(" "),
    ]
      .map(csvCell)
      .join(","),
  );
  return "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
}
