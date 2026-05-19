# AI Progress

## Current Stage

Stage 2: D1 database migrations.

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

## Pending

- [ ] Stage 3: add admin authentication.

## Known Issues

- The local shell did not have pnpm initially; it was installed globally with npm.
- In this sandbox, Astro telemetry and Wrangler config paths need environment variables during verification:
  - `ASTRO_TELEMETRY_DISABLED=1`
  - `XDG_CONFIG_HOME=D:\code\Sakura Cactus\.wrangler-config`
- The Cloudflare adapter currently logs that it enables a `SESSION` KV binding by default. Sakura Cactus auth must still use D1 sessions in stage 3.
- Wrangler D1/R2 IDs are placeholders and must be replaced before remote deployment.
- Local migration verification depends on Wrangler accepting the placeholder D1 database configuration; production requires replacing IDs first.

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

## Next Step

Stage 3: add admin authentication.
