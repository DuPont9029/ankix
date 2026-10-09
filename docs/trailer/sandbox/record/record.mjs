// Registra l'app vera nel sandbox, scena per scena. Le attese sono marcate "cut" per il montaggio.
//   node record.mjs [scena...]   (senza argomenti: tutte)
import { writeFileSync } from "node:fs";
import { launch, BASE, WORK, click, moveTo, type, totp, startClip } from "./rec-lib.mjs";

const A = `${WORK}/assets`;
const DAY = 86400000;
const only = process.argv.slice(2);
const { browser, context, page } = await launch({ audio: `${A}/answer.wav` });
page.setDefaultTimeout(30000);
const state = {};

async function scene(name, fn) {
  if (only.length && !only.includes(name)) return;
  console.log(`▶ ${name}`);
  const clip = await startClip(page, name);
  const cut = async (label, wait) => { clip.mark(`cut:${label}`); await wait(); clip.mark(`end:${label}`); };
  try {
    await fn({ mark: clip.mark, cut });
  } catch (err) {
    await page.screenshot({ path: `${WORK}/fail-${name}.png` });
    throw err;
  } finally {
    console.log(`  ${JSON.stringify(await clip.stop())}`);
  }
}
const pause = (ms) => page.waitForTimeout(ms);
const toast = (re) => page.locator("[data-sonner-toast]").filter({ hasText: re }).first().waitFor({ timeout: 60000 });

// ── 1. Registrazione
await scene("auth", async ({ cut }) => {
  await page.goto(`${BASE}/login`);
  await pause(1200);
  await click(page, page.getByRole("button", { name: /Continue with Google/ }), 900);
  await cut("oauth", () => page.waitForURL(/\/welcome/));
  await pause(900);
  await click(page, page.locator("#code"), 700);
  await type(page, totp("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"), 140);
  await pause(400);
  await click(page, page.getByRole("button", { name: /^Continue/ }), 600);
  await cut("join", () => page.waitForURL((u) => u.pathname === "/"));
  await pause(2200);
});

// ── 2. Materiali (con file privato)
await scene("materials", async ({ cut }) => {
  await page.goto(`${BASE}/materials`);
  await pause(900);
  await click(page, page.getByRole("button", { name: /Upload materials/ }).first(), 800);
  await pause(600);
  const chooser = page.waitForEvent("filechooser");
  await click(page, page.getByText("Drop files here or click to choose them"), 700);
  await (await chooser).setFiles([`${A}/Renal_physiology_lecture7.pdf`, `${A}/Nephron_plate.png`]);
  await pause(700);
  const subjects = page.getByRole("combobox", { name: "Subject", exact: true });
  await subjects.nth(0).selectOption("Physiology");
  await subjects.nth(1).selectOption("Anatomy");
  await pause(500);
  await click(page, page.getByRole("button", { name: /^Upload \(/ }), 700);
  await cut("upload", () => toast(/uploaded/));
  await pause(1200);
  // secondo caricamento: appunti personali, solo per me
  await click(page, page.getByRole("button", { name: /Upload materials/ }).first(), 700);
  const chooser2 = page.waitForEvent("filechooser");
  await click(page, page.getByText("Drop files here or click to choose them"), 600);
  await (await chooser2).setFiles([`${A}/ADH_summary.md`]);
  await pause(500);
  await page.getByRole("combobox", { name: "Subject", exact: true }).first().selectOption("Physiology");
  await click(page, page.getByText("Only me", { exact: true }), 700);
  await pause(500);
  await click(page, page.getByRole("button", { name: /^Upload \(/ }), 600);
  await cut("upload2", () => toast(/uploaded/));
  await pause(1500);
  await moveTo(page, page.getByText("Private", { exact: true }).first(), 800);
  await pause(1500);
});

// ── 3. Motore AI: chiave Gemini (finta) e motore predefinito
await scene("settings", async ({ cut }) => {
  await page.goto(`${BASE}/settings`);
  await pause(900);
  await page.locator("#gemini-key").scrollIntoViewIfNeeded();
  await click(page, page.locator("#gemini-key"), 700);
  await type(page, "AIzaSyTrailer-Sandbox-Key-0000000000", 25);
  await click(page, page.getByRole("button", { name: "Verify and save" }).first(), 600);
  await cut("verify", () => toast(/key verified and saved/));
  await pause(800);
  const radio = page.getByRole("radiogroup", { name: "AI engine" }).getByRole("radio", { name: /Google Gemini/ });
  await radio.scrollIntoViewIfNeeded();
  await click(page, radio, 800);
  await toast(/default AI engine/);
  await pause(1500);
});

// ── 4. Generazione del mazzo
await scene("generate", async ({ cut }) => {
  await page.goto(`${BASE}/generate`);
  await pause(900);
  await click(page, page.getByRole("button", { name: /Renal physiology/ }).first(), 700);
  await click(page, page.getByRole("button", { name: /ADH summary/ }).first(), 600);
  await click(page, page.getByRole("button", { name: "40", exact: true }), 700);
  await click(page, page.getByRole("radiogroup", { name: "Language" }).getByRole("radio", { name: /^English/ }), 700);
  const focus = page.getByPlaceholder(/E\.g\. focus on/);
  await focus.scrollIntoViewIfNeeded();
  await click(page, focus, 600);
  await type(page, "Renal physiology only, skip the history", 35);
  await pause(400);
  const submit = page.getByRole("button", { name: /^Generate \d+ flashcards/ });
  await submit.scrollIntoViewIfNeeded();
  await click(page, submit, 800);
  await page.waitForURL(/\/decks\//);
  state.deckUrl = page.url();
  await pause(1500);
  await cut("generation", () => page.getByText("Status: ready").first().waitFor({ timeout: 90000 }));
  await pause(1500);
  await page.mouse.wheel(0, 500);
  await pause(1200);
  await page.mouse.wheel(0, 500);
  await pause(1500);
});

// ── 5. Image occlusion
await scene("occlusion", async ({ cut }) => {
  await page.goto(`${BASE}/generate`);
  await pause(800);
  await click(page, page.getByRole("button", { name: /Nephron plate/ }).first(), 700);
  await click(page, page.getByRole("radiogroup", { name: "Format" }).getByRole("radio", { name: /^Image/ }), 700);
  await click(page, page.getByRole("radiogroup", { name: "Language" }).getByRole("radio", { name: /^English/ }), 600);
  const submit = page.getByRole("button", { name: /Generate image occlusion/ });
  await submit.scrollIntoViewIfNeeded();
  await click(page, submit, 700);
  await page.waitForURL(/\/decks\//);
  state.occUrl = page.url();
  await cut("generation", () => page.getByText("Status: ready").first().waitFor({ timeout: 90000 }));
  await pause(800);
  await page.locator("article").filter({ hasText: /IMAGE OCCLUSION/i }).first().scrollIntoViewIfNeeded();
  await pause(2500);
});

// ── semina dello storico (non registrata): 3 settimane di ripassi con l'orologio del server spostato
if (!only.length || only.includes("seed")) {
  console.log("▶ seed");
  const clock = `${WORK}/clock.txt`;
  const base = new Date();
  base.setHours(18, 30, 0, 0);
  let seeded = 0;
  const seen = new Map();
  let introduced = 0; // card nuove già viste: ne restano un po' per il percorso di oggi
  for (let d = -21; d <= -1; d++) {
    if (d === -12) continue; // un giorno di riposo
    const offset = base.getTime() + d * DAY - Date.now();
    writeFileSync(clock, String(offset));
    await pause(350);
    const plan = await (await context.request.get(`${BASE}/api/study/plan`)).json();
    let items = (plan.items ?? []).filter((it) => it.stage !== "new" || introduced++ < 26).slice(0, 40);
    for (const it of items) seen.set(it.key, it);
    // Giorno senza scadenze: si ripassano comunque alcune card già viste, così lo storico non ha buchi.
    if (items.length < 6) items = [...items, ...[...seen.values()].filter((it) => !items.includes(it)).sort(() => Math.random() - 0.5).slice(0, 8 - items.length)];
    if (!items.length) continue;
    const now = Date.now() + offset;
    const reviews = items.map((it, i) => ({
      id: crypto.randomUUID(),
      key: it.key,
      cardId: it.card.id,
      deckId: it.deckId,
      // negli ultimi giorni qualche "Again" in più, così oggi ci sono ripassi da fare
      rating: (d >= -2 && i % 2 === 0) || i % 11 === 5 ? 1 : i % 7 === 3 ? 4 : i % 9 === 4 ? 2 : 3,
      durationMs: 5000 + ((i * 3797) % 9000),
      reviewedAt: now - (items.length - i) * 20000,
    }));
    const res = await context.request.post(`${BASE}/api/study/reviews`, { data: { reviews } });
    seeded += (await res.json()).saved ?? 0;
  }
  writeFileSync(clock, "0");
  await pause(400);
  console.log(`  reviews seeded: ${seeded}`);
}

// ── 6. Calendario e percorso di oggi
await scene("plan", async () => {
  await page.goto(`${BASE}/plan`);
  await page.getByText("Loading…").first().waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
  await pause(2500);
  await page.mouse.wheel(0, 180);
  await pause(2000);
});

await scene("today", async () => {
  await page.goto(`${BASE}/today`);
  await pause(1200);
  await click(page, page.getByRole("button", { name: /today's path/i }).first(), 800);
  await pause(1200);
  for (const key of ["3", "3", "1", "4", "3", "3"]) {
    const show = page.getByRole("button", { name: "Show answer" }).last();
    if (!(await show.isVisible().catch(() => false))) break;
    await click(page, show, 600);
    await pause(1100);
    const label = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" }[key];
    await click(page, page.getByRole("button", { name: new RegExp(`^${label}`) }).first(), 600);
    await pause(900);
  }
  await pause(800);
});

// ── 7. Mappe
await scene("map", async ({ cut }) => {
  await page.goto(`${state.deckUrl ?? `${BASE}/decks`}/map`);
  await pause(1200);
  const engine = page.getByRole("radiogroup", { name: "AI engine" }).getByRole("radio", { name: /Google Gemini/ });
  if (await engine.count()) await click(page, engine.first(), 700);
  await click(page, page.getByRole("button", { name: /Create the maps/ }), 700);
  await cut("maps", () => page.getByRole("tab", { name: "Mind map" }).waitFor().then(() => page.getByText(/Drag to move|Read each arrow/).first().waitFor({ timeout: 90000 })));
  await pause(2500);
  await click(page, page.getByRole("tab", { name: "Concept map" }), 800);
  await pause(2500);
  await click(page, page.getByRole("button", { name: "Linking words" }), 800);
  await pause(1500);
  const q = page.locator("svg text").filter({ hasText: "?" }).first();
  if (await q.count()) {
    await click(page, q, 800);
    await pause(700);
    const reveal = page.getByRole("button", { name: "Show answer" });
    if (await reveal.count()) {
      await click(page, reveal.first(), 700);
      await pause(2200);
    }
  }
  await pause(1000);
});

// ── 8. Esame orale
await scene("exam", async ({ cut }) => {
  await page.goto(`${BASE}/exam`);
  await pause(1000);
  await click(page, page.getByRole("button", { name: /Renal physiology/ }).first(), 700);
  await click(page, page.getByRole("radiogroup", { name: "Number of questions" }).getByRole("radio", { name: "2", exact: true }), 600);
  await click(page, page.getByRole("radiogroup", { name: "Language" }).getByRole("radio", { name: /^English/ }), 600);
  const tr = page.getByRole("radiogroup", { name: "Transcription engine" }).getByRole("radio", { name: /Google Gemini/ });
  await tr.scrollIntoViewIfNeeded();
  await click(page, tr, 600);
  const enter = page.getByRole("button", { name: /Enter the exam room/ });
  await enter.scrollIntoViewIfNeeded();
  await click(page, enter, 700);
  await cut("questions", () => page.getByRole("button", { name: "Start answering" }).waitFor({ timeout: 90000 }));
  await pause(2500);
  for (let q = 0; q < 2; q++) {
    await click(page, page.getByRole("button", { name: "Start answering" }), 700);
    await pause(5500);
    await click(page, page.getByRole("button", { name: q === 0 ? "Next question" : "Finish and evaluate" }), 700);
    if (q === 0) {
      await page.getByRole("button", { name: "Start answering" }).waitFor();
      await pause(2200);
    }
  }
  await pause(2500);
  await cut("grading", () => page.waitForURL(/\/exam\/[^/]+$/, { timeout: 120000 }));
  await pause(2500);
  await page.mouse.wheel(0, 450);
  await pause(2000);
  await page.mouse.wheel(0, 450);
  await pause(1800);
});

// ── 9. Mazzo pubblico ed export
await scene("export", async () => {
  await page.goto(state.deckUrl ?? `${BASE}/decks`);
  await pause(1200);
  await click(page, page.getByRole("switch", { name: "Make deck public" }), 900);
  await toast(/Deck is public/);
  await pause(1200);
  const download = page.waitForEvent("download");
  await click(page, page.getByText("Export to Anki (.apkg)").first(), 800);
  const file = await download;
  await file.saveAs(`${WORK}/export.apkg`);
  await pause(2000);
});

// ── 10. Dashboard finale
await scene("dashboard", async () => {
  await page.goto(`${BASE}/`);
  await pause(2500);
  await page.mouse.wheel(0, 350);
  await pause(2500);
});

await browser.close();
writeFileSync(`${WORK}/clips/state.json`, JSON.stringify(state));
console.log("done");
