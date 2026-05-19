# Sakura Cactus

Sakura Cactus is a Cloudflare-native personal blog system built with Astro, Cloudflare Workers, D1, R2, TypeScript, React, and Tailwind CSS.

The project keeps code and content separate:

- Code is committed to GitHub and deployed by Cloudflare.
- Posts are created in `/admin` and stored in Cloudflare D1.
- Images are stored in a private Cloudflare R2 bucket.
- Public image access must go through `/i/:token`.

## Current Stage

Stage 1: project skeleton.

Implemented:

- Astro server output
- Cloudflare adapter
- React integration
- Tailwind CSS
- Basic homepage
- `/api/health`
- Initial Wrangler bindings for D1 and R2

Not implemented yet:

- D1 migrations
- Admin authentication
- Post management
- R2 upload and `/i/:token`

## Commands

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
```

On this Windows sandbox, use `pnpm.cmd` if PowerShell blocks `pnpm.ps1`.

If Astro or Wrangler tries to write config outside the workspace during local verification, run:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd build
```

## Security Notes

Do not commit `.env`, `.dev.vars`, Cloudflare API tokens, R2 access keys, session secrets, Turnstile secrets, or administrator passwords.
