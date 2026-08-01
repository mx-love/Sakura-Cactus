import type { SessionRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { SESSION_TTL_MS } from './auth.constants';
import { createRandomId } from './crypto.service';

export async function createSession(
  db: D1Database,
  input: {
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipHash: string | null;
  }
): Promise<SessionRow> {
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const session: SessionRow = {
    id: createRandomId('s'),
    user_id: input.userId,
    token_hash: input.tokenHash,
    user_agent: input.userAgent,
    ip_hash: input.ipHash,
    expires_at: expiresAt,
    created_at: now,
    revoked_at: null
  };

  await db
    .prepare(
      `INSERT INTO sessions (
        id, user_id, token_hash, user_agent, ip_hash, expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      session.id,
      session.user_id,
      session.token_hash,
      session.user_agent,
      session.ip_hash,
      session.expires_at,
      session.created_at,
      session.revoked_at
    )
    .run();

  return session;
}

export async function findActiveSessionRecordByTokenHash(
  db: D1Database,
  tokenHash: string,
  expectedUserId: string,
  now = nowIso()
): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, token_hash, user_agent, ip_hash, expires_at, created_at, revoked_at
       FROM sessions
       WHERE token_hash = ?
         AND user_id = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       LIMIT 1`
    )
    .bind(tokenHash, expectedUserId, now)
    .first<SessionRow>();
}

export async function revokeSessionByTokenHash(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(nowIso(), tokenHash)
    .run();
}

export async function cleanupStaleSessions(db: D1Database, now = nowIso()): Promise<number> {
  const revokedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
  const result = await db
    .prepare(
      `DELETE FROM sessions
       WHERE expires_at <= ?
          OR (revoked_at IS NOT NULL AND revoked_at <= ?)`
    )
    .bind(now, revokedCutoff)
    .run();

  return result.meta.changes ?? 0;
}
