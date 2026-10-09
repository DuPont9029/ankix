import { chromium } from "playwright-core";
import { homedir } from "node:os";
const exe = process.env.CHROME_PATH || `${homedir()}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage();
await p.goto(`file://${process.argv[2]}`);
await p.pdf({ path: process.argv[3], width: "297mm", height: "210mm", printBackground: true });
await b.close();
