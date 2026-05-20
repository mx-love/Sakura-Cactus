import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/response';
import { createAdminUser } from '@/features/auth/user.repo';
import { hashPassword } from '@/features/auth/password.service';
import { isAdminSetupAvailable } from '@/features/auth/setup.service';

export const prerender = false;

const setupUnavailableResponse = () => jsonError('NOT_FOUND', 'Not found.', { status: 404 });
const setupFailedResponse = () => jsonError('SETUP_FAILED', 'Unable to complete setup.', { status: 400 });

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_-]{3,32}$/.test(username);
}

export const POST: APIRoute = async (context) => {
  const db = getDb(context);

  if (!(await isAdminSetupAvailable(db))) {
    return setupUnavailableResponse();
  }

  let body: unknown;

  try {
    body = await context.request.json();
  } catch {
    return setupFailedResponse();
  }

  if (!body || typeof body !== 'object') {
    return setupFailedResponse();
  }

  const { email, username, password, confirmPassword, setupToken } = body as Record<string, unknown>;

  if (
    typeof email !== 'string' ||
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    typeof confirmPassword !== 'string' ||
    typeof setupToken !== 'string'
  ) {
    return setupFailedResponse();
  }

  const expectedSetupToken = env.SETUP_TOKEN;

  if (!expectedSetupToken || setupToken !== expectedSetupToken) {
    return setupFailedResponse();
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedUsername = username.trim();

  if (!isValidEmail(normalizedEmail) || !isValidUsername(normalizedUsername)) {
    return setupFailedResponse();
  }

  if (password !== confirmPassword || password.length < 12) {
    return setupFailedResponse();
  }

  try {
    const passwordHash = await hashPassword(password);
    const user = await createAdminUser(db, {
      email: normalizedEmail,
      username: normalizedUsername,
      displayName: normalizedUsername,
      passwordHash
    });

    return jsonOk(
      {
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          role: user.role
        }
      },
      { status: 201 }
    );
  } catch {
    return setupFailedResponse();
  }
};
