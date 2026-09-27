import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { currentClassTotp } from "@/lib/totp";
import { JoinCodeView } from "./join-code-view";

export const metadata: Metadata = { title: "Access code" };
export const dynamic = "force-dynamic";

export default async function JoinCodePage() {
  const user = await getCurrentUser();
  if (!user?.isAdmin) notFound();
  return <JoinCodeView initial={currentClassTotp()} />;
}
