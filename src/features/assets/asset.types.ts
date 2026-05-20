import type { AssetRow, AssetVisibility } from '@/lib/database.types';

export type { AssetRow, AssetVisibility };

export interface UploadedAssetInput {
  file: File;
  createdBy: string;
}

export interface CreateAssetRecordInput {
  token: string;
  r2Key: string;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  createdBy: string;
}

export interface PublicAssetAccess {
  asset: AssetRow;
  isPublic: boolean;
}
