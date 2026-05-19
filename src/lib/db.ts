import type { APIContext } from 'astro';

export const DB_BINDING_NAME = 'DB';

export function getDb(context: Pick<APIContext, 'locals'>): D1Database {
  const db = context.locals.runtime?.env.DB;

  if (!db) {
    throw new Error('Cloudflare D1 binding "DB" is not available.');
  }

  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}
