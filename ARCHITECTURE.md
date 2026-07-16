# Sakura Cactus Architecture

## Runtime request flow

```text
Cloudflare Worker fetch
  -> Astro SSR entrypoint
  -> src/middleware.ts
       canonical redirect
       public Cache API lookup
       same-origin mutation check / request size guard
       admin page/API authorization
       Astro page or API route
       no-store/public cache policy + security headers
  -> feature service
  -> D1 repository and/or private R2 bucket
```

`src/worker.ts` keeps the Cloudflare module Worker entrypoint. Normal requests are delegated to Astro. The weekly scheduled handler independently runs expired temporary-media cleanup, stale-session cleanup, and bounded-concurrency friend-link health checks. Failure in one scheduled task does not prevent the other tasks from running.

## Authentication boundary

The middleware centrally protects:

- `/admin` and every `/admin/*` route except the login page and the retired setup redirect;
- `/write` and `/write/*`;
- `/settings` and `/settings/*`;
- `/api/admin` and every `/api/admin/*` route, for every HTTP method.

The browser never receives `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, the D1 binding, or the R2 binding. Authentication compares the submitted account and password on the server. A successful login creates a 32-byte random token, stores only a secret-bound SHA-256 token hash in D1, and sends the raw token in an `HttpOnly; Secure; SameSite=Lax; Path=/` cookie.

Mutating admin/auth endpoints also reject a conflicting `Origin` or `Sec-Fetch-Site: cross-site` request. SameSite cookies remain a second browser-enforced layer. D1-backed fixed-window limits protect login, uploads, friend applications, and view counting across Worker isolates; no in-memory `Map` is used.

## Data ownership

- `src/features/*/*.repo.ts`: prepared D1 statements and row mapping.
- `src/features/*/*.service.ts`: validation, business rules, multi-resource coordination, and public/admin projections.
- `migrations/`: the only D1 initialization and upgrade path. Runtime requests and scheduled tasks never create, rebuild, or upgrade tables. Remote migration application remains an operator action.

Published posts are the only server-side article state. Unpublished writing, including a new about page before first save, stays in browser localStorage. Association replacements for post assets, post tags, and multi-setting updates use D1 batch operations so a statement failure does not leave a partially replaced set.

`src/features/data-portability` owns blog data import/export. It exports only published/public/current content, approved friend links, and optionally article-bound R2 media. Inspect is read-only and produces a short-lived file/session-bound plan token. Import revalidates the same file, uploads new media before D1 writes, writes D1 rows through batch operations, and compensates only media uploaded by the current import if D1 fails.

## Markdown and HTML

`src/features/posts/post.renderer.ts` is the only Markdown-to-HTML boundary. It escapes raw HTML, rewrites private asset references, applies `rehype-sanitize`, constrains link/image protocols, and adds presentation-only transforms. Public/admin detail reads and admin single-post API responses re-render from `content_markdown`, so legacy `content_html` cannot bypass the current sanitizer policy. `set:html` and React preview output only receive renderer output or JSON that first escapes `<`.

## Private media

R2 remains private and is available only through the `MEDIA_BUCKET` binding. Uploads require an authenticated admin, a D1-backed rate-limit allowance, a single file, a maximum size of 5 MB, an allowed MIME/extension pair, and a matching JPEG/PNG/GIF/WebP signature. Object keys and access tokens are generated server-side.

`/i/:token` checks D1 visibility/public-post references before reading R2. Responses set an allowlisted image content type, `nosniff`, `Content-Disposition: inline`, an ETag, and private or immutable-public cache policy. If R2 upload succeeds but D1 record creation fails, the new R2 object is deleted best-effort.

## Public cache boundary

`src/lib/cache.ts` defines the only public Cache API allowlist. Only selected GET pages/feeds/search output with status 200 and an approved content type can be stored. Admin pages, all non-search APIs, `/write`, `/settings`, requests carrying the admin cookie, responses with `Set-Cookie`, and `?fresh=1` are never publicly cached. Middleware forces `Cache-Control: no-store` on every private response, including redirects, 401, 403, and 413 responses.

## External URL boundary

`src/lib/security/external-url.ts` validates server-fetched friend URLs. It accepts only public HTTP(S) targets without credentials; rejects loopback, private, link-local, reserved IPv4/IPv6 forms and internal-style hostnames; and handles integer/hex IPv4 normalization. Friend health fetches use manual redirects, revalidate every target, allow at most three redirects, use an eight-second total timeout, and cancel response bodies.

## Where new work belongs

- New D1 queries: the relevant feature repository.
- New business rules or cross-resource coordination: the relevant feature service.
- New input/URL/request policy: `src/lib/security/` or a feature-local validator.
- New public caching: the explicit allowlist in `src/lib/cache.ts`, with a documented cache key.
- New scheduled work: a separate failure boundary in `src/worker.ts`.
- New Markdown processing: immediately before or after sanitize in the renderer, with a malicious-input test.
- Future data format changes: extend `src/features/data-portability` with a new explicit file version and fixture set. Do not export site secrets, infrastructure bindings, or browser-local drafts.

## Extension boundaries and plugin policy

The current codebase already has explicit responsibility boundaries:

- repositories own D1 prepared statements and row mapping;
- services own validation, public/admin projections, and D1/R2 coordination;
- `src/lib/security/` owns request and outbound URL policy;
- `src/features/posts/post.renderer.ts` owns Markdown-to-HTML rendering;
- `src/worker.ts` owns the Worker entrypoint and scheduled-task orchestration.

The intended extension seams are Markdown content processing, article publish workflows, media validation/processing, scheduled-task registration, SEO metadata, comment providers, and future backup export/import.

There is no dynamic Plugin Registry today. Sakura Cactus does not support uploading and executing arbitrary third-party plugin code in production. Do not create empty plugin directories, empty registries, or framework abstractions until there are at least two real implementations of the same kind. If that threshold is reached, prefer a build-time static registration interface with a narrow typed context.

Any future extension context must be capability-based and must not expose:

- `ADMIN_PASSWORD`, `ADMIN_PASSWORD_HASH`, or `SESSION_SECRET`;
- the complete Cloudflare `env` object;
- session records, raw cookies, or session tokens;
- raw D1 or R2 bindings;
- arbitrary SQL execution;
- internal request objects carrying credentials.

## Known structural debt

`PostEditor.tsx`, `post.renderer.ts`, `post.repo.ts`, several public Astro pages, and the global stylesheet exceed the preferred size threshold. The large legacy inline scripts in `index.astro`, `friends.astro`, `settings.astro`, and `posts/[slug].astro` are explicitly excluded from TypeScript diagnostics and should be extracted into focused client modules in a UI-specific change. This audit did not perform that high-risk visual refactor.
