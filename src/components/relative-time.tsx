"use client";

import { formatDate, formatRelative } from "@/lib/format";

export function RelativeTime({ ms }: { ms: number }) {
  return (
    <time dateTime={new Date(ms).toISOString()} title={formatDate(ms)} suppressHydrationWarning>
      {formatRelative(ms)}
    </time>
  );
}
