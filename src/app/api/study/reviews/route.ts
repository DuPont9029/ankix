import { NextResponse, type NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/http";
import { recordReviews, ReviewsBody } from "@/lib/study";
import type { ReviewInput } from "@/lib/study-types";

export const dynamic = "force-dynamic";

/** Salva un gruppo di valutazioni (Again/Hard/Good/Easy) e aggiorna la programmazione delle card. */
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const { reviews } = ReviewsBody.parse(await readJson(req));
  return NextResponse.json(await recordReviews(user.id, reviews as ReviewInput[]));
});
