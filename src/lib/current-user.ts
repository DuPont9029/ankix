import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { isAdminEmail, isEmailAllowed, joinCodeRequired } from "./access";
import { getAuth } from "./auth";
import { exec, transaction } from "./db";
import { newId } from "./repo";

export type User = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  /** Amministratore (ADMIN_EMAILS): genera i codici di accesso */
  isAdmin: boolean;
  /** false se è richiesto il codice di accesso e non è ancora stato inserito */
  joined: boolean;
};

type UserRow = { id: string; email: string; name: string; image: string | null; joined_at: unknown };

async function upsertUser(email: string, name: string, image: string | null): Promise<UserRow> {
  const normalized = email.trim().toLowerCase();
  const displayName = name.trim() || normalized.split("@")[0];
  return transaction(async (tx) => {
    const existing = await tx.query<UserRow>(`SELECT id FROM users WHERE email = $1`, [normalized]);
    if (existing.length === 0) {
      const id = newId();
      await tx.exec(
        `INSERT INTO users (id, email, name, image, joined_at, created_at) VALUES ($1, $2, $3, $4, NULL, $5)`,
        [id, normalized, displayName, image, Date.now()],
      );
    }
    const [row] = await tx.query<UserRow>(`SELECT id, email, name, image, joined_at FROM users WHERE email = $1`, [normalized]);

    // Migrazione: mazzi e materiali creati prima dell'accesso con account (senza proprietario) vanno
    // all'utente con lo stesso nome; se non c'è corrispondenza li prende un amministratore.
    // Prima si controlla in sola lettura, così di norma non si scrive nulla.
    const admin = isAdminEmail(normalized);
    const [orphans] = await tx.query<{ d: unknown; m: unknown }>(
      `SELECT (SELECT count(*) FROM decks WHERE created_by_id IS NULL AND (created_by = $1 OR $2)) AS d,
              (SELECT count(*) FROM materials WHERE uploaded_by_id IS NULL AND (uploaded_by = $1 OR $2)) AS m`,
      [displayName, admin],
    );
    if (Number(orphans.d) > 0) {
      await tx.exec(`UPDATE decks SET created_by_id = $1 WHERE created_by_id IS NULL AND (created_by = $2 OR $3)`, [row.id, displayName, admin]);
    }
    if (Number(orphans.m) > 0) {
      await tx.exec(`UPDATE materials SET uploaded_by_id = $1 WHERE uploaded_by_id IS NULL AND (uploaded_by = $2 OR $3)`, [row.id, displayName, admin]);
    }
    if (row.name !== displayName || (row.image ?? null) !== image) {
      await tx.exec(`UPDATE users SET name = $1, image = $2 WHERE id = $3`, [displayName, image, row.id]);
      return { ...row, name: displayName, image };
    }
    return row;
  });
}

/** Utente autenticato (sessione Better Auth + record DuckDB), deduplicato per richiesta. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() }).catch(() => null);
  if (!session?.user?.email) return null;
  if (!isEmailAllowed(session.user.email)) return null;
  const row = await upsertUser(session.user.email, session.user.name ?? "", session.user.image ?? null);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image ?? null,
    isAdmin: isAdminEmail(row.email),
    joined: !joinCodeRequired() || isAdminEmail(row.email) || row.joined_at != null,
  };
});

export async function markJoined(userId: string): Promise<void> {
  await exec(`UPDATE users SET joined_at = $1 WHERE id = $2 AND joined_at IS NULL`, [Date.now(), userId]);
}
