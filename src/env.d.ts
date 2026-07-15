/// <reference types="astro/client" />

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: {
    changes?: number;
  };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface R2ObjectBody {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpEtag: string;
}

interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface Fetcher {}

interface CacheStorage {
  default: Cache;
}

interface ScheduledController {
  cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ExportedHandler<Environment = unknown> {
  fetch?: unknown;
  scheduled?: (
    controller: ScheduledController,
    environment: Environment,
    context: ExecutionContext
  ) => void | Promise<void>;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    runtime: Runtime;
  }
}

interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  SITE_NAME?: string;
  SITE_TAGLINE?: string;
  SITE_DESCRIPTION?: string;
  SITE_AVATAR_URL?: string;
  SITE_URL?: string;
  PUBLIC_COMMENTS_SERVER_URL?: string;
  ADMIN_USERNAME?: string;
}

declare namespace Cloudflare {
  interface Env {
    SITE_NAME?: string;
    SITE_TAGLINE?: string;
    SITE_DESCRIPTION?: string;
    SITE_AVATAR_URL?: string;
    SITE_URL?: string;
    PUBLIC_COMMENTS_SERVER_URL?: string;
    ADMIN_USERNAME?: string;
  }
}

declare module 'cloudflare:workers' {
  const env: Cloudflare.Env;
  export { env };
}
