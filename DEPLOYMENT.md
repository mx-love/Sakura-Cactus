# Deployment

Sakura Cactus is deployed as a Cloudflare Workers SSR application. Workers handle Astro SSR, API routes, D1, R2, scheduled cleanup, RSS, sitemap, and robots metadata.

## Before Deployment

- Create production and preview D1 databases.
- Create production and preview private R2 buckets.
- Keep R2 public development URL disabled.
- Do not bind a public custom domain directly to R2.
- Set `CLOUDFLARE_D1_DATABASE_ID` in Cloudflare Variables. The build command runs `scripts/prepare-cloudflare-config.mjs` and generates the `DB` binding.
- Optionally set `CLOUDFLARE_D1_DATABASE_NAME`; it defaults to `sakura_blog_prod`.
- Optionally set `CLOUDFLARE_R2_BUCKET_NAME`; it defaults to `sakura-blog-media-prod`.
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

RSS, sitemap, and robots metadata use the current request origin automatically. No extra site URL variable is required. Local development uses localhost, `workers.dev` uses the workers.dev domain, and custom domains use the bound domain.

## Public Site Identity Variables

These are normal Cloudflare Workers environment variables, not secrets. Configure them in the Cloudflare dashboard or your deployment environment. Do not put them in `wrangler.jsonc` unless you intentionally want repository-tracked defaults.

```txt
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地发布。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

Empty or missing values fall back to the defaults above. `SITE_NAME` controls the header brand, homepage title, default page title, footer, and RSS title. `SITE_TAGLINE` and `SITE_DESCRIPTION` control the homepage intro. `SITE_DESCRIPTION` is also used as the default meta description and RSS description. The small homepage label `窗边纸页` is part of the fixed Sakura Cactus theme and is not configurable.

`SITE_AVATAR_URL` is an optional public avatar URL. It is not a secret.

## Local Development

Use `.dev.vars` locally. Do not commit `.dev.vars`.

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
SITE_NAME=Sakura Cactus
SITE_TAGLINE=温柔地写，安静地发布。
SITE_DESCRIPTION=一些文章、笔记，以及慢慢整理的想法。
```

## Database Initialization

Sakura Cactus automatically initializes the D1 schema on first runtime access. The bootstrap only creates missing tables, indexes, default settings, and known columns. It does not delete tables, clear data, or rebuild the database.

The SQL files under `migrations/` are still kept for developers who want explicit local database maintenance.

Local developer command:

```bash
pnpm db:migration:apply:local
```

Production maintenance command, if you intentionally want to apply migrations manually:

```bash
pnpm db:migration:apply:prod
```

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
