"use client";

import { ArrowRight, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Input, Label } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { api, errorMessage } from "@/lib/client";

export function JoinForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/join", { method: "POST", json: { code } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="font-serif text-lg text-ink-muted italic">Hi {name.split(" ")[0]},</p>
      <h2 className="font-serif text-[22px] leading-[30px] font-semibold text-heading">Join your class</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Ask the administrator for the 6-digit code: it changes every <span className="font-semibold text-ink">30 seconds</span>, so enter it right away. You only need it the first time.
      </p>
      <div className="mt-6">
        <Label htmlFor="code">Access code</Label>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            className="h-12 pl-10 font-serif text-[22px] tracking-[0.35em] tabular-nums"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            autoFocus
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded-md bg-danger-soft px-3.5 py-2.5 text-sm text-on-danger-soft">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="mt-5 w-full" loading={loading} disabled={code.length !== 6}>
        Continue {!loading && <ArrowRight className="size-4" />}
      </Button>
      <p className="mt-5 border-t border-line pt-4 text-xs text-ink-faint">
        Signed in as {email} ·{" "}
        <button
          type="button"
          className="cursor-pointer font-semibold text-accent hover:underline"
          onClick={async () => {
            await authClient.signOut().catch(() => undefined);
            router.replace("/login");
            router.refresh();
          }}
        >
          use another account
        </button>
      </p>
    </form>
  );
}
