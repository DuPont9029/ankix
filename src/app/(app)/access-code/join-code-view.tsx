"use client";

import { Copy, EyeOff, QrCode, ShieldCheck, Smartphone, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, PageHeader, Panel, cn } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";

type Totp = { code: string; remainingMs: number; periodMs: number } | null;
type Setup = { uri: string; secret: string; qrSvg: string };

export function JoinCodeView({ initial }: { initial: Totp }) {
  const [totp, setTotp] = useState<Totp>(initial);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const fetching = useRef(false);

  // Orologio locale; alla scadenza del periodo chiede al server il nuovo codice
  useEffect(() => {
    if (!initial) return;
    const first = setTimeout(() => {
      const t = Date.now();
      setDeadline((d) => d ?? t + initial.remainingMs);
      setNow(t);
    }, 0);
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [initial]);

  const remainingMs = !totp ? 0 : deadline === null ? totp.remainingMs : Math.max(0, deadline - now);

  useEffect(() => {
    if (!totp || deadline === null || remainingMs > 0 || fetching.current) return;
    fetching.current = true;
    api<{ totp: Totp }>("/api/admin/join-code")
      .then((res) => {
        setTotp(res.totp);
        if (res.totp) setDeadline(Date.now() + res.totp.remainingMs);
      })
      .catch(() => undefined)
      .finally(() => {
        fetching.current = false;
      });
  }, [remainingMs, deadline, totp]);

  async function toggleSetup() {
    if (showSetup) return setShowSetup(false);
    if (!setup) {
      setLoadingSetup(true);
      try {
        setSetup(await api<Setup>("/api/admin/totp-setup"));
      } catch (err) {
        toast.error(errorMessage(err));
        setLoadingSetup(false);
        return;
      }
      setLoadingSetup(false);
    }
    setShowSetup(true);
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Copy failed: select it and copy it manually.");
    }
  }

  if (!totp) {
    return (
      <div className="max-w-3xl">
        <PageHeader eyebrow="Administration" title="Access code" />
        <Panel className="p-6">
          <p className="font-serif text-xl font-semibold text-heading">Access code disabled</p>
          <p className="mt-2 text-[13px] text-ink-muted">
            Set <code className="font-semibold text-ink">CLASS_TOTP_SECRET</code> in <code>.env.local</code> (a base32 secret) and restart the server: from then on, first-time users will have to enter the code.
          </p>
        </Panel>
      </div>
    );
  }

  const seconds = Math.ceil(remainingMs / 1000);
  const progress = remainingMs / totp.periodMs;

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Administration"
        title="Access code"
        description="The class TOTP code: share it with anyone joining for the first time. It’s the same code your authenticator app shows."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="overflow-hidden">
          <div className="h-1 bg-muted">
            <div className={cn("h-full transition-[width] duration-300 ease-linear", seconds <= 5 ? "bg-warning" : "bg-primary")} style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex flex-col items-center px-6 py-10 text-center sm:py-12">
            <p className="eyebrow text-accent">Current code</p>
            <p
              className="mt-3 font-serif text-[46px] leading-none font-semibold tracking-[0.14em] whitespace-nowrap text-heading tabular-nums sm:text-[80px] sm:tracking-[0.18em]"
              aria-live="polite"
            >
              {totp.code.slice(0, 3)}
              <span className="text-ink-faint/60"> </span>
              {totp.code.slice(3)}
            </p>
            <p className="mt-5 flex items-center gap-2 text-sm font-semibold text-ink-muted tabular-nums">
              <Timer className="size-4" /> New code in {seconds} s
            </p>
            <p className="mt-1.5 max-w-sm text-xs text-ink-faint">
              Each code is accepted for about 60 seconds after it appears, so there’s time to read it out.
            </p>
          </div>
        </Panel>

        <Panel className="p-5">
          <h2 className="flex items-center gap-2 font-serif text-lg font-semibold text-heading">
            <Smartphone className="size-[18px] text-ink-muted" strokeWidth={1.75} /> Authenticator app
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            Scan the QR with Google Authenticator, Microsoft Authenticator, Authy, 1Password or any TOTP app to always have the code on your phone.
          </p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={toggleSetup} loading={loadingSetup}>
            {!loadingSetup && (showSetup ? <EyeOff className="size-4" /> : <QrCode className="size-4" />)}
            {showSetup ? "Hide QR" : "Show QR"}
          </Button>
          {showSetup && setup && (
            <div className="mt-4 space-y-3">
              <div
                className="mx-auto w-full max-w-[220px] rounded-md border border-line bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                aria-label="QR code for the authenticator app"
                dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
              />
              <div>
                <p className="eyebrow mb-1 text-ink-muted">Or enter the key</p>
                <div className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2">
                  <code className="min-w-0 flex-1 font-mono text-xs break-all text-ink">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                  <button type="button" onClick={() => copy(setup.secret, "Secret")} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-ink-muted hover:bg-muted hover:text-ink" aria-label="Copy secret">
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">Type: time-based · 6 digits · 30 seconds · SHA-1</p>
              </div>
              <div>
                <p className="eyebrow mb-1 text-ink-muted">otpauth URL</p>
                <div className="flex items-start gap-2 rounded-md border border-line bg-sunken px-3 py-2">
                  <code className="min-w-0 flex-1 font-mono text-[11px] leading-4 break-all text-ink select-all">{setup.uri}</code>
                  <button type="button" onClick={() => copy(setup.uri, "URL")} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded text-ink-muted hover:bg-muted hover:text-ink" aria-label="Copy otpauth URL">
                    <Copy className="size-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">For password managers that accept an otpauth:// link (1Password, Bitwarden, KeePassXC…).</p>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-5 bg-sunken p-5">
        <h3 className="flex items-center gap-2 font-serif text-lg font-semibold text-heading">
          <ShieldCheck className="size-4 text-accent" /> How it works
        </h3>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-ink-muted">
          <li>Anyone signing in with Google for the first time must enter the code; after that they’re never asked again.</li>
          <li>
            Anyone with the QR or the key can generate codes: don’t share them. To revoke them, change <code className="font-semibold text-ink">CLASS_TOTP_SECRET</code> and add the new QR to your app.
          </li>
          <li>Each account gets at most 10 attempts every 10 minutes.</li>
          <li>
            Administrators (<code className="font-semibold text-ink">ADMIN_EMAILS</code>) don’t need to enter the code.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
