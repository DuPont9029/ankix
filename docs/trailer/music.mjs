// Colonna sonora del trailer, sintetizzata da zero (nessun campione esterno).
// Legge la timeline da trailer.html (BAR e BARS) così i tagli cadono sulle battute.
//   node music.mjs trailer.html music.wav
import { readFileSync, writeFileSync } from "node:fs";

const [htmlPath, outPath] = process.argv.slice(2);
const html = readFileSync(htmlPath, "utf8");
const BAR = +html.match(/const BAR = ([\d.]+)/)[1];
const BARS = JSON.parse(html.match(/const BARS = (\[[^\]]+\])/)[1]);
const IDS = JSON.parse(html.match(/const IDS = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
const startBar = {}; { let b = 0; IDS.forEach((id, i) => { startBar[id] = b; b += BARS[i]; }); }
const TOTAL_BARS = BARS.reduce((a, b) => a + b, 0);

const SR = 48000, BEAT = BAR / 4, LEN = Math.ceil((TOTAL_BARS * BAR + 0.2) * SR);
const L = new Float32Array(LEN), R = new Float32Array(LEN);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
const at = (sec) => Math.floor(sec * SR);
let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

const B = (id) => startBar[id];
const FULL_FROM = B("s-auth"), FULL_TO = B("s-priv"), HATS_FROM = B("s-ai"), CLAP_FROM = B("s-gen"), END = B("s-end");

// accordi: una battuta ciascuno (Fmaj9 · Am7 · Cadd9 · G6)
const CHORDS = [[53, 57, 60, 64, 67], [57, 60, 64, 67, 71], [48, 55, 60, 62, 64], [55, 59, 62, 64, 67]];
const ROOTS = [41, 45, 48, 43];
const chordAt = (bar) => (bar >= END ? 0 : bar % 4);

// ── pad: oscillatori leggermente scordati, brillantezza che si apre dopo l'apertura
function pad() {
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    const notes = CHORDS[chordAt(bar)], t0 = bar * BAR, last = bar === END;
    const dur = last ? (TOTAL_BARS - END) * BAR : BAR + 0.6;
    const harm = bar < B("s-logo") ? 3 : bar < FULL_FROM ? 5 : 7;
    const vol = bar < B("s-logo") ? 0.05 : bar >= FULL_TO && bar < END ? 0.06 : 0.045;
    for (const [k, m] of notes.entries()) {
      const f = hz(m + 12 * (k === 0 ? 0 : 0));
      for (let i = at(t0), e = Math.min(LEN, at(t0 + dur)); i < e; i++) {
        const t = (i - at(t0)) / SR;
        const env = Math.min(1, t / 0.5) * Math.min(1, (dur - t) / (last ? 4.5 : 0.7));
        let sl = 0, sr = 0;
        for (let h = 1; h <= harm; h++) {
          const a = 1 / Math.pow(h, 1.6);
          sl += a * Math.sin(2 * Math.PI * f * h * 0.9977 * t + k);
          sr += a * Math.sin(2 * Math.PI * f * h * 1.0023 * t + k * 2);
        }
        L[i] += sl * env * vol; R[i] += sr * env * vol;
      }
    }
  }
}

// ── basso: radice per battuta, "pompa" dopo ogni cassa
function bass() {
  for (let bar = FULL_FROM; bar < FULL_TO; bar++) {
    const f = hz(ROOTS[chordAt(bar)] - 12);
    for (let i = at(bar * BAR), e = at((bar + 1) * BAR); i < e; i++) {
      const t = i / SR - bar * BAR, inBeat = (t % BEAT) / BEAT;
      const duck = 0.35 + 0.65 * Math.min(1, inBeat * 3);
      const v = (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * 0.11 * duck * Math.min(1, t / 0.05);
      L[i] += v; R[i] += v;
    }
  }
}

// ── arpeggio pizzicato a crome
function pluck(t0, m, vol, pan) {
  const f = hz(m);
  for (let i = at(t0), e = Math.min(LEN, at(t0 + 0.9)); i < e; i++) {
    const t = i / SR - t0, env = Math.exp(-t * 7) * Math.min(1, t / 0.004);
    const v = (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 12)) * env * vol;
    L[i] += v * (1 - pan); R[i] += v * pan;
  }
}
function arp() {
  const PAT = [0, 2, 4, 1, 3, 2, 4, 1];
  for (let bar = 0; bar < FULL_TO; bar++) {
    const notes = CHORDS[chordAt(bar)];
    if (bar < FULL_FROM) { // apertura: poche note sospese
      if (bar >= B("s-logo")) continue;
      [0, 3].forEach((k, j) => pluck(bar * BAR + k * BEAT * 1.5, notes[(bar + j * 2) % 5] + 12, 0.07, j ? 0.7 : 0.3));
      continue;
    }
    for (let s = 0; s < 8; s++) pluck(bar * BAR + s * BEAT / 2, notes[PAT[s]] + 12, s % 2 ? 0.045 : 0.06, s % 2 ? 0.72 : 0.28);
  }
}

// ── batteria
function kick(t0, vol = 0.55) {
  for (let i = at(t0), e = Math.min(LEN, at(t0 + 0.45)); i < e; i++) {
    const t = i / SR - t0;
    const ph = 2 * Math.PI * (48 * t + (110 / 35) * (1 - Math.exp(-t * 35)));
    const v = Math.sin(ph) * Math.exp(-t * 8) * vol; L[i] += v; R[i] += v;
  }
}
function noiseHit(t0, dur, vol, hp, pan = 0.5) {
  let prev = 0, lp = 0;
  for (let i = at(t0), e = Math.min(LEN, at(t0 + dur)); i < e; i++) {
    const t = i / SR - t0, n = rnd();
    const h = n - prev; prev = n; // passa-alto grezzo
    lp += (h - lp) * hp;
    const v = lp * Math.exp(-t * (6 / dur)) * vol; L[i] += v * (1 - pan) * 2; R[i] += v * pan * 2;
  }
}
function drums() {
  for (let bar = FULL_FROM; bar < FULL_TO; bar++) {
    for (let b = 0; b < 4; b++) {
      const t = bar * BAR + b * BEAT;
      if (bar < FULL_FROM + 2 && b % 2) continue; // entrata a metà tempo
      kick(t);
      if (bar >= HATS_FROM) noiseHit(t + BEAT / 2, 0.06, 0.05, 0.9, b % 2 ? 0.65 : 0.35);
      if (bar >= CLAP_FROM && b % 2) noiseHit(t, 0.18, 0.09, 0.35);
    }
  }
}

// ── transizioni: soffio che sale verso ogni taglio, colpo sui due momenti chiave
function whoosh(tEnd, dur = 0.6, vol = 0.05) {
  let lp = 0;
  for (let i = at(tEnd - dur), e = at(tEnd + 0.08); i < e; i++) {
    const t = i / SR - (tEnd - dur), p = Math.min(1, t / dur);
    lp += (rnd() - lp) * (0.02 + 0.3 * p);
    const v = lp * p * p * vol * (i > at(tEnd) ? Math.max(0, 1 - (i - at(tEnd)) / (0.08 * SR)) : 1);
    L[i] += v * (1 - p * 0.4); R[i] += v * (0.6 + p * 0.4);
  }
}
function impact(t0, vol = 0.5) {
  for (let i = at(t0), e = Math.min(LEN, at(t0 + 3)); i < e; i++) {
    const t = i / SR - t0, v = Math.sin(2 * Math.PI * (40 * t + 2 * (1 - Math.exp(-t * 20)))) * Math.exp(-t * 1.6) * vol;
    L[i] += v; R[i] += v;
  }
  noiseHit(t0, 1.2, 0.12, 0.08);
  whoosh(t0, 1.6, 0.09);
}

pad(); bass(); arp(); drums();
impact(B("s-logo") * BAR, 0.5);
impact(END * BAR, 0.45);
for (let k = B("s-auth"); k <= FULL_TO; k++) if (Object.values(startBar).includes(k)) whoosh(k * BAR);

// ── uscita: normalizzazione morbida, dissolvenza, WAV 16 bit
let peak = 0; for (let i = 0; i < LEN; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
const g = 0.89 / peak, fadeOut = at(TOTAL_BARS * BAR - 2.5);
const buf = Buffer.alloc(44 + LEN * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + LEN * 4, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(LEN * 4, 40);
for (let i = 0; i < LEN; i++) {
  const f = (i > fadeOut ? Math.max(0, 1 - (i - fadeOut) / (2.5 * SR)) : 1) * Math.min(1, i / (0.8 * SR));
  const s = (x) => Math.round(Math.tanh(x * g * f * 1.1) * 32767);
  buf.writeInt16LE(s(L[i]), 44 + i * 4); buf.writeInt16LE(s(R[i]), 46 + i * 4);
}
writeFileSync(outPath, buf);
console.log(`ok · ${TOTAL_BARS} battute · ${(LEN / SR).toFixed(1)} s`);
