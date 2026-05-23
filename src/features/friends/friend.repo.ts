import { createRandomId } from '@/features/auth/crypto.service';
import { nowIso } from '@/lib/db';
import type { FriendLinkRow, FriendLinkStatus } from './friend.types';

export async function listApprovedFriendLinks(db: D1Database): Promise<FriendLinkRow[]> {
  const result = await db
    .prepare(
      `SELECT id, name, url, avatar_url, description, status, sort_order, created_at, updated_at
       FROM friend_links
       WHERE status = 'approved'
       ORDER BY created_at ASC`
    )
    .all<FriendLinkRow>();

  return result.results ?? [];
}

export async function listAdminFriendLinks(db: D1Database): Promise<FriendLinkRow[]> {
  const result = await db
    .prepare(
      `SELECT id, name, url, avatar_url, description, status, sort_order, created_at, updated_at
       FROM friend_links
       ORDER BY created_at ASC`
    )
    .all<FriendLinkRow>();

  return result.results ?? [];
}

export async function findFriendLinkById(db: D1Database, id: string): Promise<FriendLinkRow | null> {
  return db
    .prepare(
      `SELECT id, name, url, avatar_url, description, status, sort_order, created_at, updated_at
       FROM friend_links
       WHERE id = ?
       LIMIT 1`
    )
    .bind(id)
    .first<FriendLinkRow>();
}

export interface PersistedFriendLinkInput {
  name: string;
  url: string;
  avatarUrl: string | null;
  description: string | null;
  status: FriendLinkStatus;
}

export async function createFriendLink(db: D1Database, input: PersistedFriendLinkInput): Promise<FriendLinkRow> {
  const now = nowIso();
  const friend: FriendLinkRow = {
    id: createRandomId('fl'),
    name: input.name,
    url: input.url,
    avatar_url: input.avatarUrl,
    description: input.description,
    status: input.status,
    sort_order: 0,
    created_at: now,
    updated_at: now
  };

  await db
    .prepare(
      `INSERT INTO friend_links (
        id, name, url, avatar_url, description, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      friend.id,
      friend.name,
      friend.url,
      friend.avatar_url,
      friend.description,
      friend.status,
      friend.created_at,
      friend.updated_at
    )
    .run();

  return friend;
}

export async function updateFriendLink(
  db: D1Database,
  id: string,
  input: PersistedFriendLinkInput
): Promise<FriendLinkRow | null> {
  const current = await findFriendLinkById(db, id);

  if (!current) {
    return null;
  }

  await db
    .prepare(
      `UPDATE friend_links
       SET name = ?,
           url = ?,
           avatar_url = ?,
           description = ?,
           status = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .bind(
      input.name,
      input.url,
      input.avatarUrl,
      input.description,
      input.status,
      nowIso(),
      id
    )
    .run();

  return findFriendLinkById(db, id);
}

export async function deleteFriendLink(db: D1Database, id: string): Promise<FriendLinkRow | null> {
  const current = await findFriendLinkById(db, id);

  if (!current) {
    return null;
  }

  await db.prepare('DELETE FROM friend_links WHERE id = ?').bind(id).run();
  return current;
}
