# Sakura Cactus

Sakura Cactus is a Cloudflare-native personal blog system built with Astro, Cloudflare Workers, D1, R2, TypeScript, React, and Tailwind CSS.

The project keeps code and content separate:

- Code is committed to GitHub and deployed by Cloudflare.
- Posts are created in `/admin` and stored in Cloudflare D1.
- Images are stored in a private Cloudflare R2 bucket.
- Public image access must go through `/i/:token`.

## Current Stage

Stage 3: admin authentication.

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
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Server-side protection for `/admin/*` and `/api/admin/*`

Not implemented yet:

- Post management
- R2 upload and `/i/:token`

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm db:migration:apply:local
pnpm admin:create -- --local
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

Create the first local administrator:

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd admin:create -- --local --username admin
```

For production, set Cloudflare secrets first and run against remote D1:

```bash
pnpm admin:create -- --remote --username admin
```

Required secret:

```txt
SESSION_SECRET
```

`SESSION_SECRET` must be at least 32 characters. For local development, put it in `.dev.vars`; do not commit that file.

## Security Notes

Do not commit `.env`, `.dev.vars`, Cloudflare API tokens, R2 access keys, session secrets, Turnstile secrets, or administrator passwords.

Admin authentication stores only password hashes and session token hashes in D1. The browser receives only an HttpOnly, Secure, SameSite=Lax cookie.
