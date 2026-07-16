import { useState } from 'react';
import { clearWriterAutosaveSnapshot, getPostAutosaveKey } from './postEditorAutosave';

interface PostRowActionsProps {
  postId: string;
}

export function PostRowActions({ postId }: PostRowActionsProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function deletePost() {
    if (!window.confirm('确定永久删除这篇文章吗？')) {
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });

      if (response.ok) {
        clearWriterAutosaveSnapshot(getPostAutosaveKey(postId));
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
        编辑
      </a>
      <button
        className="sc-button sc-button-danger sc-button-small disabled:opacity-60"
        disabled={isSubmitting}
        onClick={deletePost}
        type="button"
      >
        删除文章
      </button>
    </div>
  );
}
