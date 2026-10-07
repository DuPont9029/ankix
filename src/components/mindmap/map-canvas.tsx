"use client";

import { forwardRef, useMemo } from "react";
import { branchIndex, treeLayout, type MapNode } from "@/lib/mindmap";
import { Surface, type SurfaceHandle } from "./surface";

// Tonalità dei rami: leggibili sia su fondo chiaro sia scuro.
const HUES = [174, 262, 25, 205, 340, 45, 145, 230];
const stroke = (i: number | undefined) => (i === undefined ? "var(--c-line-strong)" : `hsl(${HUES[i % HUES.length]} 55% 48%)`);
const fill = (i: number | undefined) => (i === undefined ? "var(--c-card)" : `hsl(${HUES[i % HUES.length]} 70% 50% / 0.13)`);

/** Mappa mentale: argomento centrale e rami colorati a destra e a sinistra, collegati da curve senza etichette. */
export const MindMapCanvas = forwardRef<SurfaceHandle, { nodes: MapNode[]; selected: string | null; onSelect: (id: string | null) => void; className?: string }>(
  function MindMapCanvas({ nodes, selected, onSelect, className }, ref) {
    const layout = useMemo(() => treeLayout(nodes), [nodes]);
    const branches = useMemo(() => branchIndex(nodes), [nodes]);
    const root = nodes.find((n) => !n.parent);
    return (
      <Surface ref={ref} layout={layout} fitKey={`mind:${nodes.length}`} onSelect={onSelect} label="Mind map" className={className}>
        {(boxes, handlers) => (
          <>
            {nodes.map((n) => {
              if (!n.parent) return null;
              const a = boxes.get(n.parent);
              const b = boxes.get(n.id);
              if (!a || !b) return null;
              const side = b.x >= a.x ? 1 : -1;
              const x1 = a.x + (side * a.w) / 2;
              const x2 = b.x - (side * b.w) / 2;
              const mx = (x1 + x2) / 2;
              return (
                <path
                  key={`e-${n.id}`}
                  d={`M${x1} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${x2} ${b.y}`}
                  fill="none"
                  stroke={stroke(branches.get(n.id))}
                  strokeWidth={n.parent === root?.id ? 3 : 1.7}
                  strokeOpacity={0.85}
                  strokeLinecap="round"
                />
              );
            })}
            {nodes.map((n) => {
              const b = boxes.get(n.id);
              if (!b) return null;
              const isRoot = n === root;
              const bi = branches.get(n.id);
              const lineH = isRoot ? 20 : 17;
              const firstY = -((b.lines.length - 1) * lineH) / 2 + 4.5;
              return (
                <g key={n.id} transform={`translate(${b.x} ${b.y})`} {...handlers(n.id)} className="cursor-pointer" role="button" aria-label={n.label}>
                  <rect
                    x={-b.w / 2}
                    y={-b.h / 2}
                    width={b.w}
                    height={b.h}
                    rx={b.h / 2}
                    fill={isRoot ? "var(--c-primary)" : fill(bi)}
                    stroke={selected === n.id ? "var(--c-heading)" : isRoot ? "var(--c-primary)" : stroke(bi)}
                    strokeWidth={selected === n.id ? 2.6 : 1.3}
                  />
                  <text textAnchor="middle" fontSize={isRoot ? 15 : 12.5} fontWeight={isRoot || n.parent === root?.id ? 700 : 500} fill={isRoot ? "var(--c-on-primary)" : "var(--c-ink)"}>
                    {b.lines.map((line, i) => (
                      <tspan key={i} x={0} y={firstY + i * lineH}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                  {n.cards.length > 0 && !isRoot && (
                    <g transform={`translate(${b.w / 2 - 4} ${-b.h / 2 + 2})`}>
                      <circle r={8} fill="var(--c-card)" stroke={stroke(bi)} />
                      <text textAnchor="middle" dy="3.5" fontSize="9" fontWeight={700} fill="var(--c-ink-muted)">
                        {Math.min(n.cards.length, 99)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </>
        )}
      </Surface>
    );
  },
);
