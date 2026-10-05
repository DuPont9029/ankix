// Lettura dei materiali nel browser per il modello locale: testo, PDF (pdf.js) e immagini (OCR con Tesseract).

const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

type PdfTextItem = { str?: string; transform: number[]; width: number };
type PdfPage = {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(o: { scale: number }): { width: number; height: number; scale: number; transform: number[] };
};
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(n: number): Promise<PdfPage> }> };
};
type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type OcrWorker = { recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; words: OcrWord[] } }> };
declare global {
  interface Window {
    Tesseract?: { createWorker(langs: string): Promise<OcrWorker> };
  }
}

export type LocalMaterial = { id: string; title: string; filename: string; mimeType: string };

let pdfjs: PdfJs | null = null;
async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    pdfjs = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ `${PDFJS}pdf.min.mjs`)) as PdfJs;
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  }
  return pdfjs;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
}

let ocrWorker: Promise<OcrWorker> | null = null;
async function getOcrWorker(): Promise<OcrWorker> {
  if (!ocrWorker) {
    ocrWorker = (async () => {
      if (!window.Tesseract) await loadScript(TESSERACT);
      return window.Tesseract!.createWorker("ita+eng");
    })();
    ocrWorker.catch(() => (ocrWorker = null));
  }
  return ocrWorker;
}

/** Scarica il materiale direttamente dal bucket; se il CORS non lo consente, passando dal server. */
export async function fetchMaterial(id: string): Promise<Blob> {
  try {
    const signed = await fetch(`/api/materials/${id}/content?presign=1`, { cache: "no-store" });
    if (signed.ok) {
      const { url } = (await signed.json()) as { url: string };
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return await res.blob();
    }
  } catch {
    /* CORS non configurato o rete: si ripiega sul server */
  }
  const res = await fetch(`/api/materials/${id}/content`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not download the material (HTTP ${res.status}).`);
  return res.blob();
}

export async function readPdfText(blob: Blob): Promise<string> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((it) => it.str ?? "").join(" "));
  }
  return pages.join("\n\n");
}

const MAX_SIDE = 1600;

/** Disegna l'immagine su un canvas ridimensionato (lato massimo 1600 px). */
export async function imageToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new Error("this browser cannot open the image (HEIC/HEIF images are not supported: convert them to JPG)");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export type OcrBox = { text: string; conf: number; x0: number; y0: number; x1: number; y1: number };

export async function ocr(canvas: HTMLCanvasElement): Promise<{ text: string; words: OcrBox[] }> {
  const { data } = await (await getOcrWorker()).recognize(canvas);
  const words = data.words
    .filter((w) => /[\p{L}\p{N}]/u.test(w.text))
    .map((w) => ({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 }));
  return { text: data.text, words };
}

/** Testo di un materiale: diretto per testo e PDF, con OCR per le immagini. */
export async function materialText(m: LocalMaterial, blob: Blob): Promise<string> {
  if (m.mimeType.startsWith("text/")) return blob.text();
  if (m.mimeType === "application/pdf") {
    const text = await readPdfText(blob);
    if (!/\p{L}{3}/u.test(text)) throw new Error("no text found in the PDF (is it a scan? Upload the pages as images or use a cloud AI)");
    return text;
  }
  if (m.mimeType.startsWith("image/")) return (await ocr(await imageToCanvas(blob))).text;
  throw new Error(`unsupported file type ${m.mimeType}`);
}
