import type { APIContext } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '@/lib/db';
import { clearRateLimit, consumeRateLimit } from '@/features/rate-limit/rate-limit.service';
import { reportError } from '@/lib/logging';
import { getClientAddress } from '@/lib/security/request';
import { SESSION_COOKIE_NAME, SESSION_TOKEN_BYTES, SESSION_TTL_SECONDS } from './auth.constants';
import { constantTimeEqual, createRandomToken, sha256Base64Url } from './crypto.service';
import { cleanupStaleSessions, createSession, findActiveSessionRecordByTokenHash, revokeSessionByTokenHash } from './session.repo';
import { ensureEnvironmentAdminUser, ENV_ADMIN_USER_ID, updateLastLogin } from './user.repo';

const TEXT_ENCODER = new TextEncoder();

function readOptionalSecret(name: 'ADMIN_PASSWORD' | 'SESSION_SECRET'): string | undefined {
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

export class AuthRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super('Too many login attempts.');
    this.name = 'AuthRateLimitError';
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

export function getEnvironmentAdminUsername(): string {
  const username = env.ADMIN_USERNAME?.trim();

  if (!username) {
    throw new AuthConfigurationError('MISSING_ADMIN_USERNAME', 'ADMIN_USERNAME must be configured.');
  }

  return username;
}

export function getEnvironmentAdminPassword(): string {
  const password = readOptionalSecret('ADMIN_PASSWORD');

  if (!password) {
    throw new AuthConfigurationError('MISSING_ADMIN_PASSWORD', 'ADMIN_PASSWORD must be configured.');
  }

  return password;
}

async function constantTimePasswordEqual(actual: string, expected: string): Promise<boolean> {
  const actualHash = await sha256Base64Url(actual);
  const expectedHash = await sha256Base64Url(expected);
  return constantTimeEqual(TEXT_ENCODER.encode(actualHash), TEXT_ENCODER.encode(expectedHash));
}

export async function verifyEnvironmentAdminPassword(password: string): Promise<boolean> {
  return constantTimePasswordEqual(password, getEnvironmentAdminPassword());
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
  const secret = readOptionalSecret('SESSION_SECRET');

  if (secret && secret.length >= 32) {
    return secret;
  }

  return `${import.meta.env.DEV ? 'dev' : 'plain'}-admin-password:${getEnvironmentAdminPassword()}`;
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
      try {
        return decodeURIComponent(rawValue.join('='));
      } catch {
        return null;
      }
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
  const ip = getClientAddress(request);

  if (ip === 'unknown') {
    return null;
  }

  return sha256Base64Url(`${secret}.${ip}`);
}

export async function loginAdmin(context: APIContext, account: string, password: string): Promise<LoginResult | null> {
  const db = getDb(context);
  const expectedUsername = getEnvironmentAdminUsername();
  const secret = getSessionSecret();
  const clientAddress = getClientAddress(context.request);
  const normalizedAccount = account.trim().slice(0, 256);
  const [ipLimit, accountLimit] = await Promise.all([
    consumeRateLimit({
      scope: 'admin_login_ip',
      key: clientAddress,
      secret,
      limit: 10,
      windowSeconds: 15 * 60
    }),
    consumeRateLimit({
      scope: 'admin_login_account',
      key: `${clientAddress}:${normalizedAccount.toLowerCase()}`,
      secret,
      limit: 20,
      windowSeconds: 15 * 60
    })
  ]);

  if (!ipLimit.allowed || !accountLimit.allowed) {
    throw new AuthRateLimitError(Math.max(ipLimit.retryAfterSeconds, accountLimit.retryAfterSeconds));
  }

  if (account.length > 256 || password.length > 1_024) {
    return null;
  }

  const [accountMatches, passwordMatches] = await Promise.all([
    constantTimePasswordEqual(account, expectedUsername),
    verifyEnvironmentAdminPassword(password)
  ]);

  if (!accountMatches || !passwordMatches) {
    return null;
  }

  const sessionOwner = await ensureEnvironmentAdminUser(db);

  const token = createRandomToken(SESSION_TOKEN_BYTES);
  const tokenHash = await hashSessionToken(token, secret);
  const userAgent = context.request.headers.get('user-agent');
  const ipHash = await hashClientIp(context.request, secret);

  await cleanupStaleSessions(db);
  await createSession(db, {
    userId: sessionOwner.id,
    tokenHash,
    userAgent,
    ipHash
  });
  await updateLastLogin(db, sessionOwner.id);
  await Promise.all([
    clearRateLimit({
      scope: 'admin_login_ip',
      key: clientAddress,
      secret
    }),
    clearRateLimit({
      scope: 'admin_login_account',
      key: `${clientAddress}:${normalizedAccount.toLowerCase()}`,
      secret
    })
  ]).catch((error) => reportError('Login rate-limit cleanup failed.', error));

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
  const environmentAdmin = getEnvironmentAdminUser();
  const session = await findActiveSessionRecordByTokenHash(db, tokenHash, environmentAdmin.id);

  if (!session) {
    return null;
  }

  return environmentAdmin;
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
