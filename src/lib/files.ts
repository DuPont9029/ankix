// Formati accettati da Gemini come input documentale/visivo.
export const ACCEPTED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "text/plain": [".txt"],
  "text/markdown": [".md", ".markdown"],
};

export const ACCEPT_ATTRIBUTE = Object.entries(ACCEPTED_TYPES)
  .flatMap(([mime, exts]) => [mime, ...exts])
  .join(",");

/** Determina il MIME type dal tipo dichiarato o, in mancanza, dall'estensione. */
export function resolveMimeType(filename: string, declared?: string | null): string | null {
  const type = (declared ?? "").toLowerCase().split(";")[0].trim();
  if (type && type in ACCEPTED_TYPES) return type;
  const ext = filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  if (!ext) return null;
  for (const [mime, exts] of Object.entries(ACCEPTED_TYPES)) {
    if (exts.includes(ext)) return mime;
  }
  return null;
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith("text/");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Immagini utilizzabili per l'image occlusion (visualizzabili nel browser e in Anki). */
export const OCCLUSION_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
