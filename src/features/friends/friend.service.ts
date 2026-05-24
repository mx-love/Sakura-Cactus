import { getDb } from '@/lib/db';
import type { FriendLinkInput, FriendLinkRow, FriendLinkStatus } from './friend.types';
import {
  createFriendLink,
  deleteFriendLink,
  listAdminFriendLinks,
  listApprovedFriendLinks,
  updateFriendLink,
  updateFriendHealth,
  type PersistedFriendLinkInput
} from './friend.repo';
import { getSiteSettings } from '@/features/settings/settings.service';
import type { FriendHealthStatus } from './friend.types';

const FRIEND_STATUSES: FriendLinkStatus[] = ['approved', 'hidden', 'pending'];
const FRIEND_HEALTH_USER_AGENT = 'Sakura-Cactus-Check/1.0';
const FRIEND_HEALTH_TIMEOUT_MS = 8000;

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

interface FriendHealthCheckResult {
  friend: FriendLinkRow;
  healthStatus: FriendHealthStatus;
  statusCode: number | null;
  error: string | null;
}

export interface FriendHealthCheckStats {
  scanned: number;
  ok: number;
  warning: number;
  down: number;
}

function classifyStatus(status: number): FriendHealthStatus {
  if (status >= 200 && status <= 399) {
    return 'ok';
  }

  if ([403, 405, 429].includes(status)) {
    return 'warning';
  }

  return 'down';
}

async function fetchWithTimeout(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FRIEND_HEALTH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      redirect: 'follow',
      headers: {
        'User-Agent': FRIEND_HEALTH_USER_AGENT
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkFriendLink(friend: FriendLinkRow): Promise<FriendHealthCheckResult> {
  try {
    let response = await fetchWithTimeout(friend.url, 'HEAD');

    if (response.status === 405) {
      response = await fetchWithTimeout(friend.url, 'GET');
    }

    return {
      friend,
      healthStatus: classifyStatus(response.status),
      statusCode: response.status,
      error: null
    };
  } catch (error) {
    return {
      friend,
      healthStatus: 'down',
      statusCode: null,
      error: error instanceof Error ? error.message.slice(0, 200) : 'Network error'
    };
  }
}

export async function checkApprovedFriendLinksHealth(): Promise<FriendHealthCheckStats> {
  const db = getDb();
  const friends = await listApprovedFriendLinks(db);
  const stats: FriendHealthCheckStats = {
    scanned: friends.length,
    ok: 0,
    warning: 0,
    down: 0
  };

  for (const friend of friends) {
    const result = await checkFriendLink(friend);
    const consecutiveFailures = result.healthStatus === 'down' ? friend.consecutive_failures + 1 : 0;

    await updateFriendHealth(db, friend.id, {
      healthStatus: result.healthStatus,
      statusCode: result.statusCode,
      error: result.error,
      consecutiveFailures
    });

    if (result.healthStatus === 'ok') {
      stats.ok += 1;
    } else if (result.healthStatus === 'warning') {
      stats.warning += 1;
    } else {
      stats.down += 1;
    }
  }

  return stats;
}

export async function checkApprovedFriendLinksHealthIfEnabled(): Promise<FriendHealthCheckStats | null> {
  const settings = await getSiteSettings();

  if (!settings.friendHealthEnabled) {
    return null;
  }

  return checkApprovedFriendLinksHealth();
}

export type { FriendLinkInput };
