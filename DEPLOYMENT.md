# Deployment

This file is a working deployment note. Full deployment instructions will be completed in stage 7.

Before production deployment:

- Create production and preview D1 databases.
- Create production and preview private R2 buckets.
- Keep R2 public development URL disabled.
- Do not bind a public custom domain directly to R2.
- Replace placeholder IDs in `wrangler.jsonc`.
- Set required Cloudflare secrets in the Cloudflare dashboard.

## Required Secrets

Set these in Cloudflare, not in Git:

```txt
SESSION_SECRET
SETUP_TOKEN
```

`SESSION_SECRET` must be at least 32 characters. `SETUP_TOKEN` should be a random one-time setup token used only for `/admin/setup`.

## Database Migrations

Local:

```bash
pnpm db:migration:apply:local
```

Production:

```bash
pnpm db:migration:apply:prod
```

Stage 3.5 adds:

```txt
migrations/0002_add_user_email.sql
```

## First Administrator

After migrations and secrets are configured, open:

```txt
/admin/setup
```

This page is only available while the `users` table is empty. It requires:

```txt
email
username
password
confirmPassword
setupToken
```

`setupToken` must match the Cloudflare secret `SETUP_TOKEN`. Once the first user is created, `/admin/setup` redirects to `/admin/login`.

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
