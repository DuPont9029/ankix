"use client";

import { Check, FileText, ImageIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fetchMaterial, loadPdfJs } from "@/lib/ai/local/extract";
import type { Material } from "@/lib/types";
import { cn } from "../styles";

// Finestra del materiale mentre il prof lo legge: le pagine vere (PDF, immagini, testo) scorse da una linea
// di scansione. L'AI non comunica a che punto è: l'avanzamento è stimato sul tempo e arriva al 100%
// solo quando le domande sono davvero pronte (resta sull'ultima pagina finché non arrivano).

type ScanPage = { key: string; title: string; label: string; src?: string; text?: string };

/** Pagine mostrate al massimo per ogni PDF, distribuite su tutto il documento */
const MAX_PDF_PAGES = 24;
const TEXT_PAGE_CHARS = 1800;
const PAGE_WIDTH = 420;

function sample(total: number, max: number): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i + 1);
  return Array.from({ length: max }, (_, i) => Math.round(1 + (i * (total - 1)) / (max - 1)));
}

/** Pagine di un materiale, aggiunte una alla volta man mano che sono pronte. */
async function loadPages(m: Material, add: (p: ScanPage) => void, plan: (count: number) => void, alive: () => boolean, urls: string[]) {
  const placeholder = (text: string) => add({ key: `${m.id}:x`, title: m.title, label: m.filename, text });
  let blob: Blob;
  try {
    blob = await fetchMaterial(m.id);
  } catch {
    plan(1);
    placeholder("Preview not available");
    return;
  }
  if (m.mimeType === "application/pdf") {
    try {
      const lib = await loadPdfJs();
      const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
      const picks = sample(doc.numPages, MAX_PDF_PAGES);
      plan(picks.length);
      for (const n of picks) {
        if (!alive()) return;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        add({ key: `${m.id}:${n}`, title: m.title, label: `Page ${n} of ${doc.numPages}`, src: canvas.toDataURL("image/jpeg", 0.75) });
      }
    } catch {
      plan(1);
      placeholder("Preview not available");
    }
    return;
  }
  if (m.mimeType.startsWith("image/")) {
    plan(1);
    const url = URL.createObjectURL(blob);
    urls.push(url);
    add({ key: `${m.id}:img`, title: m.title, label: m.filename, src: url });
    return;
  }
  const text = (await blob.text()).replace(/\n{3,}/g, "\n\n");
  const chunks: string[] = [];
  for (let i = 0; i < text.length && chunks.length < 12; i += TEXT_PAGE_CHARS) chunks.push(text.slice(i, i + TEXT_PAGE_CHARS));
  plan(Math.max(1, chunks.length));
  if (chunks.length === 0) placeholder("Empty file");
  chunks.forEach((c, i) => add({ key: `${m.id}:t${i}`, title: m.title, label: `Page ${i + 1} of ${chunks.length}`, text: c }));
}

export function MaterialScanner({ materials, done, onComplete }: { materials: Material[]; done: boolean; onComplete: () => void }) {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [planned, setPlanned] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  // Pagine lette (con la frazione della pagina corrente)
  const [pos, setPos] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  });

  useEffect(() => {
    let alive = true;
    const urls: string[] = [];
    (async () => {
      for (const m of materials) {
        if (!alive) break;
        await loadPages(
          m,
          (p) => alive && setPages((list) => [...list, p]),
          (count) => alive && setPlanned((x) => ({ ...x, [m.id]: count })),
          () => alive,
          urls,
        );
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [materials]);

  const total = Math.max(1, materials.reduce((sum, m) => sum + (planned[m.id] ?? 1), 0));

  // Velocità: tutto il materiale in circa 25 s + 3 s a pagina (max 2 minuti); quando le domande sono pronte, fino in fondo in un attimo.
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let finished = false;
    const seconds = Math.min(120, 25 + 3 * total);
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setPos((p) => {
        const end = done ? total : Math.min(pages.length, total) - 0.02;
        const speed = done ? 1 / 90 : total / (seconds * 1000);
        const next = Math.min(Math.max(p, 0) + dt * speed, Math.max(end, 0));
        if (done && next >= total && !finished) {
          finished = true;
          setTimeout(() => completeRef.current(), 600);
        }
        return next;
      });
      if (!finished) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [done, total, pages.length]);

  const index = Math.min(Math.floor(pos), pages.length - 1);
  const page = pages[index];
  const fraction = done && pos >= total ? 1 : pos - Math.floor(pos);
  const atEnd = !loading && pos >= pages.length - 0.05 && !done;
  const percent = done && pos >= total ? 100 : Math.min(95, Math.round((pos / total) * 95));

  // La miniatura della pagina corrente resta visibile.
  useEffect(() => {
    strip.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [index]);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card text-left shadow-raised">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
          {page?.src && !page.label.startsWith("Page") ? <ImageIcon className="size-4 shrink-0 text-ink-muted" /> : <FileText className="size-4 shrink-0 text-ink-muted" />}
          <span className="truncate">{page?.title ?? materials[0]?.title}</span>
        </span>
        <span className="shrink-0 text-xs text-ink-muted tabular-nums">{page?.label ?? "Opening…"}</span>
      </div>

      <div className="relative grid h-[360px] place-items-center bg-sunken p-4 sm:h-[440px]">
        {page ? (
          <div className="relative h-full max-w-full overflow-hidden rounded-[3px] bg-white shadow-raised" style={{ aspectRatio: page.src ? undefined : "1 / 1.414" }}>
            {page.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- pagina renderizzata nel browser (data/blob URL)
              <img src={page.src} alt={page.label} className="block h-full w-auto max-w-full object-contain" />
            ) : (
              <p className="h-full overflow-hidden p-5 font-serif text-[10px] leading-[1.45] whitespace-pre-wrap text-neutral-700">{page.text}</p>
            )}
            {/* parte già letta e linea di scansione */}
            <div className="pointer-events-none absolute inset-x-0 top-0 bg-primary/10" style={{ height: `${fraction * 100}%` }} />
            <div
              className={cn("pointer-events-none absolute inset-x-0 h-0.5 bg-primary shadow-[0_0_14px_4px_var(--c-primary)]", atEnd && "animate-pulse")}
              style={{ top: `${fraction * 100}%` }}
            />
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Opening the materials…</p>
        )}
      </div>

      {pages.length > 1 && (
        <div ref={strip} className="flex gap-1.5 overflow-x-auto border-t border-line px-3 py-2.5">
          {pages.map((p, i) => (
            <div
              key={p.key}
              data-index={i}
              className={cn(
                "relative h-14 w-10 shrink-0 overflow-hidden rounded-[2px] border bg-white",
                i === index ? "border-primary ring-1 ring-primary" : "border-line",
                i > index && "opacity-50",
              )}
            >
              {p.src ? (
                // eslint-disable-next-line @next/next/no-img-element -- miniatura generata nel browser
                <img src={p.src} alt="" className="size-full object-cover object-top" />
              ) : (
                <span className="block p-0.5 text-[3px] leading-[4px] text-neutral-500">{p.text?.slice(0, 300)}</span>
              )}
              {i < index && (
                <span className="absolute right-0.5 bottom-0.5 grid size-3.5 place-items-center rounded-full bg-primary text-on-primary">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-line px-4 py-3">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-semibold text-ink">
            {done && pos >= total ? "Questions ready" : atEnd ? "The professor is writing the questions…" : "The professor is reading the materials…"}
          </span>
          <span className="text-ink-muted tabular-nums">{percent}%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
    </div>
  );
}
