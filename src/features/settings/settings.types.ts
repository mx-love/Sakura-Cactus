import type { SiteSettingRow } from '@/lib/database.types';

export type { SiteSettingRow };

export type CommentProvider = 'off' | 'giscus' | 'utterances' | 'waline' | 'artalk' | 'custom';

export interface SiteSettings {
  friendApplyEnabled: boolean;
  commentEnabled: boolean;
  commentProvider: CommentProvider;
  commentConfig: Record<string, string>;
  viewCountEnabled: boolean;
  faviconUrl: string;
  maintenanceLastRunAt: string;
}

export interface SiteSettingsInput {
  friendApplyEnabled?: boolean;
  commentEnabled?: boolean;
  commentProvider?: CommentProvider;
  commentConfig?: Record<string, unknown>;
  viewCountEnabled?: boolean;
  faviconUrl?: string;
}
