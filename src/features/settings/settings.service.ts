import { getDb, nowIso } from '@/lib/db';
import { listSiteSettings, upsertSiteSetting, incrementPostViewCount as incrementCount, getPostViewCount as readCount } from './settings.repo';
import type { CommentProvider, SiteSettings, SiteSettingsInput } from './settings.types';

const COMMENT_PROVIDERS: CommentProvider[] = ['off', 'giscus', 'utterances', 'waline', 'artalk', 'custom'];

export class SiteSettingsValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SiteSettingsValidationError';
  }
}

const DEFAULT_SETTINGS: SiteSettings = {
  friendApplyEnabled: false,
  commentEnabled: false,
  commentProvider: 'off',
  commentConfig: {},
  viewCountEnabled: false,
  faviconUrl: '',
  maintenanceLastRunAt: ''
};

function parseBoolean(value: string | undefined): boolean {
  return value === 'true';
}

function parseJsonObject(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, item]) => [key, typeof item === 'string' ? item : String(item ?? '')])
    );
  } catch {
    return {};
  }
}

function assertOptionalHttpUrl(value: string, code: string, message: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('Invalid protocol');
    }

    return url.toString();
  } catch {
    throw new SiteSettingsValidationError(code, message);
  }
}

function normalizeConfig(value: Record<string, unknown> | undefined): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : String(item ?? '').trim()])
  );
}

export function isSiteSettingsValidationError(error: unknown): error is SiteSettingsValidationError {
  return error instanceof SiteSettingsValidationError;
}

export async function getSiteSettings(): Promise<SiteSettings> {
  const rows = await listSiteSettings(getDb());
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    friendApplyEnabled: parseBoolean(values.friend_apply_enabled),
    commentEnabled: parseBoolean(values.comment_enabled),
    commentProvider: COMMENT_PROVIDERS.includes(values.comment_provider as CommentProvider)
      ? (values.comment_provider as CommentProvider)
      : DEFAULT_SETTINGS.commentProvider,
    commentConfig: parseJsonObject(values.comment_config),
    viewCountEnabled: parseBoolean(values.view_count_enabled),
    faviconUrl: values.favicon_url ?? DEFAULT_SETTINGS.faviconUrl,
    maintenanceLastRunAt: values.maintenance_last_run_at ?? DEFAULT_SETTINGS.maintenanceLastRunAt
  };
}

export async function updateSiteSettings(input: SiteSettingsInput): Promise<SiteSettings> {
  const db = getDb();
  const writes: Array<[string, string]> = [];

  if (typeof input.friendApplyEnabled === 'boolean') {
    writes.push(['friend_apply_enabled', String(input.friendApplyEnabled)]);
  }

  if (typeof input.commentEnabled === 'boolean') {
    writes.push(['comment_enabled', String(input.commentEnabled)]);
  }

  if (input.commentProvider) {
    if (!COMMENT_PROVIDERS.includes(input.commentProvider)) {
      throw new SiteSettingsValidationError('INVALID_COMMENT_PROVIDER', 'Invalid comment provider.');
    }

    writes.push(['comment_provider', input.commentProvider]);
  }

  if (input.commentConfig) {
    writes.push(['comment_config', JSON.stringify(normalizeConfig(input.commentConfig))]);
  }

  if (typeof input.viewCountEnabled === 'boolean') {
    writes.push(['view_count_enabled', String(input.viewCountEnabled)]);
  }

  if (typeof input.faviconUrl === 'string') {
    writes.push(['favicon_url', assertOptionalHttpUrl(input.faviconUrl, 'INVALID_FAVICON_URL', 'Favicon URL must be http or https.')]);
  }

  for (const [key, value] of writes) {
    await upsertSiteSetting(db, key, value);
  }

  return getSiteSettings();
}

export async function updateMaintenanceLastRunAt(): Promise<void> {
  await upsertSiteSetting(getDb(), 'maintenance_last_run_at', nowIso());
}

export async function incrementPostViewCount(postId: string): Promise<number> {
  return incrementCount(getDb(), postId);
}

export async function getPostViewCount(postId: string): Promise<number> {
  return readCount(getDb(), postId);
}
