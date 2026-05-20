import { useMemo, useState } from 'react';

interface LoginFormProps {
  next?: string;
}

interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function LoginForm({ next = '/admin' }: LoginFormProps) {
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTo = useMemo(() => (next.startsWith('/') ? next : '/admin'), [next]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          account,
          password
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setError(payload?.error.message ?? 'Invalid account or password.');
        return;
      }

      window.location.assign(redirectTo);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="account">
          Account
        </label>
        <input
          id="account"
          name="account"
          autoComplete="username"
          value={account}
          onChange={(event) => setAccount(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-base outline-none focus:border-[var(--color-primary)]"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-base outline-none focus:border-[var(--color-primary)]"
          required
        />
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-[var(--color-text)] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
