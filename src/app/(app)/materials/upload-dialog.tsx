"use client";

import { CheckCircle2, Trash2, UploadCloud, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { FileIcon } from "@/components/file-icon";
import { Button, Input, Modal, Select, cn } from "@/components/ui";
import { errorMessage } from "@/lib/client";
import { ACCEPT_ATTRIBUTE, formatBytes, resolveMimeType } from "@/lib/files";
import { SUBJECTS } from "@/lib/subjects";
import type { Material } from "@/lib/types";
import { uploadMaterial } from "@/lib/upload";

type Item = {
  key: string;
  file: File;
  title: string;
  subject: string;
  progress: number;
  state: "pending" | "uploading" | "done" | "error";
  error?: string;
};

function defaultTitle(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || filename;
}

export function UploadDialog({
  open,
  onClose,
  onUploaded,
  maxUploadMb,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (m: Material) => void;
  maxUploadMb: number;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSubject, setLastSubject] = useState<string>(SUBJECTS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    const next: Item[] = [];
    for (const file of Array.from(files)) {
      if (!resolveMimeType(file.name, file.type)) {
        toast.error(`"${file.name}": unsupported format.`);
        continue;
      }
      if (file.size > maxUploadMb * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds the ${maxUploadMb} MB limit.`);
        continue;
      }
      if (file.size === 0) {
        toast.error(`"${file.name}" is empty.`);
        continue;
      }
      next.push({
        key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        title: defaultTitle(file.name),
        subject: lastSubject,
        progress: 0,
        state: "pending",
      });
    }
    if (next.length) setItems((prev) => [...prev, ...next]);
  }

  function update(key: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!busy && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  }

  async function uploadAll() {
    const queue = items.filter((it) => it.state === "pending" || it.state === "error");
    if (queue.some((it) => !it.title.trim())) {
      toast.error("Every file needs a title.");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const it of queue) {
      update(it.key, { state: "uploading", progress: 0, error: undefined });
      try {
        const material = await uploadMaterial(it.file, { title: it.title.trim(), subject: it.subject }, (p) =>
          update(it.key, { progress: p }),
        );
        update(it.key, { state: "done", progress: 1 });
        onUploaded(material);
        ok++;
      } catch (err) {
        update(it.key, { state: "error", error: errorMessage(err) });
      }
    }
    setBusy(false);
    if (ok > 0) toast.success(ok === 1 ? "Material uploaded" : `${ok} materials uploaded`);
    if (ok === queue.length) {
      setItems([]);
      onClose();
    } else {
      setItems((prev) => prev.filter((it) => it.state !== "done"));
    }
  }

  function close() {
    if (busy) return;
    setItems([]);
    onClose();
  }

  const pending = items.filter((it) => it.state !== "done").length;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload materials"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={uploadAll} loading={busy} disabled={pending === 0}>
            <UploadCloud className="size-4" />
            Upload {pending > 0 ? `(${pending})` : ""}
          </Button>
        </>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border-[1.5px] border-dashed px-6 py-10 text-center transition",
          dragging ? "border-solid border-primary bg-primary-soft" : "border-accent/40 bg-sunken hover:border-primary",
        )}
      >
        <div className="mb-3 grid size-11 place-items-center rounded-md border border-line bg-card text-primary">
          <UploadCloud className="size-5" />
        </div>
        <p className="font-semibold text-heading">Drop files here or click to choose them</p>
        <p className="mt-1 text-[13px] text-ink-muted">
          PDF, PNG, JPG, WEBP, HEIC, TXT, MD · max {maxUploadMb} MB each
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT_ATTRIBUTE}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <ul className="mt-4 space-y-3">
          {items.map((it) => {
            const mime = resolveMimeType(it.file.name, it.file.type) ?? "";
            const locked = it.state === "uploading" || it.state === "done" || busy;
            return (
              <li key={it.key} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-3">
                  <FileIcon mimeType={mime} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{it.file.name}</div>
                    <div className="text-xs text-ink-muted">{formatBytes(it.file.size)}</div>
                  </div>
                  {it.state === "done" && <CheckCircle2 className="size-5 text-accent" />}
                  {it.state === "error" && <XCircle className="size-5 text-danger" />}
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => setItems((prev) => prev.filter((p) => p.key !== it.key))}
                      className="grid size-8 cursor-pointer place-items-center rounded-md text-ink-faint hover:bg-muted hover:text-danger"
                      aria-label="Remove"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
                  <Input
                    value={it.title}
                    onChange={(e) => update(it.key, { title: e.target.value })}
                    placeholder="Material title"
                    maxLength={150}
                    disabled={locked}
                    aria-label="Title"
                  />
                  <Select
                    value={it.subject}
                    onChange={(e) => {
                      update(it.key, { subject: e.target.value });
                      setLastSubject(e.target.value);
                    }}
                    disabled={locked}
                    aria-label="Subject"
                  >
                    {SUBJECTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </div>
                {(it.state === "uploading" || it.state === "done") && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${Math.round(it.progress * 100)}%` }}
                    />
                  </div>
                )}
                {it.error && <p className="mt-2 text-sm text-danger">{it.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
