import { useState } from 'react';

interface PostDetailAdminActionsProps {
  isAdmin: boolean;
  postId?: string;
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 12a3 3 0 1 1-1.1-2.32" />
      <path d="M17 6a3 3 0 1 0-2.83 2" />
      <path d="M17 18a3 3 0 1 0-2.83-2" />
      <path d="M8.7 10.6 14.2 7.8" />
      <path d="M8.7 13.4 14.2 16.2" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 3 6 6-3 1.2-2.4 5.4L9.8 12 4 14l5.8-5.8L8.4 5.6 12 3Z" />
      <path d="m12 15 4 4" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="m10 11 .3 6" />
      <path d="m14 11-.3 6" />
      <path d="M6 6l1 18h10l1-18" />
    </svg>
  );
}

export function PostDetailAdminActions({ isAdmin, postId }: PostDetailAdminActionsProps) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function sharePost() {
    setError(null);
    setNotice(null);

    const url = window.location.href;
    const title = document.title.replace(/\s+\|\s+Sakura Cactus$/, '');

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }

      await navigator.clipboard.writeText(url);
      setNotice('链接已复制');
    } catch {
      setError('复制失败，请手动复制链接');
    }
  }

  async function deletePost() {
    if (!postId || !window.confirm('确定删除这篇文章吗？')) {
      return;
    }

    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/admin/posts/${postId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      });

      if (!response.ok) {
        setError('删除失败，请稍后重试。');
        return;
      }

      window.location.assign('/articles');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="sc-article-action-wrap">
      <div className="sc-article-action-bar" aria-label="文章操作">
        <button className="sc-article-icon-action" onClick={sharePost} type="button" aria-label="分享" title="分享">
          <ShareIcon />
        </button>
        {isAdmin ? (
          <>
            <button
              className="sc-article-icon-action sc-article-icon-disabled"
              disabled
              type="button"
              aria-label="置顶（后续接入）"
              title="置顶（后续接入）"
            >
              <PinIcon />
            </button>
            {postId ? (
              <a className="sc-article-icon-action" href={`/write?post=${postId}`} aria-label="编辑" title="编辑">
                <PencilIcon />
              </a>
            ) : null}
            <button
              className="sc-article-icon-action sc-article-icon-danger"
              disabled={isDeleting || !postId}
              onClick={deletePost}
              type="button"
              aria-label="删除"
              title="删除"
            >
              <TrashIcon />
            </button>
          </>
        ) : null}
      </div>
      {notice ? <span className="sc-article-action-message">{notice}</span> : null}
      {error ? <span className="sc-article-action-message sc-article-action-error">{error}</span> : null}
    </div>
  );
}
