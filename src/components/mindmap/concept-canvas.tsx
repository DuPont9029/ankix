"use client";

import { forwardRef, useMemo } from "react";
import { conceptMapLayout, type ConceptMapData } from "@/lib/conceptmap";
import { edgePoint, Surface, type SurfaceHandle } from "./surface";

export type ConceptSelection = { kind: "concept" | "prop"; id: string } | null;

/** Esercizio: elementi nascosti (concetti o parole-legame) e risultato delle risposte. */
export type Practice = { hidden: Set<string>; results: Record<string, "correct" | "wrong" | "shown"> };

const PROP = "p:";

/**
 * Mappa concettuale: concetti in riquadri disposti a livelli (dal più generale in alto), frecce con la
 * parola-legame a metà, legami trasversali tratteggiati e curvi.
 */
export const ConceptMapCanvas = forwardRef<
  SurfaceHandle,
  {
    data: ConceptMapData;
    selected: ConceptSelection;
    onSelect: (s: ConceptSelection) => void;
    onMove: (id: string, all: Map<string, { x: number; y: number }>) => void;
    practice: Practice | null;
    className?: string;
  }
>(function ConceptMapCanvas({ data, selected, onSelect, onMove, practice, className }, ref) {
  const layout = useMemo(() => conceptMapLayout(data), [data]);
  const isHidden = (id: string) => Boolean(practice?.hidden.has(id) && !practice.results[id]);
  const resultColor = (id: string) => {
    const r = practice?.results[id];
    return r === "correct" ? "var(--c-accent)" : r === "wrong" ? "var(--c-danger)" : r === "shown" ? "var(--c-warning)" : null;
  };
  const selConcept = selected?.kind === "concept" ? selected.id : null;
  const selProp = selected?.kind === "prop" ? data.propositions.find((p) => p.id === selected.id) : undefined;

  return (
    <Surface
      ref={ref}
      layout={layout}
      fitKey={`concept:${data.concepts.length}:${data.propositions.length}`}
      draggable
      onSelect={(id) => onSelect(id ? (id.startsWith(PROP) ? { kind: "prop", id: id.slice(PROP.length) } : { kind: "concept", id }) : null)}
      onMove={onMove}
      label="Concept map"
      className={className}
      defs={
        <>
          <marker id="cm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--c-ink-faint)" />
          </marker>
          <marker id="cm-arrow-cross" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--c-accent)" />
          </marker>
        </>
      }
    >
      {(boxes, handlers) => (
        <>
          {/* frecce */}
          {data.propositions.map((p) => {
            const a = boxes.get(p.from);
            const b = boxes.get(p.to);
            if (!a || !b) return null;
            const p1 = edgePoint(a, b.x, b.y);
            const p2 = edgePoint(b, a.x, a.y);
            const active = selProp?.id === p.id || selConcept === p.from || selConcept === p.to;
            const dim = (selected && !active) || false;
            const color = p.cross ? "var(--c-accent)" : "var(--c-ink-faint)";
            if (p.cross) {
              // Curva: il punto di controllo è spostato di lato rispetto alla retta.
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2;
              const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
              const off = Math.min(80, len * 0.25);
              const cx = mx - ((p2.y - p1.y) / len) * off;
              const cy = my + ((p2.x - p1.x) / len) * off;
              return (
                <path
                  key={p.id}
                  d={`M${p1.x} ${p1.y} Q${cx} ${cy} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={active ? 2.2 : 1.5}
                  strokeDasharray="6 4"
                  markerEnd="url(#cm-arrow-cross)"
                  opacity={dim ? 0.3 : 1}
                />
              );
            }
            return <line key={p.id} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={active ? 2.2 : 1.5} markerEnd="url(#cm-arrow)" opacity={dim ? 0.3 : 1} />;
          })}

          {/* concetti */}
          {data.concepts.map((c) => {
            const b = boxes.get(c.id);
            if (!b) return null;
            const hidden = isHidden(c.id);
            const result = resultColor(c.id);
            const isSel = selConcept === c.id;
            const top = c.level === 0;
            const lineH = top ? 20 : 17;
            const firstY = -((b.lines.length - 1) * lineH) / 2 + 4.5;
            return (
              <g key={c.id} transform={`translate(${b.x} ${b.y})`} {...handlers(c.id)} className="cursor-grab" role="button" aria-label={hidden ? "Hidden concept" : c.label}>
                <rect
                  x={-b.w / 2}
                  y={-b.h / 2}
                  width={b.w}
                  height={b.h}
                  rx={7}
                  fill={hidden ? "var(--c-highlight)" : top ? "var(--c-primary-soft)" : "var(--c-card)"}
                  stroke={isSel ? "var(--c-heading)" : (result ?? (top ? "var(--c-primary)" : "var(--c-line-strong)"))}
                  strokeWidth={isSel ? 2.6 : result ? 2.2 : top ? 1.8 : 1.3}
                />
                <text textAnchor="middle" fontSize={top ? 15 : 12.5} fontWeight={top ? 700 : 600} fill={hidden ? "var(--c-on-highlight)" : "var(--c-heading)"}>
                  {hidden ? (
                    <tspan x={0} y={4.5}>
                      ?
                    </tspan>
                  ) : (
                    b.lines.map((line, i) => (
                      <tspan key={i} x={0} y={firstY + i * lineH}>
                        {line}
                      </tspan>
                    ))
                  )}
                </text>
                {c.cards.length > 0 && !hidden && (
                  <g transform={`translate(${b.w / 2 - 3} ${-b.h / 2 + 2})`}>
                    <circle r={8} fill="var(--c-card)" stroke="var(--c-line-strong)" />
                    <text textAnchor="middle" dy="3.5" fontSize="9" fontWeight={700} fill="var(--c-ink-muted)">
                      {Math.min(c.cards.length, 99)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {/* parole-legame (sopra le frecce, cliccabili) */}
          {data.propositions.map((p) => {
            const a = boxes.get(p.from);
            const b = boxes.get(p.to);
            if (!a || !b) return null;
            const p1 = edgePoint(a, b.x, b.y);
            const p2 = edgePoint(b, a.x, a.y);
            let lx = (p1.x + p2.x) / 2;
            let ly = (p1.y + p2.y) / 2;
            if (p.cross) {
              const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
              const off = Math.min(80, len * 0.25) / 2;
              lx -= ((p2.y - p1.y) / len) * off;
              ly += ((p2.x - p1.x) / len) * off;
            }
            const hidden = isHidden(p.id);
            const result = resultColor(p.id);
            const text = hidden ? "?" : p.label.length > 30 ? `${p.label.slice(0, 29)}…` : p.label;
            const w = Math.max(22, text.length * 6.3 + 14);
            const active = selProp?.id === p.id;
            const dim = selected && !(active || selConcept === p.from || selConcept === p.to);
            return (
              <g key={`l-${p.id}`} transform={`translate(${lx} ${ly})`} {...handlers(`${PROP}${p.id}`)} className="cursor-pointer" opacity={dim ? 0.35 : 1} role="button" aria-label={hidden ? "Hidden linking words" : p.label}>
                <rect
                  x={-w / 2}
                  y={-10}
                  width={w}
                  height={20}
                  rx={10}
                  fill={hidden ? "var(--c-highlight)" : "var(--c-bg)"}
                  stroke={active ? "var(--c-heading)" : (result ?? (p.cross ? "var(--c-accent)" : "var(--c-line)"))}
                  strokeWidth={active || result ? 2 : 1}
                />
                <text textAnchor="middle" dy="4" fontSize="11" fontStyle={hidden ? "normal" : "italic"} fontWeight={hidden ? 700 : 500} fill={hidden ? "var(--c-on-highlight)" : p.cross ? "var(--c-accent)" : "var(--c-ink-muted)"}>
                  {text}
                </text>
              </g>
            );
          })}
        </>
      )}
    </Surface>
  );
});
