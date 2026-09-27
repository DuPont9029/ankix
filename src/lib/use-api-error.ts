"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { ApiClientError, errorMessage } from "./client";

/** Mostra l'errore in un toast; se manca la chiave Gemini offre il link alle impostazioni. */
export function useApiErrorToast() {
  const router = useRouter();
  return useCallback(
    (err: unknown) => {
      if (err instanceof ApiClientError && err.code === "missing_gemini_key") {
        toast.error(err.message, { action: { label: "Settings", onClick: () => router.push("/settings") } });
        return;
      }
      toast.error(errorMessage(err));
    },
    [router],
  );
}
