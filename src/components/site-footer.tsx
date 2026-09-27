import { Heart } from "lucide-react";
import { cn } from "./styles";

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("text-center text-xs leading-5 text-ink-faint", className)}>
      Made with <Heart className="inline size-3.5 -translate-y-px fill-danger text-danger" aria-label="love" /> by{" "}
      <a
        href="https://github.com/DuPont9029"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-ink-muted hover:text-accent hover:underline"
      >
        DuPont9029
      </a>{" "}
      (David Novelli) for the students of Medicine and Surgery MedTech at Campus Bio-Medico
    </footer>
  );
}
