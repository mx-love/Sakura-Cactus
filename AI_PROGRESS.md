# AI Progress

## Current Stage

Project maintenance: dependency verification is complete; current work is roadmap and documentation synchronization on `codex/project-maintenance`.

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
- [x] Implemented the initial D1 administrator bootstrap (later retired in favor of environment-only credentials).
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
- [x] Retired the backup D1 administrator maintenance path after environment-only authentication became authoritative.
- [x] Documented Cloudflare Access as an outer protection layer.
- [x] Implemented `src/features/posts` repo/service/schema/types/renderer.
- [x] Implemented admin post APIs:
  - `GET /api/admin/posts`
  - `POST /api/admin/posts`
  - `GET /api/admin/posts/:id`
  - `PUT /api/admin/posts/:id`
  - `DELETE /api/admin/posts/:id`
- [x] Implemented `/admin/posts`, `/admin/posts/new`, and `/admin/posts/[id]`.
- [x] Implemented Markdown rendering with basic HTML sanitization.
- [x] Implemented public homepage post list.
- [x] Implemented public `/posts/[slug]` detail page.
- [x] Public routes only expose existing published public posts.
- [x] Implemented `src/features/assets` repo/service/security/types.
- [x] Implemented admin asset APIs:
  - `GET /api/admin/assets`
  - `POST /api/admin/assets/upload`
  - `GET /api/admin/assets/:id`
  - `PATCH /api/admin/assets/:id`
  - `DELETE /api/admin/assets/:id`
- [x] Implemented `/admin/media`.
- [x] Implemented private R2 upload through `MEDIA_BUCKET`.
- [x] Implemented random token image proxy at `/i/:token`.
- [x] Draft/private asset requests return 404 for visitors.
- [x] Public asset requests use long immutable cache headers.
- [x] Uploads reject non-image types and files larger than 5 MB.
- [x] Added paste image upload in `/admin/posts/new` and `/admin/posts/[id]`.
- [x] Added drag-and-drop image upload in the post editor.
- [x] Added gallery image insertion in the post editor.
- [x] Markdown `![alt](asset:token)` renders to `/i/:token`.
- [x] Saving posts syncs `post_assets` from current Markdown.
- [x] Publishing public posts makes only currently referenced assets public.
- [x] Removing image Markdown from a post removes that `post_assets` association on save.
- [x] Referenced assets are protected from physical deletion in the media API.
- [x] Refactored `/admin/posts/new` and `/admin/posts/[id]` into a writing-focused layout.
- [x] Moved core writing fields into the main editor column.
- [x] Moved slug, visibility, published time, and SEO settings into the right settings column.
- [x] Removed the status dropdown from the writing flow.
- [x] Added Edit and Preview tabs for Markdown content.
- [x] Preview renders `asset:token` images through `/i/:token`.
- [x] Updated the writing flow so unpublished content remains browser-local and saved posts are published records.
- [x] Added public `SiteHeader` with desktop and mobile navigation.
- [x] Improved homepage hero, latest post cards, and empty state.
- [x] Improved public post detail layout and prose image styling.
- [x] Added the public timeline view for published posts.
- [x] Added `/about` placeholder page.
- [x] Added unified `AdminLayout`.
- [x] Added admin navigation for Dashboard, Posts, Media, and Settings.
- [x] Added `/admin/settings` placeholder page.
- [x] Updated dashboard, posts, media, and writing pages to use admin navigation.
- [x] Improved media card presentation and action labels.
- [x] Automatically delete R2 objects and remove D1 asset records for post-deletion assets when no posts reference them.
- [x] Delete post now physically removes the post row, clears related associations, and updates asset usage.
- [x] Removing `asset:token` Markdown from a post now updates usage and soft deletes unused assets on save.
- [x] Media library shows `Unused`, `Used by 1 post`, or `Used by N posts`.
- [x] Manual media deletion deletes the R2 object first, then soft deletes the D1 asset record when the asset is unreferenced.
- [x] Added Sakura Cactus design tokens for colors, typography, radius, shadows, and focus states.
- [x] Added reusable `.sc-*` base classes for pages, shells, cards, panels, buttons, forms, badges, prose, admin navigation, and admin tables.
- [x] Split base prose, admin, and animation styles into dedicated CSS files.
- [x] Lightly connected the new base styles to the public post page, admin layout, posts list, and media library.
- [x] Corrected Stage 6.7 toward a SakuraPaper-style minimal blog UI.
- [x] Reworked public navigation to Articles, Timeline, Tags, Friends, About, plus small search/RSS/login entries.
- [x] Added `/articles`, `/timeline`, `/tags`, `/friends`, `/write`, and `/settings`.
- [x] Made `/write` and `/settings` the primary authenticated writing/settings routes.
- [x] Changed `/admin` and `/admin/settings` to compatibility redirects.
- [x] Kept `/admin/media` as a hidden maintenance page outside the main navigation.
- [x] Simplified the homepage, article list, timeline, tags, friends, about, login, article detail, and writing UI around narrow content-first layouts.
- [x] Added `/rss.xml` for public published posts.
- [x] Added `/sitemap.xml` for static public pages, public posts, and public tag pages.
- [x] Added RSS discovery link in the global document head.
- [x] Added `/robots.txt` pointing to the generated sitemap.
- [x] RSS, sitemap, robots, and canonical URLs use the configured `SITE_URL` origin, with the code fallback in `src/lib/seo.ts`.
- [x] Treated the `about` slug as a system page source and hid it from normal discovery flows.
- [x] Refined public tags, timeline, and search information architecture.
- [x] Added lightweight local search overlay without external search dependencies.
- [x] Completed the 2026-07-15 security audit hardening pass.
- [x] Recorded the final audit issue count as 1 P0, 6 P1, and 5 P2.
- [x] Added D1-backed rate limiting for login, uploads, friend applications, and view counting.
- [x] Added SSRF guards for friend URLs and favicon URL settings.
- [x] Hardened upload validation, private media responses, Markdown rendering paths, CSRF checks, private no-store responses, scheduled task isolation, and dependency pins.
- [x] Added `ARCHITECTURE.md`, `SECURITY_AUDIT_REPORT.md`, and `FINAL_REVIEW.md` as audit handoff documents.
- [x] Verified dependency state on `codex/project-maintenance`: every direct dependency in `package.json` is an exact version and matches `pnpm-lock.yaml`.
- [x] Confirmed first-stage dependency maintenance required no file changes and no commit.
- [x] Confirmed the remaining production dependency audit item is 1 known low-severity Babel source-map advisory from the React/Vite toolchain.
- [x] Confirmed writer local autosave/recovery and first paste content preservation from current code.
- [x] Started second-stage documentation synchronization so TODO, README, architecture, and progress notes match implemented code.
- [x] Added `/settings/data` for blog data export/import.
- [x] Added data portability APIs for summary, export, inspect, and import.
- [x] Added JSON/ZIP blog data format v1 with checksums, media manifest, conflict strategies, automatic inspect, and fixture tests.

## Pending

- [ ] Await explicit user confirmation before push, deployment, merge, or remote database operation.

## Known Issues

- The local shell did not have pnpm initially; it was installed globally with npm.
- In this sandbox, Astro telemetry and Wrangler config paths need environment variables during verification:
  - `ASTRO_TELEMETRY_DISABLED=1`
  - `XDG_CONFIG_HOME=D:\code\Sakura-Cactus\.wrangler-config`
- Wrangler D1/R2 IDs are placeholders and must be replaced before remote deployment.
- Local migration verification depends on Wrangler accepting the placeholder D1 database configuration; production requires replacing IDs first.
- Login now uses only `ADMIN_USERNAME` and `ADMIN_PASSWORD`; the old hash override has been removed.
- Git-based Cloudflare deployment now runs `scripts/prepare-cloudflare-config.mjs` to generate `DB` and `MEDIA_BUCKET` bindings from Cloudflare Variables, avoiding committed personal D1 IDs.
- The web setup flow is retired: `/admin/setup` redirects to login and the setup API returns 404. Standard deployment continues to use `ADMIN_USERNAME` and `ADMIN_PASSWORD` from Cloudflare Variables/Secrets.
- `pnpm preview` uses redirected build config under `dist/server`; when manually testing preview-local D1, apply the migrations against that config or use `pnpm dev`.
- `@astrojs/check`, Node types, and binding-only Cloudflare declarations are installed/generated. `pnpm check` and `pnpm exec tsc --noEmit` pass after the 2026-07-15 security audit.
- The remaining dependency audit item is one low-severity Babel source-map advisory whose declared patched Babel 7 version is not yet published. See `SECURITY_AUDIT_REPORT.md`.

## Last Verified Commands

```powershell
pnpm.cmd install --frozen-lockfile --offline
pnpm.cmd exec tsc --noEmit --pretty false
pnpm.cmd check
pnpm.cmd test:posts
pnpm.cmd test:security
pnpm.cmd test:data
pnpm.cmd test:data:fixtures
pnpm.cmd test:data:fixtures:verify
pnpm.cmd build
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
friend_links
post_assets
post_tags
post_view_counts
posts
rate_limits
sakura_schema_state
sessions
settings
site_settings
tags
users
```

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
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

Stage 4 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

```powershell
pnpm.cmd exec tsc --noEmit
```

Result:

```txt
Blocked by existing TypeScript 6 baseUrl deprecation warning in tsconfig.json.
```

```powershell
pnpm.cmd exec tsc --noEmit --ignoreDeprecations 6.0
```

Result:

```txt
Blocked by existing project type environment gaps: Node script types and Wrangler/Cloudflare Worker globals.
```

Stage 5 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Stage 5.5 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Stage 5.6 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Stage 6 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Asset cleanup verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Stage 6.6 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

Stage 6.7 verification:

```powershell
$env:ASTRO_TELEMETRY_DISABLED='1'; $env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'; pnpm.cmd build
```

Result:

```txt
Build completed successfully.
```

## Next Step

Await user confirmation before creating a commit, pushing an audit branch, deploying, or touching remote D1.

Friend links V1:

- Added `friend_links` D1 migration.
- Added public `/friends` display for approved links.
- Added signed-in `/friends` inline create/edit/hide/delete management.
- Changed `/settings` back to a lightweight settings overview with real entry points only.

Site settings controls:

- Added `site_settings` D1 storage.
- Added `post_view_counts` for optional PV counts.
- Added friend link application toggle and pending review flow.
- Added a comment on/off setting and Waline comment slot integration through `PUBLIC_COMMENTS_SERVER_URL`.
- Added external favicon URL output.
- Added settings-triggered expired unreferenced image cleanup.

View counting and friend health checks:

- Changed PV counting to wait 8 seconds and avoid repeat counts from the same browser for 12 hours.
- Added approved friend link health checks with manual admin trigger and weekly scheduled Cron reuse.
- Down friend links stay visible but show a muted grayscale avatar on `/friends`.

Public reading experience:

- Added a window-side paper desk homepage with a small calendar note, featured latest post, paper strip list, and compact tag stickers.
- Added h2/h3 heading ids and article TOC extraction to the Markdown renderer.
- Added desktop paper-edge TOC and mobile collapsible TOC for longer articles.
