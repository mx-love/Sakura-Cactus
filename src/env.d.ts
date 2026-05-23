/// <reference types="astro/client" />

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    runtime: Runtime;
  }
}

interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  PUBLIC_SITE_NAME: string;
  PUBLIC_SITE_URL: string;
  PUBLIC_TURNSTILE_SITE_KEY?: string;
  SITE_AVATAR_URL?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
  CSRF_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  ADMIN_BOOTSTRAP_TOKEN?: string;
}
