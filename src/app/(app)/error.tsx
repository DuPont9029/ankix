"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-md border border-danger/30 bg-danger-soft text-danger">
        <AlertTriangle className="size-6" />
      </div>
      <h1 className="font-serif text-[26px] font-semibold text-heading">Something went wrong</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        The page could not be loaded. If the problem persists, check the server configuration
        {error.digest ? ` (code ${error.digest})` : ""}.
      </p>
      <Button className="mt-6" onClick={reset}>
        <RotateCcw className="size-4" /> Try again
      </Button>
    </div>
  );
}
