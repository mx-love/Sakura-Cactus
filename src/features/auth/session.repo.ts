import type { SessionRow, UserRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { SESSION_TTL_MS } from './auth.constants';
import { createRandomId } from './crypto.service';

export interface SessionWithUser {
  session: SessionRow;
  user: UserRow;
}

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

export async function findActiveSessionByTokenHash(
  db: D1Database,
  tokenHash: string,
  now = nowIso()
): Promise<SessionWithUser | null> {
  const row = await db
    .prepare(
      `SELECT
        sessions.id AS session_id,
        sessions.user_id AS session_user_id,
        sessions.token_hash AS session_token_hash,
        sessions.user_agent AS session_user_agent,
        sessions.ip_hash AS session_ip_hash,
        sessions.expires_at AS session_expires_at,
        sessions.created_at AS session_created_at,
        sessions.revoked_at AS session_revoked_at,
        users.id AS user_id,
        users.email AS user_email,
        users.username AS user_username,
        users.display_name AS user_display_name,
        users.password_hash AS user_password_hash,
        users.role AS user_role,
        users.status AS user_status,
        users.created_at AS user_created_at,
        users.updated_at AS user_updated_at,
        users.last_login_at AS user_last_login_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.revoked_at IS NULL
        AND sessions.expires_at > ?
        AND users.status = 'active'
      LIMIT 1`
    )
    .bind(tokenHash, now)
    .first<Record<string, string | null>>();

  if (!row) {
    return null;
  }

  return {
    session: {
      id: row.session_id ?? '',
      user_id: row.session_user_id ?? '',
      token_hash: row.session_token_hash ?? '',
      user_agent: row.session_user_agent,
      ip_hash: row.session_ip_hash,
      expires_at: row.session_expires_at ?? '',
      created_at: row.session_created_at ?? '',
      revoked_at: row.session_revoked_at
    },
    user: {
      id: row.user_id ?? '',
      email: row.user_email,
      username: row.user_username ?? '',
      display_name: row.user_display_name,
      password_hash: row.user_password_hash ?? '',
      role: 'admin',
      status: 'active',
      created_at: row.user_created_at ?? '',
      updated_at: row.user_updated_at ?? '',
      last_login_at: row.user_last_login_at
    }
  };
}

export async function findActiveSessionRecordByTokenHash(
  db: D1Database,
  tokenHash: string,
  now = nowIso()
): Promise<SessionRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, token_hash, user_agent, ip_hash, expires_at, created_at, revoked_at
       FROM sessions
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND expires_at > ?
       LIMIT 1`
    )
    .bind(tokenHash, now)
    .first<SessionRow>();
}

export async function revokeSessionByTokenHash(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(nowIso(), tokenHash)
    .run();
}
