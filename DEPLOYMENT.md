# Deployment

Sakura Cactus is deployed as a Cloudflare Workers SSR application. Workers handle Astro SSR, API routes, D1, R2, scheduled cleanup, RSS, sitemap, and robots metadata.

## Before Deployment

- Create production and preview D1 databases.
- Create production and preview private R2 buckets.
- Keep R2 public development URL disabled.
- Do not bind a public custom domain directly to R2.
- Replace placeholder database IDs in `wrangler.jsonc`.
- Apply D1 migrations.
- Configure administrator credentials with Cloudflare Workers Secrets.

## Required Production Secrets

Set these with `wrangler secret put` or in the Cloudflare dashboard. Do not commit real values to Git.

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD_HASH
wrangler secret put SITE_URL
```

Recommended production variables:

```txt
ADMIN_USERNAME=your-name
ADMIN_PASSWORD_HASH=generated-password-hash
SITE_URL=https://your-domain.com
```

`ADMIN_PASSWORD_HASH` stores a password hash, not the real password. Generate it locally:

```bash
node -e 'const crypto=require("crypto"); const p=process.argv[1]; const salt=crypto.randomBytes(16); const iter=210000; const hash=crypto.pbkdf2Sync(p,salt,iter,32,"sha256"); console.log(["pbkdf2_sha256",iter,salt.toString("base64url"),hash.toString("base64url")].join("$"))' "your-password"
```

`SITE_URL` is used to generate absolute URLs for RSS, sitemap, and robots metadata.

## Optional Variables

`SESSION_SECRET` is an advanced optional override. If it is not set, Sakura Cactus derives the session signing secret from the administrator password configuration.

```bash
wrangler secret put SESSION_SECRET
```

Changing `ADMIN_PASSWORD_HASH` invalidates existing login sessions unless a stable `SESSION_SECRET` is configured. This is acceptable for most personal blogs.

`SITE_AVATAR_URL` is an optional public avatar URL. It is not a secret.

## Local Development

Use `.dev.vars` locally. Do not commit `.dev.vars`.

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
SITE_URL=http://localhost:4321
```

Local development may use `ADMIN_PASSWORD` for convenience. Production should use `ADMIN_PASSWORD_HASH`.

## Database Migrations

Local:

```bash
pnpm db:migration:apply:local
```

Production:

```bash
pnpm db:migration:apply:prod
```

## Administrator Login

Sakura Cactus no longer uses `SETUP_TOKEN`, `/admin/setup`, or a web-based first-admin creation flow.

Administrator login is controlled by environment variables:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH` in production
- `ADMIN_PASSWORD` only for local development or unsupported fallback

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
