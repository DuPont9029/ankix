import { FileImage, FileText, FileType2 } from "lucide-react";
import { cn } from "./styles";

/** Icona del tipo di file: PDF (rosso tenue), immagine, testo. */
export function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType === "application/pdf") {
    return (
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300", className)}>
        <FileType2 className="size-[18px]" strokeWidth={1.75} />
      </span>
    );
  }
  if (mimeType.startsWith("image/")) {
    return (
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300", className)}>
        <FileImage className="size-[18px]" strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-muted text-ink-muted", className)}>
      <FileText className="size-[18px]" strokeWidth={1.75} />
    </span>
  );
}

export function fileKind(mimeType: string): string {
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType.startsWith("image/")) return mimeType.split("/")[1].toUpperCase().replace("JPEG", "JPG");
  return mimeType === "text/markdown" ? "MD" : "TXT";
}
