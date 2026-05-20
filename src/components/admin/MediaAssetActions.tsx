import { useState } from 'react';
import type { AssetVisibility } from '@/features/assets/asset.types';

interface MediaAssetActionsProps {
  assetId: string;
  token: string;
  visibility: AssetVisibility;
}

export function MediaAssetActions({ assetId, token, visibility }: MediaAssetActionsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    <div className="flex flex-wrap gap-2">
      <button
        className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold"
        onClick={copyUrl}
        type="button"
      >
        Copy /i URL
      </button>
      {visibility !== 'public' ? (
        <button
          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => setVisibility('public')}
          type="button"
        >
          Set public
        </button>
      ) : (
        <button
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => setVisibility('draft')}
          type="button"
        >
          Set draft
        </button>
      )}
      <button
        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
        disabled={isSubmitting}
        onClick={deleteAsset}
        type="button"
      >
        Delete image
      </button>
    </div>
  );
}
