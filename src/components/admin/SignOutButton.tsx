import { useState } from 'react';

export function SignOutButton() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleClick() {
    setIsSubmitting(true);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin'
      });
      window.location.assign('/admin/login');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <button
      className="sc-button sc-button-secondary w-full disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting}
      onClick={handleClick}
      type="button"
    >
      {isSubmitting ? '退出中...' : '退出'}
    </button>
  );
}
