"use client";

import { CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { Avatar, type ShellUser } from "@/components/app-shell";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, ConfirmDialog, Input, Label, PageHeader, Panel } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";

type Status = { configured: boolean; masked: string | null; model: string };

export function SettingsView({ initialMasked, model, user }: { initialMasked: string | null; model: string; user: ShellUser }) {
  const router = useRouter();
  const [masked, setMasked] = useState(initialMasked);
  const [apiKey, setApiKey] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await api<Status>("/api/settings/gemini", { method: "PUT", json: { apiKey: apiKey.trim() } });
      setMasked(res.masked);
      setApiKey("");
      setShow(false);
      toast.success("Key verified and saved");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setRemoving(true);
    try {
      await api<Status>("/api/settings/gemini", { method: "DELETE" });
      setMasked(null);
      setConfirmRemove(false);
      toast.success("Key removed from this browser");
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Account" title="Settings" description="Your profile and the personal key used to generate flashcards with Gemini." />

      <Panel className="mb-5 flex items-center gap-4 p-5">
        <Avatar name={user.name} image={user.image} className="size-12 text-sm" />
        <div className="min-w-0">
          <p className="font-serif text-xl font-semibold text-heading">{user.name}</p>
          <p className="truncate text-[13px] text-ink-muted">{user.email}</p>
        </div>
      </Panel>

      <Panel className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-full bg-highlight text-on-highlight">
            <KeyRound className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[22px] font-semibold text-heading">Gemini API key</h2>
            <p className="mt-1 text-[13px] text-ink-muted">
              Every student uses their own key: generations use your Google quota, not the class’s.
            </p>
          </div>
        </div>

        {masked ? (
          <div className="mt-5 flex flex-col gap-3 rounded-md border border-accent/30 bg-accent-soft p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-5 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-semibold text-ink">Key configured</p>
                <p className="font-mono text-xs text-ink-muted">{masked}</p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="self-start text-danger hover:text-danger sm:self-auto" onClick={() => setConfirmRemove(true)}>
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>
        ) : (
          <div className="mt-5 rounded-md border border-warning/30 bg-warning-soft p-4 text-[13px] text-warning">
            No key configured: without a key you can browse, study and export decks, but not generate new ones.
          </div>
        )}

        <form onSubmit={save} className="mt-5 space-y-3">
          <Label htmlFor="gemini-key">{masked ? "Replace the key" : "Paste your key"}</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Input
                id="gemini-key"
                type={show ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                placeholder="AIza…"
                className="pr-10 font-mono"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-ink-faint hover:text-ink"
                aria-label={show ? "Hide key" : "Show key"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <Button type="submit" loading={saving} disabled={!apiKey.trim()}>
              Verify and save
            </Button>
          </div>
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3.5 py-2.5 text-sm text-on-danger-soft">
              {error}
            </p>
          )}
        </form>
      </Panel>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <Panel className="bg-sunken p-5 sm:p-6">
          <h3 className="font-serif text-lg font-semibold text-heading">How to get a key</h3>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[13px] text-ink-muted">
            <li>Sign in to Google AI Studio with your Google account.</li>
            <li>Click “Create API key” and copy the generated key.</li>
            <li>Paste it above and click “Verify and save”.</li>
          </ol>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-accent hover:underline"
          >
            Open Google AI Studio <ExternalLink className="size-3.5" />
          </a>
          <p className="mt-3 text-xs text-ink-faint">
            Model: <span className="font-mono">{model}</span>
          </p>
        </Panel>
        <Panel className="bg-sunken p-5 sm:p-6">
          <h3 className="flex items-center gap-2 font-serif text-lg font-semibold text-heading">
            <ShieldCheck className="size-4 text-accent" /> Privacy
          </h3>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-ink-muted">
            <li>The key stays only in this browser, in an encrypted cookie that page scripts cannot read.</li>
            <li>The server only uses it during your generations and never stores it in the database.</li>
            <li>Signing out removes the key: you’ll need to enter it again after signing back in.</li>
          </ul>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        onConfirm={remove}
        loading={removing}
        title="Remove the key?"
        description="You won’t be able to generate new flashcards until you add a key again."
        confirmLabel="Remove"
      />
    </div>
  );
}
