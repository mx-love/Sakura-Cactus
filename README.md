# Sakura Cactus

Sakura Cactus is a Cloudflare-native personal blog system built with Astro, Cloudflare Workers, D1, R2, TypeScript, React, and Tailwind CSS.

The project keeps code and content separate:

- Code is committed to GitHub and deployed by Cloudflare.
- Posts are created in `/admin` and stored in Cloudflare D1.
- Images are stored in a private Cloudflare R2 bucket.
- Public image access must go through `/i/:token`.

## Current Stage

Stage 6.7: SakuraPaper minimal blog UI correction.

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
- Private R2 media upload from `/admin/media`
- D1-backed asset records
- Admin asset APIs under `/api/admin/assets`
- Token-based image proxy at `/i/:token`
- Public/draft/private asset visibility controls
- Paste image upload in the post editor
- Drag-and-drop image upload in the post editor
- Gallery image insertion from the post editor
- `asset:token` Markdown image rendering to `/i/:token`
- `post_assets` syncing when posts are saved
- Referenced images are made public when a public post is published
- Automatic soft delete for images that are no longer referenced by any post
- Public site header with Articles, Timeline, Tags, Friends, About, search/RSS placeholders, and login entry
- Mobile front-site menu
- Minimal SakuraPaper-style homepage and latest post list
- Minimal article reading layout
- Unified admin layout and navigation
- `/archive`, `/about`, and `/admin/settings` placeholder pages
- Sakura Cactus design tokens for colors, radius, shadows, focus states, buttons, forms, badges, and prose
- Reusable base CSS classes under the `.sc-*` namespace
- `/articles`, `/timeline`, `/tags`, `/friends`, `/write`, and `/settings`
- `/write` as the primary private writing entry
- `/settings` as the primary private blog settings entry
- `/admin/media` retained as a hidden media maintenance page

Not implemented yet:

- Full settings system
- Full tag management
- Friend link management and application flow

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

After signing in, open `/write` to create a post. Existing compatibility routes under `/admin/posts` are retained for maintenance.

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

## Media Library

`/admin/media` is retained as a hidden maintenance page. Daily writing should use the image controls inside `/write`.

Rules:

- Files are stored in the private `MEDIA_BUCKET` R2 bucket.
- Public URLs use `/i/:token`; R2 object keys are not exposed.
- Tokens are random URL-safe values, not sequential IDs.
- Uploads create D1 records in `assets`.
- Default visibility is `draft`.
- Allowed MIME types: `image/webp`, `image/jpeg`, `image/png`, `image/gif`.
- Maximum file size: 5 MB.
- SVG, HTML, JavaScript, executable, archive, and non-image uploads are rejected.

Visitor access:

```txt
public asset -> 200
asset used by a published public post -> 200
draft/private asset without admin session -> 404
deleted or missing asset -> 404
```

Admin access:

```txt
draft/private asset with valid admin session -> 200
```

Public assets use long immutable caching. Draft/private assets use `Cache-Control: private, no-store`.

## Editor Images

In `/write` and the retained edit route `/admin/posts/[id]`, administrators can insert images without leaving the editor:

- Paste an image into the Markdown textarea.
- Drag an image file onto the Markdown textarea.
- Upload a local image from the editor toolbar.
- Choose from the existing gallery.
- Insert an external image URL directly into Markdown.

The editor inserts this Markdown syntax:

```md
![图片说明](asset:token)
```

The renderer converts it to:

```html
<img src="/i/token" alt="图片说明" loading="lazy" />
```

R2 keys and R2 public URLs are never written to post content. Saving a post rescans the Markdown and updates `post_assets`. Publishing a public post makes only the currently referenced assets public. When an image is no longer referenced by any post, Sakura Cactus deletes the R2 object first, then soft deletes the D1 asset record.
