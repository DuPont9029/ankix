"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type Provider = "google" | "github";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.8.14-1.57.38-2.29v-3.1H1.27A12 12 0 0 0 0 12c0 1.94.46 3.77 1.27 5.39l4.01-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.27 6.61l4.01 3.1C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

const LABELS: Record<Provider, { label: string; icon: () => React.ReactElement }> = {
  google: { label: "Continue with Google", icon: GoogleIcon },
  github: { label: "Continue with GitHub", icon: GitHubIcon },
};

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) return "/";
  return value;
}

function errorText(code: string | null, domains: string[]): string | null {
  if (!code) return null;
  if (code.includes("email_not_allowed") || code === "unable_to_create_user" || code === "access_denied_domain") {
    return domains.length
      ? `This account is not allowed. Sign in with an ${domains.map((d) => `@${d}`).join(" or ")} email.`
      : "This account is not allowed to sign in.";
  }
  if (code === "access_denied") return "Sign-in cancelled.";
  return "Sign-in failed. Please try again in a moment.";
}

export function LoginForm({ providers, allowedDomains }: { providers: Provider[]; allowedDomains: string[] }) {
  const params = useSearchParams();
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(() => errorText(params.get("error"), allowedDomains));

  async function signIn(provider: Provider) {
    setPending(provider);
    setError(null);
    const next = safeNext(params.get("next"));
    const { error: err } = await authClient.signIn.social({
      provider,
      callbackURL: next,
      errorCallbackURL: "/login",
    });
    // In caso di successo il browser viene reindirizzato al provider.
    if (err) {
      setError(err.message || "Sign-in failed. Please try again.");
      setPending(null);
    }
  }

  return (
    <div>
      <h2 className="font-serif text-[22px] leading-[30px] font-semibold text-heading">Sign in</h2>
      <p className="mt-1 text-sm text-ink-muted">Use your account to enter the class archive.</p>

      <div className="mt-6 space-y-2.5">
        {providers.map((p) => {
          const { label, icon: Icon } = LABELS[p];
          return (
            <Button key={p} variant="secondary" size="lg" className="w-full bg-card text-ink" loading={pending === p} disabled={pending !== null} onClick={() => signIn(p)}>
              {pending !== p && <Icon />}
              {label}
            </Button>
          );
        })}
        {providers.length === 0 && (
          <p className="rounded-md border border-warning/40 bg-warning-soft px-3.5 py-3 text-sm text-warning">
            No sign-in method configured. Set <code className="font-semibold">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="font-semibold">GOOGLE_CLIENT_SECRET</code> (or the GitHub ones) in <code>.env.local</code>.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3.5 py-2.5 text-sm text-on-danger-soft">
          {error}
        </p>
      )}

      <p className="mt-6 border-t border-line pt-4 text-xs leading-5 text-ink-faint">
        {allowedDomains.length
          ? `Restricted to ${allowedDomains.map((d) => `@${d}`).join(", ")} accounts. `
          : ""}
        Your decks stay private until you choose to share them with the class.
      </p>
    </div>
  );
}
