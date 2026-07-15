# Sakura Cactus Architecture

## Runtime request flow

```text
Cloudflare Worker fetch
  -> Astro SSR entrypoint
  -> src/middleware.ts
       canonical redirect
       public Cache API lookup
       same-origin mutation check / request size guard
       D1 schema version check
       admin page/API authorization
       Astro page or API route
       no-store/public cache policy + security headers
  -> feature service
  -> D1 repository and/or private R2 bucket
```

`src/worker.ts` keeps the Cloudflare module Worker entrypoint. Normal requests are delegated to Astro. The weekly scheduled handler independently runs expired draft-asset cleanup, stale-session cleanup, and bounded-concurrency friend-link health checks. Failure in one scheduled task does not prevent the other tasks from running.

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
- `src/lib/schema.ts`: backward-compatible automatic bootstrap. A schema-version marker reduces warm/cold-isolate DDL work to one read after version 8 is present.
- `migrations/`: explicit local/managed migration history. Remote migration application remains an operator action.

Association replacements for post assets, post tags, and multi-setting updates use D1 batch operations so a statement failure does not leave a partially replaced set.

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

Potential future extension boundaries are Markdown processing, publish hooks, media validation, scheduled-task registration, SEO metadata, and comment providers. No plugin registry was added during this audit: there is not yet a real second implementation that justifies a runtime abstraction. If one is later introduced, its context must expose narrow post/media/metadata values only and must never include raw environment variables, credentials, cookies, D1/R2 bindings, or session tokens.

## Known structural debt

`PostEditor.tsx`, `post.renderer.ts`, `post.repo.ts`, several public Astro pages, and the global stylesheet exceed the preferred size threshold. The large legacy inline scripts in `index.astro`, `friends.astro`, `settings.astro`, and `posts/[slug].astro` are explicitly excluded from TypeScript diagnostics and should be extracted into focused client modules in a UI-specific change. This audit did not perform that high-risk visual refactor.
