import type { FriendHealthStatus, FriendLinkRow, FriendLinkStatus } from '@/lib/database.types';

export type { FriendHealthStatus, FriendLinkRow, FriendLinkStatus };

export interface FriendLinkInput {
  name: string;
  url: string;
  avatarUrl?: string | null;
  description?: string | null;
  status?: FriendLinkStatus;
}
