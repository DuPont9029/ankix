// Strumenti per registrare l'app vera nel sandbox: browser, cursore visibile, screencast con tagli.
import { chromium } from "playwright-core";
import { homedir } from "node:os";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BASE = "http://localhost:3100";
/** Cartella di lavoro: copia dell'app, asset generati, registrazioni (esclusa da git). */
export const WORK = process.env.TRAILER_WORK ?? fileURLToPath(new URL("../work", import.meta.url));
const exe = process.env.CHROME_PATH || `${homedir()}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

export function totp(secret, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, "0");
}

const CURSOR = `
(() => {
  if (window.__cursor) return;
  window.__cursor = true;
  const add = () => {
    const st = document.createElement('style');
    st.textContent = 'nextjs-portal{display:none!important}';
    document.documentElement.appendChild(st);
    const c = document.createElement('div');
    c.id = '__cur';
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 3 6.8 3.1-1.4-3-6.7h6.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 3px 4px rgba(0,0,0,.35))', transition: 'transform 0s' });
    document.documentElement.appendChild(c);
    const r = document.createElement('div');
    Object.assign(r.style, { position: 'fixed', width: '44px', height: '44px', margin: '-22px 0 0 -22px', borderRadius: '50%', border: '3px solid #14b8a6', zIndex: 2147483646, pointerEvents: 'none', opacity: '0', left: '0', top: '0' });
    document.documentElement.appendChild(r);
    const pos = window.__curPos || { x: -100, y: -100 };
    const place = (x, y, s = 1) => { c.style.transform = 'translate(' + (x - 5) + 'px,' + (y - 3) + 'px) scale(' + s + ')'; };
    place(pos.x, pos.y);
    addEventListener('mousemove', (e) => { window.__curPos = { x: e.clientX, y: e.clientY }; place(e.clientX, e.clientY); sessionStorage.setItem('__curPos', JSON.stringify(window.__curPos)); }, true);
    addEventListener('mousedown', (e) => {
      place(e.clientX, e.clientY, 0.85);
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px';
      r.animate([{ opacity: 0.9, transform: 'scale(.3)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 450, easing: 'ease-out' });
    }, true);
    addEventListener('mouseup', (e) => place(e.clientX, e.clientY, 1), true);
  };
  try { window.__curPos = JSON.parse(sessionStorage.getItem('__curPos') || 'null') || undefined; } catch {}
  if (document.documentElement) add(); else addEventListener('DOMContentLoaded', add);
})();`;

export async function launch({ audio } = {}) {
  const args = ["--window-size=1280,800", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"];
  if (audio) args.push(`--use-file-for-fake-audio-capture=${audio}`);
  const browser = await chromium.launch({ executablePath: exe, args });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    locale: "en-GB",
    timezoneId: "Europe/London",
    permissions: ["microphone"],
    acceptDownloads: true,
  });
  await context.addInitScript(CURSOR);
  // OAuth: invece della pagina di Google si torna subito al callback dell'app (il token è simulato dal sandbox).
  await context.route("https://accounts.google.com/**", (route) => {
    const u = new URL(route.request().url());
    const back = new URL(u.searchParams.get("redirect_uri"));
    back.searchParams.set("state", u.searchParams.get("state"));
    back.searchParams.set("code", "trailer-code");
    route.fulfill({ status: 302, headers: { location: back.href } });
  });
  const page = await context.newPage();
  return { browser, context, page };
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export async function moveTo(page, target, ms = 700) {
  let x, y;
  if (typeof target === "object" && "x" in target) ({ x, y } = target);
  else {
    const loc = typeof target === "string" ? page.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    x = b.x + b.width / 2;
    y = b.y + b.height / 2;
  }
  const from = (await page.evaluate(() => window.__curPos)) || { x: 1100, y: 700 };
  const steps = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= steps; i++) {
    const p = ease(i / steps);
    await page.mouse.move(from.x + (x - from.x) * p, from.y + (y - from.y) * p);
    await page.waitForTimeout(ms / steps);
  }
  return { x, y };
}
export async function click(page, target, ms) {
  await moveTo(page, target, ms);
  await page.waitForTimeout(120);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}
export async function type(page, text, delay = 55) {
  await page.keyboard.type(text, { delay });
}

/** Screencast CDP: fotogrammi JPEG con timestamp; mark() annota i punti da tagliare o da usare nel montaggio. */
export async function startClip(page, name) {
  const dir = `${WORK}/clips/${name}`;
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const marks = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", async (f) => {
    const i = frames.length;
    const file = `${dir}/${String(i).padStart(6, "0")}.jpg`;
    writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: f.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 2560, maxHeight: 1600, everyNthFrame: 1 });
  return {
    mark: (label) => marks.push({ label, t: Date.now() / 1000 }),
    async stop() {
      await page.waitForTimeout(300);
      await cdp.send("Page.stopScreencast").catch(() => {});
      writeFileSync(`${dir}/clip.json`, JSON.stringify({ frames, marks, start: t0 / 1000 }, null, 1));
      return { frames: frames.length, marks };
    },
  };
}
