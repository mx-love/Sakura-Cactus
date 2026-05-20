import { useState } from 'react';

interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function SetupForm() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          email,
          username,
          password,
          confirmPassword,
          setupToken
        })
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setError(payload?.error.message ?? 'Unable to complete setup.');
        return;
      }

      window.location.assign('/admin/login');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          autoComplete="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-base outline-none focus:border-[var(--color-primary)]"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
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
          autoComplete="new-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-base outline-none focus:border-[var(--color-primary)]"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="confirmPassword">
          Confirm Password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-base outline-none focus:border-[var(--color-primary)]"
          required
        />
      </div>

      <div className="space-y-2">
        <label className="block text-sm font-medium text-[var(--color-text)]" htmlFor="setupToken">
          Setup Token
        </label>
        <input
          id="setupToken"
          name="setupToken"
          autoComplete="one-time-code"
          type="password"
          value={setupToken}
          onChange={(event) => setSetupToken(event.target.value)}
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
        {isSubmitting ? 'Creating admin...' : 'Create admin'}
      </button>
    </form>
  );
}
