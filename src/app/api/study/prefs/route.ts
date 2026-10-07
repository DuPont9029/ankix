import { NextResponse, type NextRequest } from "next/server";
import { handle, readJson, requireUser } from "@/lib/http";
import { getPrefs, PrefsBody, savePrefs } from "@/lib/study";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ prefs: await getPrefs(user.id) });
});

export const PATCH = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const patch = PrefsBody.parse(await readJson(req));
  return NextResponse.json({ prefs: await savePrefs(user.id, patch) });
});
