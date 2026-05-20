# Sakura Cactus

Sakura Cactus is a Cloudflare-native personal blog system built with Astro, Cloudflare Workers, D1, R2, TypeScript, React, and Tailwind CSS.

The project keeps code and content separate:

- Code is committed to GitHub and deployed by Cloudflare.
- Posts are created in `/admin` and stored in Cloudflare D1.
- Images are stored in a private Cloudflare R2 bucket.
- Public image access must go through `/i/:token`.

## Current Stage

Stage 4: post management.

Implemented:

- Astro server output
- Cloudflare adapter
- React integration
- Tailwind CSS
- Basic homepage
- `/api/health`
- Initial Wrangler bindings for D1 and R2
- D1 initial migration schema
- Admin password authentication
- D1-backed sessions
- HttpOnly Secure SameSite=Lax session cookie
- `/admin/login` and `/admin`
- `/admin/setup`
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, `/api/auth/setup`
- Server-side protection for `/admin/*` and `/api/admin/*`
- First-admin setup guarded by `SETUP_TOKEN`
- Login with username or email
- Admin post list, create, edit, publish, unpublish, and soft delete
- D1-backed post API under `/api/admin/posts`
- Server-rendered Markdown HTML with basic sanitization
- Public homepage post list
- Public `/posts/[slug]` post detail page

Not implemented yet:

- R2 upload and `/i/:token`
- Media library

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm db:migration:apply:local
pnpm preview
```

On this Windows sandbox, use `pnpm.cmd` if PowerShell blocks `pnpm.ps1`.

If Astro or Wrangler tries to write config outside the workspace during local verification, run:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd build
```

Apply D1 migrations locally:

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd db:migration:apply:local
```

Create the first local administrator through the setup page:

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd db:migration:apply:local
```

Create `.dev.vars` locally:

```txt
SESSION_SECRET="replace-with-at-least-32-random-characters"
SETUP_TOKEN="replace-with-one-time-random-setup-token"
```

Then start the app and open `/admin/setup`.

The setup page is available only while the `users` table is empty. After the first administrator is created, `/admin/setup` redirects to `/admin/login`.

`scripts/create-admin.ts` is retained as a backup maintenance tool:

```powershell
pnpm.cmd admin:create -- --local --email admin@example.com --username admin
```

For production, set Cloudflare secrets first and apply migrations against remote D1:

```bash
pnpm db:migration:apply:prod
```

Required secrets:

```txt
SESSION_SECRET
SETUP_TOKEN
```

`SESSION_SECRET` must be at least 32 characters. `SETUP_TOKEN` should be a one-time random value. For local development, put them in `.dev.vars`; do not commit that file.

## Security Notes

Do not commit `.env`, `.dev.vars`, Cloudflare API tokens, R2 access keys, session secrets, Turnstile secrets, or administrator passwords.

Admin authentication stores only password hashes and session token hashes in D1. The browser receives only an HttpOnly, Secure, SameSite=Lax cookie. Setup requires a server-side `SETUP_TOKEN` and is disabled after the first user exists.

## Post Management

After signing in, open `/admin/posts` to manage posts.

Supported fields:

- `title`
- `slug`
- `excerpt`
- `content_markdown`
- `content_html`
- `status`
- `visibility`
- `seo_title`
- `seo_description`
- `published_at`
- `created_at`
- `updated_at`

Post statuses are `draft`, `published`, `archived`, and `deleted`. Deleting a post performs a soft delete by setting `deleted_at` and `status = 'deleted'`.

Visitors can only read posts where:

```sql
status = 'published'
AND visibility = 'public'
AND deleted_at IS NULL
```

Draft, private, archived, deleted, and missing posts return 404 on public detail routes.
