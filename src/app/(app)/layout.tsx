import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";
import { getGeminiKey } from "@/lib/gemini-key";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.joined) redirect("/welcome");
  const hasGeminiKey = Boolean(await getGeminiKey(user));
  return (
    <AppShell user={{ name: user.name, email: user.email, image: user.image }} className={env.className} hasGeminiKey={hasGeminiKey} isAdmin={user.isAdmin}>
      {children}
    </AppShell>
  );
}
