import Link from "next/link";
import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/styles";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <Logo className="size-10" />
      <p className="eyebrow mt-6 text-accent">Error 404</p>
      <h1 className="mt-1 font-serif text-[32px] font-semibold text-heading">Page not found</h1>
      <p className="mt-2 max-w-md text-ink-muted">The content you are looking for does not exist, was deleted or is a private deck.</p>
      <Link href="/" className={buttonClass("primary", "md", "mt-6")}>
        Back to the dashboard
      </Link>
    </div>
  );
}
