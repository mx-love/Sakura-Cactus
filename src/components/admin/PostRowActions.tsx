import { useState } from 'react';

interface PostRowActionsProps {
  postId: string;
  status: string;
}

export function PostRowActions({ postId, status }: PostRowActionsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function mutate(endpoint: string, method = 'POST') {
    setIsSubmitting(true);

    try {
      const response = await fetch(endpoint, {
        method,
        credentials: 'same-origin'
      });

      if (response.ok) {
        window.location.reload();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)]"
        href={`/admin/posts/${postId}`}
      >
        Edit
      </a>
      {status === 'published' ? (
        <button
          className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => mutate(`/api/admin/posts/${postId}/unpublish`)}
          type="button"
        >
          Unpublish
        </button>
      ) : (
        <button
          className="rounded-lg bg-[var(--color-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--color-text)] disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => mutate(`/api/admin/posts/${postId}/publish`)}
          type="button"
        >
          Publish
        </button>
      )}
      <button
        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 disabled:opacity-60"
        disabled={isSubmitting}
        onClick={() => mutate(`/api/admin/posts/${postId}`, 'DELETE')}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}
