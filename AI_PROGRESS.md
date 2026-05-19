# AI Progress

## Current Stage

Stage 1: project skeleton.

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

## Pending

- [ ] Create D1 migrations in stage 2.

## Known Issues

- The local shell did not have pnpm initially; it was installed globally with npm.
- In this sandbox, Astro telemetry and Wrangler config paths need environment variables during verification:
  - `ASTRO_TELEMETRY_DISABLED=1`
  - `XDG_CONFIG_HOME=D:\code\Sakura Cactus\.wrangler-config`
- The Cloudflare adapter currently logs that it enables a `SESSION` KV binding by default. Sakura Cactus auth must still use D1 sessions in stage 3.
- Wrangler D1/R2 IDs are placeholders and must be replaced before remote deployment.

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

## Next Step

Stage 2: add D1 schema and migrations.
