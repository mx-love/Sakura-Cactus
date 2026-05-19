import type { APIRoute } from 'astro';
import { jsonError, jsonOk } from '@/lib/response';
import { loginAdmin } from '@/features/auth/auth.service';

export const prerender = false;

const invalidCredentialsResponse = () =>
  jsonError('INVALID_CREDENTIALS', 'Invalid username or password.', { status: 401 });

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

  const { username, password } = body as Record<string, unknown>;

  if (typeof username !== 'string' || typeof password !== 'string') {
    return invalidCredentialsResponse();
  }

  try {
    const result = await loginAdmin(context, username.trim(), password);

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
    console.error('Admin login failed:', error);
    return jsonError('LOGIN_FAILED', 'Unable to sign in right now.', { status: 500 });
  }
};
