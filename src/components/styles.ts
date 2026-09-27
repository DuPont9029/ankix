import { extendTailwindMerge } from "tailwind-merge";

// Registra i token colore del design system, così tailwind-merge risolve i conflitti (es. text-ink vs text-sm).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        "bg", "card", "sunken", "muted", "muted-strong", "line", "line-strong", "ink", "ink-muted", "ink-faint",
        "heading", "primary", "primary-hover", "on-primary", "primary-soft", "accent", "accent-soft", "highlight",
        "on-highlight", "danger", "danger-soft", "on-danger-soft", "warning", "warning-soft",
      ],
    },
  },
});

export function cn(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}

export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-on-primary shadow-card hover:bg-primary-hover focus-visible:outline-primary",
  secondary: "bg-sunken text-heading border border-line hover:bg-muted-strong focus-visible:outline-primary",
  outline: "border border-primary text-primary hover:bg-primary-soft focus-visible:outline-primary",
  ghost: "text-ink-muted hover:bg-muted hover:text-ink focus-visible:outline-primary",
  danger: "border border-danger text-danger hover:bg-danger-soft focus-visible:outline-danger",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-[13px]",
  md: "h-10 gap-2 rounded-md px-4 text-sm",
  lg: "h-12 gap-2 rounded-md px-6 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center font-semibold tracking-[0.01em] whitespace-nowrap transition-[background-color,color,transform] focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export const panelClass = "rounded-lg border border-line bg-card shadow-card";
export const fieldClass =
  "w-full rounded-md border border-line bg-card px-3.5 text-sm text-ink transition placeholder:text-ink-faint focus:border-primary focus:ring-[1.5px] focus:ring-primary focus:outline-none disabled:opacity-60";
