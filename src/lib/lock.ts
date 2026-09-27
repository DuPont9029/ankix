import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "./env";
import { deleteObject, getObjectBytesIfExists, putObject } from "./s3";

/*
 * Lock distribuito per le scritture sul database (più istanze serverless in parallelo).
 *
 * - Con UPSTASH_REDIS_REST_URL/TOKEN usa Redis (SET NX PX): atomico e veloce.
 * - Altrimenti usa un "lease" su S3. Il bucket (es. Cubbit) non supporta le scritture condizionali,
 *   quindi il lock si ottiene così: si legge il lock; se è libero (o scaduto) si scrive il proprio token;
 *   si attende SETTLE_MS e si rilegge: vince chi trova ancora il proprio token. In più, se tra la lettura
 *   iniziale e il completamento della scrittura passa più di SETTLE_MS/2, il tentativo viene scartato:
 *   così due istanze non possono credere entrambe di avere il lock (richiede letture consistenti dopo
 *   scrittura, garantite dai provider S3 moderni).
 * - Il lock scade dopo LOCK_TTL_MS: un'istanza interrotta non blocca le altre per sempre.
 */

const LOCK_TTL_MS = 30_000;
const SAFETY_MARGIN_MS = 8_000;
const SETTLE_MS = 800;
const ACQUIRE_TIMEOUT_MS = 25_000;

export class LockTimeoutError extends Error {}

export type WriteLock = {
  /** Lancia se il lock potrebbe essere scaduto (non si deve più scrivere). */
  assertValid: () => void;
  release: () => Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (base: number) => base + Math.floor(Math.random() * base);

function lockName(): string {
  const prefix = env.s3Prefix ? `${env.s3Prefix}/` : "";
  return `${prefix}db/lock.json`;
}

function makeHandle(acquiredAt: number, release: () => Promise<void>): WriteLock {
  return {
    assertValid() {
      if (Date.now() - acquiredAt > LOCK_TTL_MS - SAFETY_MARGIN_MS) {
        throw new Error("Lock di scrittura scaduto durante l'operazione");
      }
    },
    release,
  };
}

// ---------- Redis (Upstash REST) ----------

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const cfg = redisConfig()!;
  const res = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { result?: unknown; error?: string } | null;
  if (!res.ok || !data || data.error) throw new Error(`Redis: ${data?.error ?? res.status}`);
  return data.result;
}

const RELEASE_SCRIPT = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

async function acquireRedis(): Promise<WriteLock> {
  const key = `ankix:${lockName()}`;
  const token = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const started = Date.now();
    if ((await redis(["SET", key, token, "NX", "PX", LOCK_TTL_MS])) === "OK") {
      return makeHandle(started, async () => {
        await redis(["EVAL", RELEASE_SCRIPT, 1, key, token]).catch(() => undefined);
      });
    }
    await sleep(jitter(100));
  }
  throw new LockTimeoutError("Timeout del lock di scrittura (Redis)");
}

// ---------- Lease su S3 ----------

type LeaseBody = { token: string; expiresAt: number };

async function readLease(): Promise<LeaseBody | null> {
  const bytes = await getObjectBytesIfExists(lockName());
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as LeaseBody;
  } catch {
    return null;
  }
}

async function acquireS3(): Promise<WriteLock> {
  const token = randomUUID();
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const started = Date.now();
    const current = await readLease();
    if (current && current.token !== token && current.expiresAt > Date.now()) {
      await sleep(jitter(250));
      continue;
    }
    const body: LeaseBody = { token, expiresAt: started + LOCK_TTL_MS };
    await putObject(lockName(), new TextEncoder().encode(JSON.stringify(body)), "application/json");
    const written = Date.now();
    if (written - started > SETTLE_MS / 2) {
      // Troppo lento: un'altra istanza potrebbe aver letto il lock libero nel frattempo. Si ritira.
      const mine = await readLease();
      if (mine?.token === token) await deleteObject(lockName()).catch(() => undefined);
      await sleep(jitter(250));
      continue;
    }
    await sleep(SETTLE_MS);
    const check = await readLease();
    if (check?.token === token) {
      return makeHandle(started, async () => {
        const mine = await readLease().catch(() => null);
        if (mine?.token === token) await deleteObject(lockName()).catch(() => undefined);
      });
    }
    await sleep(jitter(250));
  }
  throw new LockTimeoutError("Timeout del lock di scrittura (S3)");
}

export function acquireWriteLock(): Promise<WriteLock> {
  return redisConfig() ? acquireRedis() : acquireS3();
}

export function lockBackend(): "redis" | "s3" {
  return redisConfig() ? "redis" : "s3";
}
