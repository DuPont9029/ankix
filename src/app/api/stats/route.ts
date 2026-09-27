import { NextResponse } from "next/server";
import { handle, requireUser } from "@/lib/http";
import { stats } from "@/lib/repo";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json(await stats(user.id));
});
