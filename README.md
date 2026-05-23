# Sakura Cactus

Sakura Cactus is a Cloudflare Workers personal blog system built with Astro, Cloudflare Workers, D1, R2, TypeScript, React, and Tailwind CSS.

The project keeps code and content separate:

- Code is committed to GitHub and deployed to Cloudflare Workers.
- Posts are created in `/write` and stored in Cloudflare D1.
- Images are stored in a private Cloudflare R2 bucket.
- Public image access must go through `/i/:token`.
- Cloudflare Workers handles Astro SSR, APIs, D1, R2, and scheduled cleanup Cron.

Sakura Cactus targets Cloudflare Workers. Cloudflare Pages is not the recommended deployment target for this project.

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
- Environment-variable administrator authentication
- D1-backed sessions
- HttpOnly Secure SameSite=Lax session cookie
- `/admin/login` and `/admin`
- `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- Server-side protection for `/admin/*` and `/api/admin/*`
- Login with `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`; local development can use `ADMIN_PASSWORD`
- Admin post list, create, edit, publish, unpublish, and soft delete
- D1-backed post API under `/api/admin/posts`
- Server-rendered GitHub Flavored Markdown-style HTML with basic sanitization
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
- RSS feed at `/rss.xml`
- Sitemap at `/sitemap.xml`
- Robots metadata at `/robots.txt`

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

Configure the local administrator through `.dev.vars`:

```txt
ADMIN_USERNAME=sakura
ADMIN_PASSWORD=change-me
```

`ADMIN_USERNAME` can be any name you want to use for the private writing area, such as `sakura`, `owner`, or a nickname. `ADMIN_PASSWORD` is for local development convenience and must never be committed.

Apply D1 migrations locally, then start the app and open `/admin/login`:

```powershell
$env:XDG_CONFIG_HOME='D:\code\Sakura Cactus\.wrangler-config'
pnpm.cmd db:migration:apply:local
pnpm.cmd dev
```

For production, set Cloudflare Workers secrets first and apply migrations against remote D1:

```bash
wrangler secret put ADMIN_USERNAME
wrangler secret put ADMIN_PASSWORD_HASH
wrangler secret put SITE_URL
pnpm db:migration:apply:prod
```

`SITE_URL` should be the absolute production site URL, for example:

```txt
SITE_URL=https://example.com
```

Sakura Cactus uses `SITE_URL` when generating RSS and sitemap URLs. If `SITE_URL` is missing during local development, feeds fall back to `http://localhost:4321`.

`ADMIN_PASSWORD_HASH` uses Sakura Cactus' PBKDF2-SHA256 password hash format. Generate a hash for your real password locally:

```bash
node -e 'const crypto=require("crypto"); const p=process.argv[1]; const salt=crypto.randomBytes(16); const iter=210000; const hash=crypto.pbkdf2Sync(p,salt,iter,32,"sha256"); console.log(["pbkdf2_sha256",iter,salt.toString("base64url"),hash.toString("base64url")].join("$"))' "your-password"
```

Do not commit the generated hash. Store it with `wrangler secret put ADMIN_PASSWORD_HASH`.

`SESSION_SECRET` is an advanced optional override. If it is not set, Sakura Cactus derives the session signing secret from the administrator password configuration:

- Production: derived from `ADMIN_PASSWORD_HASH` by default. If production only sets `ADMIN_PASSWORD`, Sakura Cactus can still derive sessions from it, but logs a warning and this is not recommended.
- Local dev: derived from `ADMIN_PASSWORD` when `ADMIN_PASSWORD_HASH` is not set.

Changing `ADMIN_PASSWORD_HASH` or local `ADMIN_PASSWORD` invalidates existing login sessions. This is acceptable for most personal blogs. If you want old sessions to stay valid after changing the admin password, set a custom `SESSION_SECRET`.

Generate a long optional `SESSION_SECRET` with:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

If both `ADMIN_PASSWORD_HASH` and `ADMIN_PASSWORD` exist, Sakura Cactus uses `ADMIN_PASSWORD_HASH`. `ADMIN_PASSWORD` is kept for local development convenience. If production only sets `ADMIN_PASSWORD`, Sakura Cactus logs a warning recommending `ADMIN_PASSWORD_HASH`.

Changing the administrator username or password only requires updating Cloudflare Workers Secrets. Sakura Cactus no longer uses `SETUP_TOKEN`, `/admin/setup`, or a web-based first-admin creation flow. The `users` table remains in D1 for legacy ownership/session compatibility, but administrator credentials are read from environment variables, not from D1.

## Security Notes

Do not commit `.env`, `.dev.vars`, Cloudflare API tokens, R2 access keys, session secrets, Turnstile secrets, administrator passwords, or generated password hashes. Do not put real passwords or real password hashes in `wrangler.jsonc`; use `wrangler secret put`.

Admin authentication compares the submitted username against `ADMIN_USERNAME` and verifies the submitted password against `ADMIN_PASSWORD_HASH` when present. D1 stores session token hashes; administrator passwords are not stored in D1. The browser receives only an HttpOnly, Secure, SameSite=Lax cookie.

Browser password managers may offer to save the password typed into `/admin/login`; that is normal browser behavior. Sakura Cactus does not save plaintext administrator passwords to D1. Production should store `ADMIN_PASSWORD_HASH` in Cloudflare Workers Secrets. After login, Sakura Cactus uses the HttpOnly session cookie rather than storing tokens in localStorage or sessionStorage.

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
AND published_at IS NOT NULL
AND published_at <= CURRENT_TIMESTAMP
AND deleted_at IS NULL
```

Draft, private, archived, deleted, and missing posts return 404 on public detail routes.

## RSS and Sitemap

Sakura Cactus exposes production blog metadata routes:

- RSS: `/rss.xml`
- Sitemap: `/sitemap.xml`
- Robots: `/robots.txt`

RSS is used by feed readers and aggregators. Sitemap helps search engines discover public pages. `robots.txt` allows crawling and points crawlers to the sitemap.

RSS and sitemap only include public posts that are published, visible, not deleted, and not scheduled for the future. Sitemap also includes public tag pages that have at least one visible public post. RSS, sitemap, and robots URLs are generated from `SITE_URL` in Cloudflare Workers Secrets, with a local fallback of `http://localhost:4321`.

RSS currently uses each post excerpt for `description` and `content:encoded`. Full-content RSS can be added later after safely absolute-URL rewriting rendered post HTML.

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

## Writing Markdown

Sakura Cactus uses a clean GitHub Flavored Markdown-style writing flow. The `/write` page keeps a plain Markdown textarea. Rendering is handled by a local `unified` / `remark-gfm` / `rehype-sanitize` pipeline and does not call the GitHub Markdown API.

- Headings: `#`, `##`, `###`
- Emphasis: `**bold**`, `*italic*`, `~~strikethrough~~`
- Blockquotes
- Ordered and unordered lists
- Task lists: `- [ ] todo` and `- [x] done`
- Tables
- Inline code and fenced code blocks
- Links and automatic `https://example.com` links
- Markdown images

Keep post content portable Markdown. Sakura Cactus does not render raw HTML in posts; HTML such as `<script>`, `<iframe>`, `<img>`, or inline event attributes is escaped and shown as text instead of being executed. If you need a small image attribution or note, use a Markdown quote:

```md
> 图片资源出自互联网收集整理，如果侵犯了您的合法权益，请联系我删除。
```

## Editor Images

In `/write` and the retained edit route `/admin/posts/[id]`, administrators can insert images without leaving the editor:

- Paste an image into the Markdown textarea.
- Drag an image file onto the Markdown textarea.
- Paste an external image URL ending in `.jpg`, `.jpeg`, `.png`, `.webp`, or `.gif`; the editor converts it to Markdown image syntax.

The editor inserts this Markdown syntax:

```md
![图片说明](asset:token)
```

The renderer converts it to:

```html
<img src="/i/token" alt="图片说明" loading="lazy" />
```

R2 keys and R2 public URLs are never written to post content. Saving a post rescans the Markdown and updates `post_assets`. Publishing a public post makes only the currently referenced assets public. When an image is no longer referenced by any post, Sakura Cactus deletes the R2 object first, then soft deletes the D1 asset record.
