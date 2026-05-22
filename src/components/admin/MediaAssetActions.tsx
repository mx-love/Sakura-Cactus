import { useState } from 'react';
import type { AssetVisibility } from '@/features/assets/asset.types';

interface MediaAssetActionsProps {
  assetId: string;
  token: string;
  visibility: AssetVisibility;
  usageCount?: number;
}

export function MediaAssetActions({ assetId, token, visibility, usageCount = 0 }: MediaAssetActionsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isReferenced = usageCount > 0;

  async function setVisibility(nextVisibility: Exclude<AssetVisibility, 'deleted'>) {
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/assets/${assetId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          visibility: nextVisibility
        })
      });

      if (response.ok) {
        window.location.reload();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function deleteAsset() {
    if (!window.confirm('Delete this image? Existing image links will return 404.')) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/assets/${assetId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });

      if (response.ok) {
        window.location.reload();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(`/i/${token}`);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          className="sc-button sc-button-secondary sc-button-small"
          onClick={copyUrl}
          type="button"
        >
          Copy URL
        </button>
        {visibility !== 'public' ? (
          <button
            className="sc-button sc-button-primary sc-button-small disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => setVisibility('public')}
            type="button"
          >
            Set public
          </button>
        ) : (
          <button
            className="sc-button sc-button-secondary sc-button-small disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => setVisibility('draft')}
            type="button"
          >
            Set draft
          </button>
        )}
        <button
          className="sc-button sc-button-danger sc-button-small disabled:opacity-50"
          disabled={isSubmitting || isReferenced}
          onClick={deleteAsset}
          title={isReferenced ? 'Remove this image from all posts before deleting it.' : 'Delete image'}
          type="button"
        >
          Delete
        </button>
      </div>
      {isReferenced ? <p className="text-xs leading-5 text-[var(--color-muted)]">Remove from posts before deleting.</p> : null}
    </div>
  );
}
