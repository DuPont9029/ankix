"use client";

import { FolderOpen, GalleryVerticalEnd, KeyRound, LayoutDashboard, LogOut, Settings, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { authClient } from "@/lib/auth-client";
import { Logo } from "./logo";
import { SiteFooter } from "./site-footer";
import { cn } from "./styles";

const NAV = [
  { href: "/", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { href: "/materials", label: "Materials", short: "Materials", icon: FolderOpen },
  { href: "/generate", label: "Generate flashcards", short: "Generate", icon: Sparkles },
  { href: "/decks", label: "Decks", short: "Decks", icon: GalleryVerticalEnd },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function Avatar({ name, image, className }: { name: string; image: string | null; className?: string }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element -- avatar esterno (Google/GitHub), nessuna ottimizzazione necessaria
    return <img src={image} alt="" referrerPolicy="no-referrer" className={cn("size-8 shrink-0 rounded-full object-cover", className)} />;
  }
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-on-primary", className)}>
      {initials(name)}
    </span>
  );
}

export type ShellUser = { name: string; email: string; image: string | null };

export function AppShell({
  user,
  className,
  isAdmin = false,
  children,
}: {
  user: ShellUser;
  className: string;
  isAdmin?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    await authClient.signOut().catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const navLink = (href: string, label: string, Icon: typeof LayoutDashboard, extra?: ReactNode) => {
    const active = isActive(pathname, href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          active ? "bg-primary font-semibold text-on-primary" : "font-medium text-ink-muted hover:bg-muted-strong hover:text-ink",
        )}
      >
        <Icon className="size-[18px]" strokeWidth={1.75} />
        <span className="flex-1">{label}</span>
        {extra}
      </Link>
    );
  };

  return (
    <div className="min-h-dvh">
      {/* Barra laterale desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-sunken lg:flex">
        <Link href="/" className="flex items-center gap-3 border-b border-line px-6 py-5">
          <Logo className="size-8" />
          <div className="min-w-0">
            <div className="font-serif text-[20px] leading-6 font-semibold text-heading">Ankix</div>
            <div className="truncate text-[11px] font-semibold tracking-[0.02em] text-ink-muted">{className}</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-1 p-4">
          {NAV.map(({ href, label, icon }) => navLink(href, label, icon))}
          {navLink("/settings", "Settings", Settings)}
          {isAdmin && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="eyebrow mb-1.5 px-3 text-ink-faint">Administration</p>
              {navLink("/access-code", "Access code", KeyRound)}
            </div>
          )}
        </nav>
        <div className="flex items-center gap-2.5 border-t border-line p-4">
          <Avatar name={user.name} image={user.image} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-ink">{user.name}</div>
            <div className="truncate text-[11px] text-ink-muted">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted transition-colors hover:bg-muted-strong hover:text-danger disabled:opacity-50"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </aside>

      {/* Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur-md lg:ml-64 lg:h-16 lg:px-9">
        <Link href="/" className="flex items-center gap-2.5 lg:hidden">
          <Logo className="size-7" />
          <span className="font-serif text-lg font-semibold text-heading">Ankix</span>
        </Link>
        <span className="eyebrow hidden truncate text-ink-muted lg:block">{className}</span>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <Link
              href="/access-code"
              className={cn("grid size-9 place-items-center rounded-md hover:bg-muted lg:hidden", isActive(pathname, "/access-code") ? "text-primary" : "text-ink-muted")}
              aria-label="Access code"
            >
              <KeyRound className="size-4" />
            </Link>
          )}
          <Link
            href="/settings"
            className="relative grid size-9 place-items-center rounded-full"
            aria-label="Settings and AI engine"
            title={user.name}
          >
            <Avatar name={user.name} image={user.image} />
          </Link>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="grid size-9 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-muted lg:hidden"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </header>

      <main className="px-4 pt-6 pb-28 sm:px-6 lg:ml-64 lg:px-9 lg:pt-8 lg:pb-14">
        <div className="mx-auto w-full max-w-[1150px]">
          {children}
          <SiteFooter className="mt-14 border-t border-line pt-6" />
        </div>
      </main>

      {/* Tab bar mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map(({ href, short, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", active ? "text-primary" : "text-ink-faint")}
              >
                <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
                {short}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
