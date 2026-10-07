"use client";

import { CardHtml, ChoicesHtml, ClozeHtml } from "@/components/cards/card-html";
import { OcclusionView } from "@/components/cards/occlusion-view";
import { cn } from "@/components/ui";
import type { StudyItem } from "@/lib/items";

type Item = Pick<StudyItem, "card" | "cloze">;

/** Fronte o retro di un elemento di studio (card, singola cloze o maschera). */
export function Face({ item, side, picked, onPick }: { item: Item; side: "front" | "back"; picked: number | null; onPick: (i: number) => void }) {
  const { card, cloze } = item;
  if (card.type === "mcq") {
    return (
      <div className="w-full space-y-5">
        <CardHtml html={card.front} className={cn("font-serif text-ink", side === "front" ? "text-[21px] leading-9 sm:text-[24px]" : "text-[17px] leading-7")} />
        <ChoicesHtml choices={card.choices} reveal={side === "back"} picked={picked} onPick={side === "front" ? onPick : undefined} />
        {side === "back" && card.extra && <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />}
      </div>
    );
  }
  if (card.type === "image_occlusion" && card.imageMaterialId && cloze !== null) {
    const active = cloze - 1;
    return (
      <div className="w-full space-y-4">
        {card.front && <p className="font-serif text-[17px] leading-7 text-ink">{card.front}</p>}
        <div className="flex justify-center">
          <OcclusionView materialId={card.imageMaterialId} occlusions={card.occlusions} mode={{ kind: "study", active, revealed: side === "back" }} />
        </div>
        {side === "back" && (
          <>
            <p className="text-[17px] font-semibold text-heading">{card.occlusions[active]?.label}</p>
            {card.extra && <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />}
          </>
        )}
      </div>
    );
  }
  if (card.type === "cloze") {
    return (
      <div className="space-y-5">
        <ClozeHtml text={card.front} active={cloze} reveal={side === "back"} className="font-serif text-[21px] leading-9 text-ink sm:text-[24px]" />
        {side === "back" && card.extra && (
          <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />
        )}
      </div>
    );
  }
  if (side === "front") return <CardHtml html={card.front} className="font-serif text-[21px] leading-9 text-ink sm:text-[24px]" />;
  return (
    <div className="space-y-5">
      <CardHtml html={card.front} className="font-serif text-[15px] text-ink-muted italic" />
      <CardHtml html={card.back} className="text-[17px] leading-7 font-medium text-ink sm:text-lg" />
      {card.extra && <CardHtml html={card.extra} className="border-l-2 border-accent pl-3 text-left text-[13px] text-ink-muted" />}
    </div>
  );
}
