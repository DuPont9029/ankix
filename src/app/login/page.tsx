import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthLayout } from "@/components/auth-layout";
import { enabledProviders } from "@/lib/auth";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(user.joined ? "/" : "/welcome");
  const domains = (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().replace(/^@/, ""))
    .filter(Boolean);
  return (
    <AuthLayout className={env.className}>
      <Suspense>
        <LoginForm providers={enabledProviders()} allowedDomains={domains} />
      </Suspense>
    </AuthLayout>
  );
}
