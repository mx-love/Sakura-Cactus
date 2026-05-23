import { getDb } from '@/lib/db';
import type { FriendLinkInput, FriendLinkRow, FriendLinkStatus } from './friend.types';
import {
  createFriendLink,
  deleteFriendLink,
  listAdminFriendLinks,
  listApprovedFriendLinks,
  updateFriendLink,
  type PersistedFriendLinkInput
} from './friend.repo';

const FRIEND_STATUSES: FriendLinkStatus[] = ['approved', 'hidden', 'pending'];

export class FriendLinkValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'FriendLinkValidationError';
  }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseHttpUrl(value: string, field: string): string {
  if (!value) {
    throw new FriendLinkValidationError('INVALID_FRIEND_URL', `${field} must be a valid http or https URL.`);
  }

  if (value.length > 500) {
    throw new FriendLinkValidationError('INVALID_FRIEND_URL', `${field} is too long.`);
  }

  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }

    return url.toString();
  } catch {
    throw new FriendLinkValidationError('INVALID_FRIEND_URL', `${field} must be a valid http or https URL.`);
  }
}

function parseOptionalHttpUrl(value: string, field: string): string | null {
  if (!value) {
    return null;
  }

  return parseHttpUrl(value, field);
}

function normalizeFriendInput(raw: unknown): PersistedFriendLinkInput {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const name = readString(input.name);
  const url = readString(input.url);
  const avatarUrl = readString(input.avatarUrl ?? input.avatar_url);
  const description = readString(input.description);
  const rawStatus = readString(input.status);

  if (!name) {
    throw new FriendLinkValidationError('FRIEND_NAME_REQUIRED', 'Friend name is required.');
  }

  return {
    name: name.slice(0, 80),
    url: parseHttpUrl(url, 'URL'),
    avatarUrl: parseOptionalHttpUrl(avatarUrl, 'Avatar URL'),
    description: description ? description.slice(0, 200) : null,
    status: FRIEND_STATUSES.includes(rawStatus as FriendLinkStatus) ? (rawStatus as FriendLinkStatus) : 'approved'
  };
}

function normalizeFriendApplicationInput(raw: unknown): PersistedFriendLinkInput {
  return {
    ...normalizeFriendInput(raw),
    status: 'pending'
  };
}

export function isFriendLinkValidationError(error: unknown): error is FriendLinkValidationError {
  return error instanceof FriendLinkValidationError;
}

export async function getApprovedFriendLinks(): Promise<FriendLinkRow[]> {
  return listApprovedFriendLinks(getDb());
}

export async function getAdminFriendLinks(): Promise<FriendLinkRow[]> {
  return listAdminFriendLinks(getDb());
}

export async function createAdminFriendLink(raw: unknown): Promise<FriendLinkRow> {
  return createFriendLink(getDb(), normalizeFriendInput(raw));
}

export async function createFriendLinkApplication(raw: unknown): Promise<FriendLinkRow> {
  return createFriendLink(getDb(), normalizeFriendApplicationInput(raw));
}

export async function updateAdminFriendLink(id: string, raw: unknown): Promise<FriendLinkRow | null> {
  return updateFriendLink(getDb(), id, normalizeFriendInput(raw));
}

export async function deleteAdminFriendLink(id: string): Promise<FriendLinkRow | null> {
  return deleteFriendLink(getDb(), id);
}

export type { FriendLinkInput };
