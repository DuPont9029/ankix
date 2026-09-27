"use client";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** fetch JSON con gestione uniforme degli errori (messaggi in italiano dal server). */
export async function api<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "Connection failed. Check your network and try again.");
  }
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    // Ricarica completa voluta: azzera lo stato del client dopo la scadenza della sessione.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new ApiClientError(401, "Your session has expired.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string; code?: string }) | null;
  if (!res.ok) {
    throw new ApiClientError(res.status, data?.error || `Error ${res.status}`, data?.code);
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred.";
}
