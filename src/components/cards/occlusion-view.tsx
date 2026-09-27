"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Occlusion } from "@/lib/types";
import { cn } from "../styles";

export function occlusionImageUrl(materialId: string): string {
  return `/api/materials/${materialId}/download`;
}

type Mode =
  | { kind: "overview" } // elenco: maschere numerate e semitrasparenti
  | { kind: "study"; active: number; revealed: boolean }; // ripasso: "hide all, guess one"

/** Immagine con le maschere sovrapposte (coordinate relative, quindi responsive). */
export function OcclusionView({
  materialId,
  occlusions,
  mode,
  className,
}: {
  materialId: string;
  occlusions: Occlusion[];
  mode: Mode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={cn("grid place-items-center rounded-md border border-dashed border-line-strong bg-sunken p-6 text-center text-[13px] text-ink-muted", className)}>
        The image for this card is no longer available.
      </div>
    );
  }
  return (
    <div className={cn("relative inline-block max-w-full overflow-hidden rounded-md border border-line bg-white leading-none", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata servita tramite URL prefirmato */}
      <img src={occlusionImageUrl(materialId)} alt="" className="block h-auto max-h-[70vh] w-auto max-w-full select-none" draggable={false} onError={() => setFailed(true)} />
      {occlusions.map((o, i) => {
        const style = { left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` };
        if (mode.kind === "overview") {
          return (
            <span
              key={o.id}
              style={style}
              title={o.label}
              className="absolute grid place-items-center rounded-[3px] border border-[#212121]/70 bg-[#ffeba2]/75 text-[10px] font-bold text-[#212121]"
            >
              {i + 1}
            </span>
          );
        }
        const isActive = i === mode.active;
        if (isActive && mode.revealed) {
          return <span key={o.id} style={style} className="absolute rounded-[3px] border-2 border-[#ff8e8e]" />;
        }
        return (
          <span
            key={o.id}
            style={style}
            className={cn(
              "absolute rounded-[3px] border border-[#212121]",
              isActive ? "bg-[#ff8e8e]" : "bg-[#ffeba2]",
            )}
          />
        );
      })}
    </div>
  );
}

/** Editor delle maschere: trascina sull'immagine per disegnarne una nuova, clic per selezionarla. */
export function OcclusionCanvas({
  materialId,
  occlusions,
  selected,
  onSelect,
  onDraw,
}: {
  materialId: string;
  occlusions: Occlusion[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onDraw: (box: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  function point(e: ReactPointerEvent) {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1),
      y: Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1),
    };
  }

  return (
    <div
      ref={ref}
      className="relative inline-block max-w-full touch-none overflow-hidden rounded-md border border-line bg-white leading-none select-none"
      style={{ cursor: "crosshair" }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.mask) return;
        const p = point(e);
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        onSelect(null);
      }}
      onPointerMove={(e) => {
        if (!draft) return;
        const p = point(e);
        setDraft({ ...draft, x1: p.x, y1: p.y });
      }}
      onPointerUp={() => {
        if (!draft) return;
        const x = Math.min(draft.x0, draft.x1);
        const y = Math.min(draft.y0, draft.y1);
        const w = Math.abs(draft.x1 - draft.x0);
        const h = Math.abs(draft.y1 - draft.y0);
        setDraft(null);
        if (w > 0.01 && h > 0.01) onDraw({ x, y, w, h });
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- immagine privata servita tramite URL prefirmato */}
      <img src={occlusionImageUrl(materialId)} alt="" className="pointer-events-none block h-auto max-h-[55vh] w-auto max-w-full" draggable={false} />
      {occlusions.map((o, i) => (
        <button
          key={o.id}
          type="button"
          data-mask="1"
          onClick={() => onSelect(o.id)}
          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: `${o.w * 100}%`, height: `${o.h * 100}%` }}
          className={cn(
            "absolute grid cursor-pointer place-items-center rounded-[3px] border text-[10px] font-bold text-[#212121]",
            selected === o.id ? "border-2 border-primary bg-[#ff8e8e]/80" : "border-[#212121]/70 bg-[#ffeba2]/75 hover:bg-[#ffeba2]",
          )}
          aria-label={`Mask ${i + 1}: ${o.label || "unlabelled"}`}
        >
          {i + 1}
        </button>
      ))}
      {draft && (
        <span
          className="pointer-events-none absolute rounded-[3px] border-2 border-dashed border-primary bg-primary/15"
          style={{
            left: `${Math.min(draft.x0, draft.x1) * 100}%`,
            top: `${Math.min(draft.y0, draft.y1) * 100}%`,
            width: `${Math.abs(draft.x1 - draft.x0) * 100}%`,
            height: `${Math.abs(draft.y1 - draft.y0) * 100}%`,
          }}
        />
      )}
    </div>
  );
}
