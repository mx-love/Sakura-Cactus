import { useMemo, useState } from 'react';
import { normalizeInternalRedirect } from '@/lib/security/request';

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

const DEFAULT_REDIRECT = '/write';

export function LoginForm({ next = '/write' }: LoginFormProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectTo = useMemo(() => normalizeInternalRedirect(next, DEFAULT_REDIRECT), [next]);

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
          username,
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
        <label className="block text-sm font-bold text-[var(--color-text)]" htmlFor="username">
          用户名
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          className="sc-input"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-bold text-[var(--color-text)]" htmlFor="password">
          密码
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="sc-input"
          required
        />
      </div>

      {error ? <p className="sc-field-error rounded-2xl border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="sc-button sc-button-primary w-full disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? '登录中...' : '登录'}
      </button>
    </form>
  );
}
