import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { JoinForm } from "./join-form";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.joined) redirect("/");
  return (
    <AuthLayout className={env.className}>
      <JoinForm name={user.name} email={user.email} />
    </AuthLayout>
  );
}
