import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import { AuthConfigurationError, AuthRateLimitError, loginAdmin } from '@/features/auth/auth.service';
import { reportError } from '@/lib/logging';

export const prerender = false;

const invalidCredentialsResponse = () =>
  jsonError('INVALID_CREDENTIALS', 'Invalid account or password.', { status: 401 });

export const POST: APIRoute = async (context) => {
  let body: unknown;

  try {
    body = await context.request.json();
  } catch {
    return invalidCredentialsResponse();
  }

  if (!body || typeof body !== 'object') {
    return invalidCredentialsResponse();
  }

  const { username, account, password } = body as Record<string, unknown>;
  const loginAccount = typeof username === 'string' ? username : account;

  if (typeof loginAccount !== 'string' || typeof password !== 'string') {
    return invalidCredentialsResponse();
  }

  try {
    const result = await loginAdmin(context, loginAccount, password);

    if (!result) {
      return invalidCredentialsResponse();
    }

    return jsonOk(
      {
        user: result.user
      },
      {
        headers: {
          'Set-Cookie': result.cookie
        }
      }
    );
  } catch (error) {
    if (error instanceof AuthRateLimitError) {
      return jsonError('RATE_LIMITED', 'Too many login attempts. Try again later.', {
        status: 429,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(error.retryAfterSeconds)
        }
      });
    }

    if (error instanceof AuthConfigurationError) {
      reportError('Admin login configuration error.', error);
      return jsonError('AUTH_UNAVAILABLE', 'Administrator login is not configured.', { status: 503 });
    }

    reportError('Admin login failed.', error);
    return jsonError('LOGIN_FAILED', 'Unable to sign in right now.', { status: 500 });
  }
};
