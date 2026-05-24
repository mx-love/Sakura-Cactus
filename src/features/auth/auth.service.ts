import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import type { UserRow } from '@/lib/database.types';
import { getDb } from '@/lib/db';
import { SESSION_COOKIE_NAME, SESSION_TOKEN_BYTES, SESSION_TTL_SECONDS } from './auth.constants';
import { createRandomToken, sha256Base64Url } from './crypto.service';
import { verifyPassword } from './password.service';
import { createSession, findActiveSessionRecordByTokenHash, revokeSessionByTokenHash } from './session.repo';
import { ensureEnvironmentAdminUser, ENV_ADMIN_USER_ID, updateLastLogin } from './user.repo';

let warnedAboutPlainAdminPassword = false;

function readOptionalRuntimeEnv(name: string): string | undefined {
  const value = (env as unknown as Record<string, string | undefined>)[name];
  return typeof value === 'string' ? value : undefined;
}

export class AuthConfigurationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

export interface PublicAdminUser {
  id: string;
  email: string | null;
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
    email: user.email,
    username: user.username,
    displayName: user.display_name,
    role: 'admin'
  };
}

export function getEnvironmentAdminUsername(): string {
  const username = env.ADMIN_USERNAME?.trim();

  if (!username) {
    throw new AuthConfigurationError('MISSING_ADMIN_USERNAME', 'ADMIN_USERNAME must be set.');
  }

  return username;
}

export function getEnvironmentAdminPassword(): string {
  const password = readOptionalRuntimeEnv('ADMIN_PASSWORD');

  if (!password) {
    throw new AuthConfigurationError('MISSING_ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH must be set.');
  }

  if (!env.ADMIN_PASSWORD_HASH && !import.meta.env.DEV && !warnedAboutPlainAdminPassword) {
    console.warn('[Sakura Cactus] ADMIN_PASSWORD is set without ADMIN_PASSWORD_HASH. Use ADMIN_PASSWORD_HASH in production.');
    warnedAboutPlainAdminPassword = true;
  }

  return password;
}

export async function verifyEnvironmentAdminPassword(password: string): Promise<boolean> {
  const passwordHash = env.ADMIN_PASSWORD_HASH;

  if (passwordHash) {
    return verifyPassword(password, passwordHash);
  }

  return password === getEnvironmentAdminPassword();
}

export function getEnvironmentAdminUser(): PublicAdminUser {
  const username = getEnvironmentAdminUsername();

  return {
    id: ENV_ADMIN_USER_ID,
    email: null,
    username,
    displayName: username,
    role: 'admin'
  };
}

export function getSessionSecret(): string {
  const secret = readOptionalRuntimeEnv('SESSION_SECRET');

  if (secret && secret.length >= 32) {
    return secret;
  }

  if (env.ADMIN_PASSWORD_HASH) {
    return `admin-password-hash:${env.ADMIN_PASSWORD_HASH}`;
  }

  const plainAdminPassword = readOptionalRuntimeEnv('ADMIN_PASSWORD');

  if (plainAdminPassword) {
    if (!import.meta.env.DEV && !warnedAboutPlainAdminPassword) {
      console.warn('[Sakura Cactus] ADMIN_PASSWORD is set without ADMIN_PASSWORD_HASH. Use ADMIN_PASSWORD_HASH in production.');
      warnedAboutPlainAdminPassword = true;
    }

    return `${import.meta.env.DEV ? 'dev' : 'plain'}-admin-password:${plainAdminPassword}`;
  }

  throw new AuthConfigurationError('MISSING_SESSION_SECRET_SOURCE', 'ADMIN_PASSWORD_HASH must be set, or set SESSION_SECRET explicitly.');
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

export async function loginAdmin(context: APIContext, account: string, password: string): Promise<LoginResult | null> {
  const db = getDb(context);
  const expectedUsername = getEnvironmentAdminUsername();

  if (account !== expectedUsername || !(await verifyEnvironmentAdminPassword(password))) {
    return null;
  }

  const sessionOwner = await ensureEnvironmentAdminUser(db);

  const secret = getSessionSecret();
  const token = createRandomToken(SESSION_TOKEN_BYTES);
  const tokenHash = await hashSessionToken(token, secret);
  const userAgent = context.request.headers.get('user-agent');
  const ipHash = await hashClientIp(context.request, secret);

  await createSession(db, {
    userId: sessionOwner.id,
    tokenHash,
    userAgent,
    ipHash
  });
  await updateLastLogin(db, sessionOwner.id);

  return {
    user: getEnvironmentAdminUser(),
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
  const session = await findActiveSessionRecordByTokenHash(db, tokenHash);

  if (!session) {
    return null;
  }

  return getEnvironmentAdminUser();
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
