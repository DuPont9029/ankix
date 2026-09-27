import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type User } from "./current-user";
import { StorageError } from "./db";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export function jsonError(status: number, message: string, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function requireUser(options: { allowUnjoined?: boolean } = {}): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Your session has expired: please sign in again.");
  if (!user.joined && !options.allowUnjoined) {
    throw new HttpError(403, "Enter the access code to continue.", "join_required");
  }
  return user;
}

/** Avvolge un handler e converte gli errori in risposte JSON coerenti. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.message, err.code);
      if (err instanceof StorageError) return jsonError(503, err.message, "storage_unavailable");
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const path = first?.path.join(".");
        return jsonError(400, `Invalid data${path ? ` (${path})` : ""}: ${first?.message ?? ""}`);
      }
      console.error("[api]", err);
      return jsonError(500, "Internal server error.");
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid request body (JSON expected).");
  }
}
