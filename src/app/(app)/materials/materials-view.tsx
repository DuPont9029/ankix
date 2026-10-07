"use client";

import { Check, CheckCircle2, Eye, FolderOpen, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { FileIcon } from "@/components/file-icon";
import { RelativeTime } from "@/components/relative-time";
import { Button, EmptyState, Input, Modal, PageHeader, Select, Spinner, SubjectBadge, buttonClass, cn } from "@/components/ui";
import { api, errorMessage } from "@/lib/client";
import { formatBytes } from "@/lib/files";
import { subjectTone } from "@/lib/subjects-style";
import type { Material } from "@/lib/types";
import { UploadDialog } from "./upload-dialog";

type LinkedDeck = { id: string; title: string; cardCount: number };

export function MaterialsView({
  initialMaterials,
  currentUserId,
  maxUploadMb,
}: {
  initialMaterials: Material[];
  currentUserId: string;
  maxUploadMb: number;
}) {
  const router = useRouter();
  const [materials, setMaterials] = useState(initialMaterials);
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState<"material" | "all" | null>(null);
  /** Mazzi generati dal materiale da eliminare (null = in caricamento) */
  const [linked, setLinked] = useState<{ id: string | null; decks: LinkedDeck[]; othersCount: number } | null>(null);

  useEffect(() => {
    if (!toDelete) return;
    let cancelled = false;
    api<{ decks: LinkedDeck[]; othersCount: number }>(`/api/materials/${toDelete.id}`)
      .then((res) => {
        if (!cancelled) setLinked({ id: toDelete.id, ...res });
      })
      .catch(() => {
        // Senza l'elenco si può comunque eliminare il solo materiale.
        if (!cancelled) setLinked({ id: toDelete.id, decks: [], othersCount: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [toDelete]);
  const linkedFor = linked && toDelete && linked.id === toDelete.id ? linked : null;
  const [refreshing, setRefreshing] = useState(false);

  const subjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of materials) counts.set(m.subject, (counts.get(m.subject) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
  }, [materials]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return materials.filter(
      (m) =>
        (!subject || m.subject === subject) &&
        (!q || m.title.toLowerCase().includes(q) || m.filename.toLowerCase().includes(q) || m.uploadedBy.toLowerCase().includes(q)),
    );
  }, [materials, query, subject]);

  const selectedSize = materials.filter((m) => selected.has(m.id)).reduce((sum, m) => sum + m.sizeBytes, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= 10) toast.error("You can select up to 10 materials.");
      else next.add(id);
      return next;
    });
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await api<{ materials: Material[] }>("/api/materials");
      setMaterials(res.materials);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  async function confirmDelete(withDecks: boolean) {
    if (!toDelete) return;
    setDeleting(withDecks ? "all" : "material");
    try {
      const res = await api<{ deletedDecks: number }>(`/api/materials/${toDelete.id}${withDecks ? "?withDecks=1" : ""}`, { method: "DELETE" });
      setMaterials((prev) => prev.filter((m) => m.id !== toDelete.id));
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(toDelete.id);
        return next;
      });
      toast.success(res.deletedDecks ? `Material and ${res.deletedDecks} ${res.deletedDecks === 1 ? "deck" : "decks"} deleted` : "Material deleted");
      setToDelete(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Class repository"
        title="Materials"
        description="Slides, handouts and notes shared by the class. Select one or more files to generate a deck."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Plus className="size-4" /> Upload materials
          </Button>
        }
      />

      {materials.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-5" />}
          title="No materials uploaded"
          description="Upload the first PDF or photos of your notes: they will be available to the whole class."
          action={
            <Button onClick={() => setUploadOpen(true)}>
              <Plus className="size-4" /> Upload materials
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 rounded-lg border border-line bg-sunken p-3 lg:flex-row lg:items-center">
            <div className="relative lg:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title, file name, author" className="pl-10" aria-label="Search materials" />
            </div>
            <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="lg:w-56" aria-label="Filter by subject">
              <option value="">All subjects ({materials.length})</option>
              {subjectCounts.map(([s, n]) => (
                <option key={s} value={s}>
                  {s} ({n})
                </option>
              ))}
            </Select>
            <div className="flex flex-wrap items-center gap-1.5">
              {subjectCounts.slice(0, 3).map(([s]) => {
                const tone = subjectTone(s);
                const active = subject === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubject(active ? "" : s)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition",
                      tone.chip,
                      active ? "ring-2 ring-primary ring-offset-1 ring-offset-sunken" : "opacity-85 hover:opacity-100",
                    )}
                    aria-pressed={active}
                  >
                    <span className={cn("size-1.5 rounded-full", tone.dot)} />
                    {s}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 lg:ml-auto">
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
                <FolderOpen className="size-4" strokeWidth={1.75} /> {filtered.length} files available
              </span>
              <button
                type="button"
                onClick={refresh}
                className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-muted-strong hover:text-ink"
                aria-label="Refresh list"
                title="Refresh"
              >
                <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-muted">No materials match the filters.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((m) => {
                const isSelected = selected.has(m.id);
                const mine = m.uploadedById === currentUserId;
                return (
                  <article
                    key={m.id}
                    className={cn(
                      "flex flex-col overflow-hidden rounded-lg bg-card shadow-card transition",
                      isSelected ? "border-2 border-heading" : "border border-line hover:border-line-strong",
                    )}
                  >
                    <div className={cn("flex flex-1 flex-col p-4", !isSelected && "p-[17px]")}>
                      <div className="flex items-start gap-2.5">
                        <FileIcon mimeType={m.mimeType} />
                        <SubjectBadge subject={m.subject} className="mt-2" />
                        <button
                          type="button"
                          onClick={() => toggle(m.id)}
                          className={cn(
                            "ml-auto grid size-6 shrink-0 cursor-pointer place-items-center rounded-md border transition",
                            isSelected ? "border-heading bg-heading text-bg" : "border-line-strong bg-card hover:border-primary",
                          )}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? `Deselect ${m.title}` : `Select ${m.title}`}
                        >
                          {isSelected && <Check className="size-4" strokeWidth={3} />}
                        </button>
                      </div>
                      <h3 className="mt-3 line-clamp-2 font-serif text-[19px] leading-[26px] font-semibold break-words text-heading">{m.title}</h3>
                      <p className="mt-1 truncate text-[13px] text-ink-muted" title={m.filename}>
                        {m.filename} · {formatBytes(m.sizeBytes)}
                      </p>
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                        {mine ? (
                          <>
                            <ShieldCheck className="size-3.5 text-accent" />
                            <span className="font-semibold text-accent">{m.uploadedBy} (you)</span>
                          </>
                        ) : (
                          <>
                            <UserRound className="size-3.5" />
                            <span className="truncate">{m.uploadedBy}</span>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        <RelativeTime ms={m.createdAt} />
                      </p>
                    </div>
                    <div className="flex items-center gap-1 border-t border-line bg-sunken px-2 py-1.5">
                      <Link href={`/generate?materials=${m.id}`} className={buttonClass("ghost", "sm", "text-ink")}>
                        <Sparkles className="size-3.5" /> Generate
                      </Link>
                      <a
                        href={`/api/materials/${m.id}/download`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass("ghost", "sm", "ml-auto px-2")}
                        aria-label={`Open ${m.title}`}
                        title="Open"
                      >
                        <Eye className="size-4" />
                      </a>
                      {mine && (
                        <Button variant="ghost" size="sm" className="px-2 text-danger hover:text-danger" onClick={() => setToDelete(m)} aria-label={`Delete ${m.title}`} title="Delete">
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-4 bottom-20 z-40 mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-lg bg-heading p-3 pl-4 text-bg shadow-raised lg:bottom-6 lg:left-[calc(16rem+1rem)]">
          <div className="flex items-center gap-3">
            <span className="grid size-8 place-items-center rounded-full bg-bg/10">
              <CheckCircle2 className="size-4" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">
                {selected.size} {selected.size === 1 ? "material selected" : "materials selected"}
              </p>
              <p className="text-xs opacity-75">{formatBytes(selectedSize)} total</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelected(new Set())} className="cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-semibold opacity-85 hover:opacity-100">
              Cancel
            </button>
            <Link
              href={`/generate?materials=${[...selected].join(",")}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#6df5e1] px-3.5 py-2 text-[13px] font-semibold text-[#00201c] hover:bg-[#71f8e4]"
            >
              Generate deck <Sparkles className="size-3.5" />
            </Link>
          </div>
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        maxUploadMb={maxUploadMb}
        onUploaded={(m) => {
          setMaterials((prev) => [m, ...prev]);
          router.refresh();
        }}
      />
      <Modal
        open={toDelete !== null}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        title="Delete this material?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)} disabled={deleting !== null}>
              Cancel
            </Button>
            {linkedFor && linkedFor.decks.length > 0 ? (
              <>
                <Button variant="secondary" onClick={() => confirmDelete(false)} loading={deleting === "material"} disabled={deleting !== null}>
                  Keep the decks
                </Button>
                <Button variant="danger" onClick={() => confirmDelete(true)} loading={deleting === "all"} disabled={deleting !== null}>
                  Delete material and {linkedFor.decks.length === 1 ? "deck" : `${linkedFor.decks.length} decks`}
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => confirmDelete(false)} loading={deleting === "material"} disabled={deleting !== null || !linkedFor}>
                Delete
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm text-ink-muted">
          <p>
            <strong className="text-ink">{toDelete?.title}</strong> will be removed from the bucket and will no longer be available to anyone.
          </p>
          {!linkedFor ? (
            <p className="flex items-center gap-2">
              <Spinner className="size-4" /> Looking for decks generated from it…
            </p>
          ) : linkedFor.decks.length > 0 ? (
            <>
              <p>
                You generated {linkedFor.decks.length === 1 ? "this deck" : "these decks"} from it. Do you also want to delete{" "}
                {linkedFor.decks.length === 1 ? "it" : "them"}?
              </p>
              <ul className="space-y-1 rounded-md border border-line bg-sunken p-2.5">
                {linkedFor.decks.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 text-[13px]">
                    <span className="truncate font-medium text-ink">{d.title}</span>
                    <span className="shrink-0 tabular-nums">{d.cardCount} cards</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-ink-faint">
                Deleting the decks also removes their cards, their study history from the calendar and their mind maps.
                {linkedFor.othersCount > 0 &&
                  ` ${linkedFor.othersCount} ${linkedFor.othersCount === 1 ? "deck" : "decks"} of other students made from this material will not be touched.`}
              </p>
            </>
          ) : (
            <p>
              No deck of yours was generated from it.
              {linkedFor.othersCount > 0 && ` ${linkedFor.othersCount} ${linkedFor.othersCount === 1 ? "deck" : "decks"} of other students will keep their cards.`}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
