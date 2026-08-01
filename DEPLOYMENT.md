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
- In the Cloudflare Dashboard, configure the owner's administrator username as Text and password as Secret.
- Configure the production `SITE_URL` as a complete HTTPS URL.
- Configure public site identity with Cloudflare Workers environment variables if you do not want the defaults.

## Required Production Configuration

Use Cloudflare Dashboard → Worker → Settings → Variables and Secrets. This is the recommended configuration path; no administrator account command or D1 user creation step is required. Do not commit real values to Git.

| Name | Cloudflare type | Requirement | Meaning |
| --- | --- | --- | --- |
| `ADMIN_USERNAME` | Text | Required | The blog owner's only administrator login username |
| `ADMIN_PASSWORD` | Secret | Required | The blog owner's only administrator login password |
| `SITE_URL` | Text | Required in production | Complete HTTPS site URL, such as `https://blog.example.com` |
| `SESSION_SECRET` | Secret | Optional advanced setting | Independent session key, at least 32 characters |

The owner enters the same `ADMIN_USERNAME` and `ADMIN_PASSWORD` on `/admin/login`. The project has no visitor registration or multi-administrator account system. It does not require a generated password hash, a D1 administrator record, or a command-line account setup step.

When a valid `SESSION_SECRET` is present, it protects session hashes independently. When it is omitted, the Worker derives the session key from `ADMIN_PASSWORD`, so a third secret is not required for normal deployment.

RSS, sitemap, robots metadata, canonical redirects, and absolute SEO URLs use the configured `SITE_URL` origin through `src/lib/seo.ts`. Production fails clearly when `SITE_URL` is missing, relative, invalid, non-HTTPS, or uses an unsupported protocol. Paths, queries, and fragments are discarded. Local development may omit it and use `http://localhost:4321`; development mode may also use another explicit local HTTP address.

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
SITE_URL=http://localhost:4321
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地收录。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

## Database Initialization

Sakura Cactus does not initialize or upgrade D1 from an HTTP request or scheduled task. Apply the checked-in migrations explicitly before first use and whenever a new migration is released.

The Worker remains compatible with the immediately preceding schema while a release migration is staged, but the database must not be left behind indefinitely. A missing or genuinely incompatible schema is treated as an operational error instead of being silently rewritten at runtime.

Migration `0008_security_hardening.sql` creates the D1-backed `rate_limits` table and the `sakura_schema_state` marker. Migration `0010_simplify_post_status.sql` is an explicit, irreversible upgrade that removes historical draft, archived, and non-public posts after recording their media cleanup candidates. It must be tested and applied through Wrangler D1 migrations, never by serving a page.

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

Sakura Cactus has one administrator: the blog owner. It has no visitor registration, user application, or multi-administrator flow. `/admin/setup` remains a retired redirect and its API returns 404.

The only login credential source is the Cloudflare Worker environment:

- `ADMIN_USERNAME`: the blog owner's only administrator login username, stored as Text.
- `ADMIN_PASSWORD`: the blog owner's only administrator login password, stored as Secret.

The login page is:

```txt
/admin/login
```

The login page compares submitted credentials with these values inside the Worker using digest-based constant-time comparison. It never queries a D1 password. Successful login ensures the fixed D1 `env_admin` technical placeholder exists and then creates an HttpOnly, Secure, SameSite=Lax session cookie. D1 stores only secret-bound session token hashes and normal session metadata.

`env_admin` exists only to satisfy the D1 user/session relationship. It contains fixed, non-login placeholder values and never receives the real administrator username, password, or password hash. D1 remains required for posts, tags, settings, friend links, rate limits, sessions, and the project's other blog data; keep all existing migrations.

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
- Confirm `ADMIN_USERNAME` is Dashboard Text, while `ADMIN_PASSWORD` and optional `SESSION_SECRET` are Dashboard Secrets.
- Confirm production `SITE_URL` is a complete HTTPS URL for the final Worker/custom-domain origin.
- Confirm preview and production use separate D1/R2 resources and secrets where appropriate.
- Confirm Cache Rules never publicly cache `/admin*`, `/api/admin*`, `/api/auth*`, `/write*`, `/settings*`, or private media responses.
- Verify D1 backups or point-in-time recovery, observability retention/access, and least-privilege account access.
- Exercise login/logout, image upload/read, browser-local writing, publishing, editing, permanent deletion, friend application/health checks, view counting, and scheduled cleanup in preview.
- Exercise `/settings/data` summary, JSON export, ZIP export, automatic inspect, import without images, import with images, about single-instance behavior, and conflict strategies in preview. This is application data portability, not a substitute for Cloudflare D1/R2 backups.

After deployment, inspect response headers on both successful and error responses for private paths. They must include `Cache-Control: no-store`; HTTPS responses should also include the application security headers documented in `SECURITY_CHECKLIST.md`.
