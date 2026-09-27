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
  };
}

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

export async function buildApkg(deck: Deck, cards: Card[]): Promise<Uint8Array> {
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
    try {
      for (const card of cards) {
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
      media: strToU8("{}"),
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
    [c.type, c.front, c.back, c.extra, exportTags(deck, c).join(" ")].map(csvCell).join(","),
  );
  return "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
}
