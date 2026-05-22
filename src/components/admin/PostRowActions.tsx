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

  async function deletePost() {
    if (!window.confirm('Delete this post? This will remove it from the public site.')) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });

      if (response.ok) {
        window.location.assign('/articles');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <a
        className="sc-button sc-button-secondary sc-button-small"
        href={`/write?post=${postId}`}
      >
        Edit
      </a>
      {status === 'published' ? (
        <button
          className="sc-button sc-button-secondary sc-button-small disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => mutate(`/api/admin/posts/${postId}/unpublish`)}
          type="button"
        >
          Unpublish
        </button>
      ) : (
        <button
          className="sc-button sc-button-primary sc-button-small disabled:opacity-60"
          disabled={isSubmitting}
          onClick={() => mutate(`/api/admin/posts/${postId}/publish`)}
          type="button"
        >
          Publish
        </button>
      )}
      <button
        className="sc-button sc-button-danger sc-button-small disabled:opacity-60"
        disabled={isSubmitting}
        onClick={deletePost}
        type="button"
      >
        Delete
      </button>
    </div>
  );
}
