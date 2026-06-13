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
  SITE_NAME?: string;
  SITE_TAGLINE?: string;
  SITE_DESCRIPTION?: string;
  SITE_AVATAR_URL?: string;
  SITE_URL?: string;
  PUBLIC_COMMENTS_SERVER_URL?: string;
  ADMIN_USERNAME?: string;
}
