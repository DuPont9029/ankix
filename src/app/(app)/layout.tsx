import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser } from "@/lib/current-user";
import { env } from "@/lib/env";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.joined) redirect("/welcome");
  return (
    <AppShell user={{ name: user.name, email: user.email, image: user.image }} className={env.className} isAdmin={user.isAdmin}>
      {children}
    </AppShell>
  );
}
