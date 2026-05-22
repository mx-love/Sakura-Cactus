import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import { AuthConfigurationError, loginAdmin } from '@/features/auth/auth.service';

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
    if (error instanceof AuthConfigurationError) {
      return jsonError(error.code, error.message, { status: 500 });
    }

    console.error('Admin login failed:', error);
    return jsonError('LOGIN_FAILED', 'Unable to sign in right now.', { status: 500 });
  }
};
