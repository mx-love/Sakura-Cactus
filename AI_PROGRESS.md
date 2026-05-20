# AI Progress

## Current Stage

Stage 3.5: admin setup and login strategy.

## Completed

- [x] Created initial Astro project files.
- [x] Added Cloudflare Workers adapter configuration.
- [x] Added React integration.
- [x] Added Tailwind CSS setup.
- [x] Added basic homepage.
- [x] Added `/api/health`.
- [x] Added initial Wrangler D1 and R2 binding placeholders.
- [x] Installed dependencies with pnpm.
- [x] Verified `pnpm build`.
- [x] Verified `/api/health` locally.
- [x] Added D1 initial migration.
- [x] Added database row TypeScript types.
- [x] Added D1 helper for reading the `DB` binding.
- [x] Added migration package scripts.
- [x] Verified local D1 migration execution.
- [x] Verified the expected local tables exist.
- [x] Implemented PBKDF2 password hashing.
- [x] Implemented create-admin script.
- [x] Implemented D1 sessions read/write.
- [x] Implemented `/api/auth/login`.
- [x] Implemented `/api/auth/logout`.
- [x] Implemented `/api/auth/me`.
- [x] Implemented HttpOnly Secure SameSite=Lax session cookie.
- [x] Implemented `/admin/login`.
- [x] Implemented `/admin` placeholder page.
- [x] Protected `/admin/*` with server-side middleware.
- [x] Protected `/api/admin/*` with server-side middleware.
- [x] Disabled Cloudflare adapter auto KV session by configuring a non-KV Astro session driver; Sakura Cactus admin auth uses D1 sessions.
- [x] Added `migrations/0002_add_user_email.sql`.
- [x] Added `/admin/setup`.
- [x] Added `POST /api/auth/setup`.
- [x] Setup is available only while `users` is empty.
- [x] Setup requires server-side `SETUP_TOKEN`.
- [x] Login page now uses `account + password`.
- [x] Login supports username or email.
- [x] Kept `scripts/create-admin.ts` as a backup maintenance tool and added optional email support.
- [x] Documented Cloudflare Access as an outer protection layer.

## Pending

- [ ] Stage 4: add post management.

## Known Issues

- The local shell did not have pnpm initially; it was installed globally with npm.
- In this sandbox, Astro telemetry and Wrangler config paths need environment variables during verification:
  - `ASTRO_TELEMETRY_DISABLED=1`
  - `XDG_CONFIG_HOME=D:\code\Sakura Cactus\.wrangler-config`
- Wrangler D1/R2 IDs are placeholders and must be replaced before remote deployment.
- Local migration verification depends on Wrangler accepting the placeholder D1 database configuration; production requires replacing IDs first.
- `SESSION_SECRET` is required for local and production login. It must be set in `.dev.vars` locally or Cloudflare secrets remotely.
- `SETUP_TOKEN` is required for `/admin/setup`; it must be set in `.dev.vars` locally or Cloudflare secrets remotely.
- `pnpm preview` uses redirected build config under `dist/server`; when manually testing preview-local D1, apply the migration/create-admin against that config or use `pnpm dev`.

## Last Verified Commands

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

```powershell
# Temporary local dev job, then:
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4321/api/health'
```

Response:

```json
{"ok":true,"data":{"status":"ok","service":"sakura-cactus"}}
```

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd db:migration:apply:local
```

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd exec wrangler d1 execute sakura_blog_prod --local --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

Confirmed tables:

```txt
assets
audit_logs
post_assets
post_tags
posts
sessions
settings
tags
users
```

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

```powershell
pnpm.cmd admin:create -- --help
```

Manual local auth verification with Wrangler preview confirmed:

```txt
POST /api/auth/login -> 200 OK
Set-Cookie includes HttpOnly; Secure; SameSite=Lax
GET /api/auth/me with Cookie header -> ok true
GET /api/admin/health without Cookie -> 401
```

Stage 3.5 verification:

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd db:migration:apply:local
```

```txt
GET /admin/setup while users table is empty -> 200
POST /api/auth/setup with wrong setupToken -> 400
POST /api/auth/setup with correct setupToken -> 201
GET /admin/setup after first user exists -> 302 /admin/login
POST /api/auth/login with email + password -> 200
Set-Cookie includes HttpOnly; Secure; SameSite=Lax
```

## Next Step

Stage 4: add post management.
