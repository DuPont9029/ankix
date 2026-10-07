"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/ui";
import type { Box } from "@/lib/mindmap";

// Superficie comune alle mappe: spostamento (trascinando lo sfondo), zoom (rotella o pulsanti), adattamento
// allo schermo, trascinamento dei nodi ed esportazione in SVG.

type View = { x: number; y: number; k: number };

export type SurfaceHandle = {
  fit: () => void;
  /** SVG autonomo (colori risolti) per l'esportazione */
  exportSvg: () => string | null;
};

/** Punto sul bordo del riquadro `b` nella direzione di (tx, ty). */
export function edgePoint(b: Box, tx: number, ty: number) {
  const dx = tx - b.x;
  const dy = ty - b.y;
  if (dx === 0 && dy === 0) return { x: b.x, y: b.y };
  const s = Math.max(Math.abs(dx) / (b.w / 2 + 3), Math.abs(dy) / (b.h / 2 + 3));
  return { x: b.x + dx / s, y: b.y + dy / s };
}

export type NodeHandlers = (id: string) => {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: (e: ReactPointerEvent) => void;
};

function bounds(boxes: Map<string, Box>) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes.values()) {
    x0 = Math.min(x0, b.x - b.w / 2);
    x1 = Math.max(x1, b.x + b.w / 2);
    y0 = Math.min(y0, b.y - b.h / 2);
    y1 = Math.max(y1, b.y + b.h / 2);
  }
  return { x0, y0, x1, y1 };
}

export const Surface = forwardRef<
  SurfaceHandle,
  {
    layout: Map<string, Box>;
    /** Cambiando questa chiave la vista si riadatta allo schermo */
    fitKey: string;
    draggable?: boolean;
    onSelect: (id: string | null) => void;
    /** Un nodo è stato trascinato: posizioni finali di tutti i nodi */
    onMove?: (id: string, all: Map<string, { x: number; y: number }>) => void;
    label: string;
    className?: string;
    defs?: ReactNode;
    children: (boxes: Map<string, Box>, node: NodeHandlers) => ReactNode;
  }
>(function Surface({ layout, fitKey, draggable = false, onSelect, onMove, label, className, defs, children }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const gesture = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  const boxes = useMemo(() => {
    if (!drag) return layout;
    const out = new Map(layout);
    const b = out.get(drag.id);
    if (b) out.set(drag.id, { ...b, x: drag.x, y: drag.y });
    return out;
  }, [layout, drag]);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || layout.size === 0) return;
    const { x0, y0, x1, y1 } = bounds(layout);
    const { width, height } = el.getBoundingClientRect();
    const pad = 32;
    const k = Math.min((width - pad * 2) / Math.max(1, x1 - x0), (height - pad * 2) / Math.max(1, y1 - y0), 1.3);
    setView({ k, x: width / 2 - ((x0 + x1) / 2) * k, y: height / 2 - ((y0 + y1) / 2) * k });
  }, [layout]);

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambio di mappa o di numero di nodi
  }, [fitKey]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Zoom con la rotella attorno al puntatore (listener non passivo per bloccare lo scroll della pagina).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      setView((v) => {
        const k = Math.min(Math.max(v.k * factor, 0.15), 3);
        return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const zoomBy = (factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(Math.max(v.k * factor, 0.15), 3);
      return { k, x: width / 2 - ((width / 2 - v.x) * k) / v.k, y: height / 2 - ((height / 2 - v.y) * k) / v.k };
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      fit,
      exportSvg: () => {
        const svg = svgRef.current;
        if (!svg || boxes.size === 0) return null;
        const { x0, y0, x1, y1 } = bounds(boxes);
        const pad = 60;
        const w = x1 - x0 + pad * 2;
        const h = y1 - y0 + pad * 2;
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.querySelector("[data-viewport]")?.setAttribute("transform", "");
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("viewBox", `${x0 - pad} ${y0 - pad} ${w} ${h}`);
        clone.setAttribute("width", String(Math.round(w)));
        clone.setAttribute("height", String(Math.round(h)));
        clone.removeAttribute("class");
        // Le variabili CSS non esistono fuori dalla pagina: si sostituiscono con i valori correnti.
        const styles = getComputedStyle(document.documentElement);
        const markup = new XMLSerializer()
          .serializeToString(clone)
          .replace(/var\((--c-[a-z-]+)\)/g, (_m, name: string) => styles.getPropertyValue(name).trim() || "#888");
        const bg = styles.getPropertyValue("--c-card").trim() || "#fff";
        return markup.replace(/<g data-viewport[^>]*>/, (g) => `<rect x="${x0 - pad}" y="${y0 - pad}" width="${w}" height="${h}" fill="${bg}"/>${g}`);
      },
    }),
    [boxes, fit],
  );

  function start(e: ReactPointerEvent, nodeId?: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const b = nodeId ? boxes.get(nodeId) : undefined;
    const dragNode = Boolean(nodeId && draggable && b);
    gesture.current = {
      kind: dragNode ? "node" : "pan",
      id: nodeId,
      sx: e.clientX,
      sy: e.clientY,
      ox: dragNode ? b!.x : view.x,
      oy: dragNode ? b!.y : view.y,
      moved: false,
    };
  }

  function move(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    if (g.kind === "pan") setView((v) => ({ ...v, x: g.ox + dx, y: g.oy + dy }));
    else if (g.id) setDrag({ id: g.id, x: g.ox + dx / view.k, y: g.oy + dy / view.k });
  }

  function end(nodeId?: string) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) {
      onSelect(nodeId ?? null);
      return;
    }
    if (g.kind === "node" && drag && onMove) {
      onMove(drag.id, new Map([...boxes].map(([id, b]) => [id, { x: Math.round(b.x), y: Math.round(b.y) }])));
    }
    setDrag(null);
  }

  const node: NodeHandlers = (id) => ({
    onPointerDown: (e) => start(e, id),
    onPointerUp: (e) => {
      e.stopPropagation();
      end(id);
    },
  });

  return (
    <div
      ref={wrapRef}
      className={cn("relative touch-none overflow-hidden rounded-lg border border-line bg-card shadow-card select-none", className)}
      onPointerDown={(e) => start(e)}
      onPointerMove={move}
      onPointerUp={() => end()}
      onPointerCancel={() => {
        gesture.current = null;
        setDrag(null);
      }}
      style={{ backgroundImage: "radial-gradient(var(--c-line) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
    >
      <svg ref={svgRef} className="absolute inset-0 size-full" role="img" aria-label={label}>
        {defs && <defs>{defs}</defs>}
        <g data-viewport transform={`translate(${view.x} ${view.y}) scale(${view.k})`} style={{ fontFamily: "var(--font-jakarta), system-ui, sans-serif" }}>
          {children(boxes, node)}
        </g>
      </svg>
      <div className="absolute right-3 bottom-3 flex flex-col overflow-hidden rounded-md border border-line bg-card shadow-card" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1.25)} className="grid size-8 cursor-pointer place-items-center text-ink-muted hover:bg-muted hover:text-ink" aria-label="Zoom in">
          <Plus className="size-4" />
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} className="grid size-8 cursor-pointer place-items-center border-t border-line text-ink-muted hover:bg-muted hover:text-ink" aria-label="Zoom out">
          <Minus className="size-4" />
        </button>
        <button type="button" onClick={fit} className="grid size-8 cursor-pointer place-items-center border-t border-line text-ink-muted hover:bg-muted hover:text-ink" aria-label="Fit to screen">
          <Maximize2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
});
