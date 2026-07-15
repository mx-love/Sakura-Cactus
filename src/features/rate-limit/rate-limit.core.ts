import { sha256Base64Url } from '../auth/crypto.service.ts';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitInput {
  scope: string;
  key: string;
  secret: string;
  limit: number;
  windowSeconds: number;
}

interface RateLimitWindow {
  windowStart: string;
  expiresAt: string;
  retryAfterSeconds: number;
}

export function getRateLimitWindow(now: number, windowSeconds: number): RateLimitWindow {
  const windowMs = windowSeconds * 1_000;
  const windowStartMs = Math.floor(now / windowMs) * windowMs;
  const expiresAtMs = windowStartMs + windowMs;

  return {
    windowStart: new Date(windowStartMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((expiresAtMs - now) / 1_000))
  };
}

export function normalizeRateLimitKey(key: string): string {
  return key.trim().toLowerCase().slice(0, 256) || 'unknown';
}

async function hashRateLimitKey(input: { scope: string; key: string; secret: string }): Promise<string> {
  return sha256Base64Url(`${input.secret}.${input.scope}.${normalizeRateLimitKey(input.key)}`);
}

export async function consumeRateLimitWithDb(
  db: D1Database,
  input: RateLimitInput,
  now = Date.now()
): Promise<RateLimitResult> {
  const window = getRateLimitWindow(now, input.windowSeconds);
  const keyHash = await hashRateLimitKey(input);
  const updatedAt = new Date(now).toISOString();

  await db
    .prepare(
      `DELETE FROM rate_limits
       WHERE rowid IN (
         SELECT rowid
         FROM rate_limits
         WHERE expires_at <= ?
         LIMIT 100
       )`
    )
    .bind(updatedAt)
    .run();
  await db
    .prepare(
      `INSERT INTO rate_limits (scope, key_hash, window_start, count, expires_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT(scope, key_hash, window_start)
       DO UPDATE SET count = count + 1, updated_at = excluded.updated_at`
    )
    .bind(input.scope, keyHash, window.windowStart, window.expiresAt, updatedAt)
    .run();

  const row = await db
    .prepare(
      `SELECT count
       FROM rate_limits
       WHERE scope = ? AND key_hash = ? AND window_start = ?
       LIMIT 1`
    )
    .bind(input.scope, keyHash, window.windowStart)
    .first<{ count: number }>();
  const count = row?.count ?? input.limit + 1;

  return {
    allowed: count <= input.limit,
    limit: input.limit,
    remaining: Math.max(0, input.limit - count),
    retryAfterSeconds: window.retryAfterSeconds
  };
}

export async function clearRateLimitWithDb(
  db: D1Database,
  input: Pick<RateLimitInput, 'scope' | 'key' | 'secret'>
): Promise<void> {
  const keyHash = await hashRateLimitKey(input);

  await db
    .prepare('DELETE FROM rate_limits WHERE scope = ? AND key_hash = ?')
    .bind(input.scope, keyHash)
    .run();
}
