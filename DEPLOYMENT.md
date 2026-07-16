# Deployment

Sakura Cactus is deployed as a Cloudflare Workers SSR application. Workers handle Astro SSR, API routes, D1, R2, scheduled cleanup, RSS, sitemap, and robots metadata.

## Before Deployment

- Create production and preview D1 databases.
- Create production and preview private R2 buckets.
- Keep R2 public development URL disabled.
- Do not bind a public custom domain directly to R2.
- Set `SAKURA_D1_DATABASE_ID` in Cloudflare Variables. The build command runs `scripts/prepare-cloudflare-config.mjs` and generates the `DB` binding.
- Optionally set `SAKURA_D1_DATABASE_NAME`; it defaults to `sakura_blog_prod`.
- Optionally set `SAKURA_R2_BUCKET_NAME`; it defaults to `sakura-blog-media-prod`.
- The generated Wrangler config includes the private R2 bucket binding as `MEDIA_BUCKET`.
- Keep `keep_vars: true` in `wrangler.jsonc` so Wrangler deploys do not remove Dashboard-managed Variables and Secrets.
- Configure administrator credentials with Cloudflare Workers Secrets.
- Configure public site identity with Cloudflare Workers environment variables if you do not want the defaults.

## Required Production Secrets

Set these with `wrangler secret put` or in the Cloudflare dashboard. Do not commit real values to Git.

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD
```

Recommended production variables:

```txt
ADMIN_USERNAME=your-name
ADMIN_PASSWORD=your-password
```

Advanced users may use `ADMIN_PASSWORD_HASH` instead of `ADMIN_PASSWORD`. If both are configured, `ADMIN_PASSWORD_HASH` takes priority. Generate it locally:

```bash
node -e 'const crypto=require("crypto"); const p=process.argv[1]; const salt=crypto.randomBytes(16); const iter=210000; const hash=crypto.pbkdf2Sync(p,salt,iter,32,"sha256"); console.log(["pbkdf2_sha256",iter,salt.toString("base64url"),hash.toString("base64url")].join("$"))' "your-password"
```

RSS, sitemap, robots metadata, canonical redirects, and absolute SEO URLs use the configured `SITE_URL` origin through `src/lib/seo.ts`. Set `SITE_URL` to the final production origin, such as `https://blog.example.com`, before routing production traffic. If it is missing or invalid, the code falls back to the project default origin.

## Public Site Identity Variables

These are normal Cloudflare Workers environment variables, not secrets. Configure them in the Cloudflare dashboard or your deployment environment. Do not put them in `wrangler.jsonc` unless you intentionally want repository-tracked defaults.

```txt
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地收录。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

Empty or missing values fall back to the defaults above. `SITE_NAME` controls the header brand, homepage title, default page title, footer, and RSS title. `SITE_TAGLINE` and `SITE_DESCRIPTION` control the homepage intro. `SITE_DESCRIPTION` is also used as the default meta description and RSS description. The small homepage label `窗边纸页` is part of the fixed Sakura Cactus theme and is not configurable.

`SITE_AVATAR_URL` is an optional public avatar URL. It is not a secret.

## External Waline Comments

Sakura Cactus does not store comments in D1 and does not provide a comment API. Comments are stored by your external Waline service.

To enable comments, deploy Waline first, then add this normal Cloudflare Workers environment variable:

```txt
PUBLIC_COMMENTS_SERVER_URL=https://your-waline.example.com
```

The built-in comment switch in `/settings` controls whether the article comment slot is shown. Do not configure `PUBLIC_COMMENTS_ENABLED`, `PUBLIC_COMMENTS_PROVIDER`, or extra provider variables. Do not commit your real Waline service URL to GitHub.

## Local Development

Use `.dev.vars` locally. Do not commit `.dev.vars`.

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地收录。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

## Database Initialization

Sakura Cactus automatically initializes the D1 schema on first runtime access. The bootstrap only creates missing tables, indexes, default settings, and known columns. It does not delete tables, clear data, or rebuild the database.

The SQL files under `migrations/` are still kept for developers who want explicit local database maintenance.

Security hardening adds migration `0008_security_hardening.sql`. It creates the D1-backed `rate_limits` table and a lightweight `sakura_schema_state` bootstrap marker; it does not delete application data. The runtime bootstrap can create these objects automatically. Before applying migration 0008 remotely, inspect the production D1 migration history and current tables first. Do not blindly run the remote command against an existing auto-bootstrapped database.

The rate-limit paths fail closed if D1 is unavailable: login, uploads, friend applications, and view counting do not silently bypass the shared limit when the table cannot be read or updated. Expired limit rows are deleted in bounded batches during normal consumption.

Local developer command:

```bash
pnpm db:migration:apply:local
```

Production maintenance command, if you intentionally want to apply migrations manually:

```bash
pnpm db:migration:apply:prod
```

Create a D1 backup or recovery point before production maintenance. Apply and exercise the migration in preview first.

## Generated Worker Types

`worker-configuration.d.ts` is generated by:

```bash
pnpm types
```

The committed file contains binding names and generated TypeScript declarations only. It must not contain database IDs, bucket names, account IDs, local paths, or secrets. Regenerate it after changing Cloudflare bindings and review the diff before committing.

## Administrator Login

Sakura Cactus no longer uses `SETUP_TOKEN`, `/admin/setup`, or a web-based first-admin creation flow.

Administrator login is controlled by environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `ADMIN_PASSWORD_HASH` as an advanced optional override

The login page is:

```txt
/admin/login
```

Successful login creates an HttpOnly, Secure, SameSite=Lax session cookie. Session records in D1 store only token hashes.

## Cloudflare Access Outer Protection

Cloudflare Access is recommended as an outer protection layer in front of the built-in Sakura Cactus admin login.

Recommended protected paths:

```txt
/admin/*
/api/admin/*
/api/auth/*
```

Recommended policy:

```txt
Allow only specified administrator email addresses.
```

Cloudflare Access should be treated as perimeter protection. Sakura Cactus still keeps its own `/admin/login`, D1-backed sessions, HttpOnly Secure Cookie, and server-side API authorization.

## Production Security Verification

Before routing production traffic:

- Confirm the R2 bucket is private, its public development URL is disabled, and no public custom domain is attached.
- Confirm administrator credentials (and optional `SESSION_SECRET`) are Cloudflare Secrets, not repository variables.
- Confirm preview and production use separate D1/R2 resources and secrets where appropriate.
- Confirm Cache Rules never publicly cache `/admin*`, `/api/admin*`, `/api/auth*`, `/write*`, `/settings*`, or private media responses.
- Verify D1 backups or point-in-time recovery, observability retention/access, and least-privilege account access.
- Exercise login/logout, image upload/read, browser-local writing, publishing, editing, permanent deletion, friend application/health checks, view counting, and scheduled cleanup in preview.

After deployment, inspect response headers on both successful and error responses for private paths. They must include `Cache-Control: no-store`; HTTPS responses should also include the application security headers documented in `SECURITY_CHECKLIST.md`.
