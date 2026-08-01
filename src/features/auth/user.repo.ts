import type { UserRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';

export const ENV_ADMIN_USER_ID = 'env_admin';
const ENV_ADMIN_DB_USERNAME = '__env_admin__';
const ENV_ADMIN_PASSWORD_MARKER = '__environment_password__';

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, email, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
       FROM users
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<UserRow>();
}

export async function ensureEnvironmentAdminUser(db: D1Database): Promise<UserRow> {
  const now = nowIso();
  const existing = await findUserById(db, ENV_ADMIN_USER_ID);

  if (existing) {
    await db
      .prepare(
        `UPDATE users
         SET username = ?, display_name = ?, password_hash = ?, role = 'admin', status = 'active', updated_at = ?
         WHERE id = ?`
      )
      .bind(ENV_ADMIN_DB_USERNAME, 'Environment administrator', ENV_ADMIN_PASSWORD_MARKER, now, ENV_ADMIN_USER_ID)
      .run();

    return {
      ...existing,
      username: ENV_ADMIN_DB_USERNAME,
      display_name: 'Environment administrator',
      password_hash: ENV_ADMIN_PASSWORD_MARKER,
      role: 'admin',
      status: 'active',
      updated_at: now
    };
  }

  const user: UserRow = {
    id: ENV_ADMIN_USER_ID,
    email: null,
    username: ENV_ADMIN_DB_USERNAME,
    display_name: 'Environment administrator',
    password_hash: ENV_ADMIN_PASSWORD_MARKER,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: null
  };

  await db
    .prepare(
      `INSERT INTO users (
        id, email, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      user.email,
      user.username,
      user.display_name,
      user.password_hash,
      user.role,
      user.status,
      user.created_at,
      user.updated_at,
      user.last_login_at
    )
    .run();

  return user;
}

export async function updateLastLogin(db: D1Database, userId: string): Promise<void> {
  const now = nowIso();

  await db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').bind(now, now, userId).run();
}
