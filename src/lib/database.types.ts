export type UserRole = 'admin';
export type UserStatus = 'active' | 'disabled';
export type PostStatus = 'draft' | 'published' | 'archived' | 'deleted';
export type PostVisibility = 'public' | 'private';
export type AssetVisibility = 'draft' | 'public' | 'private' | 'deleted';
export type AssetRole = 'inline' | 'cover';
export type SettingType = 'string' | 'number' | 'boolean' | 'json';
export type FriendLinkStatus = 'approved' | 'hidden' | 'pending';
export type FriendHealthStatus = 'unknown' | 'ok' | 'warning' | 'down';

export interface UserRow {
  id: string;
  email: string | null;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  user_agent: string | null;
  ip_hash: string | null;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
}

export interface PostRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content_markdown: string;
  content_html: string | null;
  cover_asset_id: string | null;
  status: PostStatus;
  visibility: PostVisibility;
  seo_title: string | null;
  seo_description: string | null;
  reading_time_minutes: number;
  word_count: number;
  published_at: string | null;
  pinned_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostTagRow {
  post_id: string;
  tag_id: string;
}

export interface AssetRow {
  id: string;
  token: string;
  r2_key: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  visibility: AssetVisibility;
  usage_count: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PostAssetRow {
  post_id: string;
  asset_id: string;
  role: AssetRole;
  created_at: string;
}

export interface SettingRow {
  key: string;
  value: string;
  type: SettingType;
  updated_at: string;
}

export interface FriendLinkRow {
  id: string;
  name: string;
  url: string;
  avatar_url: string | null;
  description: string | null;
  status: FriendLinkStatus;
  sort_order: number;
  health_status: FriendHealthStatus;
  last_checked_at: string | null;
  last_status_code: number | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface SiteSettingRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface PostViewCountRow {
  post_id: string;
  count: number;
  updated_at: string;
}

export interface AuditLogRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  metadata_json: string | null;
  created_at: string;
}
