import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import type { UserRow } from '@/lib/database.types';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE_NAME, SESSION_TOKEN_BYTES, SESSION_TTL_SECONDS } from './auth.constants';
import { createRandomToken, sha256Base64Url } from './crypto.service';
import { verifyPassword } from './password.service';
import { createSession, findActiveSessionByTokenHash, revokeSessionByTokenHash } from './session.repo';
import { findUserByUsername, updateLastLogin } from './user.repo';

export interface PublicAdminUser {
  id: string;
  username: string;
  displayName: string | null;
  role: 'admin';
}

export interface LoginResult {
  user: PublicAdminUser;
  cookie: string;
}

export function toPublicAdminUser(user: UserRow): PublicAdminUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: 'admin'
  };
}

export function getSessionSecret(): string {
  const secret = env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters long.');
  }

  return secret;
}

export function getCookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split('=');

    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return null;
}

export function createSessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].join('; ');
}

export function createExpiredSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'Secure',
    'SameSite=Lax'
  ].join('; ');
}

export async function hashSessionToken(token: string, secret: string): Promise<string> {
  return sha256Base64Url(`${secret}.${token}`);
}

export async function hashClientIp(request: Request, secret: string): Promise<string | null> {
  const forwardedFor = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim();

  if (!ip) {
    return null;
  }

  return sha256Base64Url(`${secret}.${ip}`);
}

export async function loginAdmin(context: APIContext, username: string, password: string): Promise<LoginResult | null> {
  const db = getDb(context);
  const user = await findUserByUsername(db, username);

  if (!user || user.status !== 'active') {
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);

  if (!passwordMatches) {
    return null;
  }

  const secret = getSessionSecret();
  const token = createRandomToken(SESSION_TOKEN_BYTES);
  const tokenHash = await hashSessionToken(token, secret);
  const userAgent = context.request.headers.get('user-agent');
  const ipHash = await hashClientIp(context.request, secret);

  await createSession(db, {
    userId: user.id,
    tokenHash,
    userAgent,
    ipHash
  });
  await updateLastLogin(db, user.id);

  return {
    user: toPublicAdminUser(user),
    cookie: createSessionCookie(token)
  };
}

export async function getCurrentAdminUser(context: APIContext): Promise<PublicAdminUser | null> {
  const token = getCookieValue(context.request, SESSION_COOKIE_NAME);

  if (!token) {
    return null;
  }

  const db = getDb(context);
  const tokenHash = await hashSessionToken(token, getSessionSecret());
  const session = await findActiveSessionByTokenHash(db, tokenHash);

  if (!session) {
    return null;
  }

  return toPublicAdminUser(session.user);
}

export async function logoutAdmin(context: APIContext): Promise<void> {
  const token = getCookieValue(context.request, SESSION_COOKIE_NAME);

  if (!token) {
    return;
  }

  const db = getDb(context);
  const tokenHash = await hashSessionToken(token, getSessionSecret());
  await revokeSessionByTokenHash(db, tokenHash);
}
