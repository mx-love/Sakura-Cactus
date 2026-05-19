import type { UserRow } from '@/lib/database.types';
import { nowIso } from '@/lib/db';
import { createRandomId } from './crypto.service';

export interface CreateUserInput {
  username: string;
  displayName: string | null;
  passwordHash: string;
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
       FROM users
       WHERE username = ?
       LIMIT 1`
    )
    .bind(username)
    .first<UserRow>();
}

export async function findUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
       FROM users
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<UserRow>();
}

export async function createAdminUser(db: D1Database, input: CreateUserInput): Promise<UserRow> {
  const now = nowIso();
  const user: UserRow = {
    id: createRandomId('u'),
    username: input.username,
    display_name: input.displayName,
    password_hash: input.passwordHash,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
    last_login_at: null
  };

  await db
    .prepare(
      `INSERT INTO users (
        id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
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
