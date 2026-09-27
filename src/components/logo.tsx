import { cn } from "./styles";

/** Logo Ankix (dal progetto Stitch): scheda con croce medica su fondo verde petrolio. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("shrink-0", className)} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#0f5b5c" />
      <rect x="16.5" y="13.5" width="24" height="33" rx="5" fill="#fff" opacity=".4" transform="rotate(-6 28.5 30)" />
      <rect x="24" y="17" width="24" height="32" rx="5" fill="#fff" />
      <circle cx="44" cy="21.5" r="2.8" fill="#14b8a6" />
      <path d="M32 26v14M25 33h14" stroke="#0f5b5c" strokeWidth="3.4" strokeLinecap="round" />
    </svg>
  );
}
