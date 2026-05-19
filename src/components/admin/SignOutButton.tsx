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
      className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={isSubmitting}
      onClick={handleClick}
      type="button"
    >
      {isSubmitting ? 'Signing out...' : 'Sign out'}
    </button>
  );
}
