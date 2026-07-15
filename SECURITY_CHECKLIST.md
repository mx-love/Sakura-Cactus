# Security Checklist

Status legend:

- `[CODE]` verified from the current implementation.
- `[TEST]` verified by a local automated or runtime test.
- `[CONSOLE]` must be confirmed in the Cloudflare dashboard/production configuration.
- `[PENDING]` not fully complete; see the audit report.
- `[N/A]` not applicable to this project.

Audit issue count: `SECURITY_AUDIT_REPORT.md` records 12 issue entries: 1 P0, 6 P1, and 5 P2. Console and pending checklist items are residual controls, not additional high-risk findings.

## Secrets and deployment

- [x] `[CODE]` `.env`, `.env.*`, `.dev.vars`, logs, Wrangler state, and local package stores are ignored; `.env.example` is retained.
- [x] `[CODE]` no real credential is present in tracked configuration; runtime credentials remain Cloudflare variables/secrets.
- [x] `[CODE]` the prepare script logs binding names only and keeps `keep_vars: true`; it does not log IDs or bucket values.
- [x] `[CODE]` browser code is not passed the raw Cloudflare `env` object.
- [ ] `[CONSOLE]` `ADMIN_PASSWORD` is stored as a Cloudflare Secret, not plain text.
- [ ] `[CONSOLE]` preview and production use separate D1/R2 resources and secrets where appropriate.
- [ ] `[CONSOLE]` `SITE_URL` exactly matches the intended production origin.

## Authentication and authorization

- [x] `[CODE]` `/admin/*`, `/write/*`, and `/settings/*` are centrally protected, with only the login page publicly reachable.
- [x] `[TEST]` unauthenticated `/write` returns a redirect to `/admin/login?next=%2Fwrite` with `no-store` and `noindex,nofollow`.
- [x] `[CODE]` every `/api/admin/*` method passes through centralized authorization.
- [x] `[TEST]` unauthenticated `/api/admin/health` returns 401.
- [x] `[CODE]` retired setup API returns 404 and the setup page redirects to login.
- [x] `[CODE]` credentials are read from `ADMIN_USERNAME` and `ADMIN_PASSWORD` (or the existing optional hash override), not D1 or repository files.
- [x] `[CODE]` account and password comparisons run without the prior username short-circuit.
- [x] `[CODE]` login failures return one generic credential error.
- [x] `[CODE]` D1-backed IP/account login limits work across isolates, expire their own rows, delete old rows in bounded batches, and clear the matching failure windows after successful login.
- [x] `[CODE]` 429 rate-limit responses include a legal seconds `Retry-After` and `Cache-Control: no-store`.
- [ ] `[CONSOLE]` optionally place Cloudflare Access in front of admin/auth routes as an outer layer.

## Sessions and cookies

- [x] `[CODE]` session tokens contain 32 random bytes generated with Web Crypto.
- [x] `[CODE]` D1 stores only a secret-bound token hash.
- [x] `[CODE]` the session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and has a seven-day maximum age.
- [x] `[CODE]` expired/revoked sessions are rejected by the D1 lookup.
- [x] `[CODE]` logout revokes the server-side row before deleting the cookie with matching attributes.
- [x] `[CODE]` login always issues a fresh token; no caller-provided session identifier is reused.
- [x] `[CODE]` cron and successful login remove expired/old-revoked session rows.
- [x] `[CODE]` malformed percent-encoding in a cookie is treated as unauthenticated instead of causing a 500.

## CSRF, redirects, and request limits

- [x] `[CODE]` mutating admin/auth/friend/view endpoints reject a mismatched `Origin` or `Sec-Fetch-Site: cross-site`.
- [x] `[TEST]` a cross-site login POST returns 403.
- [x] `[CODE]` rate-limit identity trusts Cloudflare `CF-Connecting-IP`; user-controlled `X-Forwarded-For` is not used as a fallback.
- [x] `[CODE]` GET and HEAD handlers do not change admin state.
- [x] `[CODE]` API request content length is capped at 256 KiB, with a 6 MiB multipart allowance for the 5 MiB upload endpoint.
- [x] `[CODE]` login `next` accepts a single-leading-slash same-origin path and rejects protocol-relative, absolute, backslash, control-character, and encoded variants.
- [x] `[TEST]` `next=//evil.example` is absent from the rendered login redirect target; pure tests cover encoded backslash/control variants.
- [x] `[CODE]` no permissive application CORS response is configured.

## D1 and data consistency

- [x] `[CODE]` values are passed through D1 prepared statements and `.bind()`.
- [x] `[CODE]` dynamic query fragments come only from internal whitelists/condition builders.
- [x] `[CODE]` post-asset, post-tag, and multi-setting replacements use D1 batch operations.
- [x] `[TEST]` migrations 0001 through 0008 apply successfully to a fresh local D1 database.
- [x] `[CODE]` automatic bootstrap remains backward-compatible and uses a version marker after schema version 8.
- [ ] `[CONSOLE]` confirm production migration history before manually applying 0008; do not run remote migration blindly on an auto-bootstrapped database.
- [ ] `[CONSOLE]` enable/verify D1 backups or point-in-time recovery appropriate to the account plan.

## Markdown, HTML, and browser injection

- [x] `[CODE]` raw Markdown HTML is escaped and renderer output passes through `rehype-sanitize`.
- [x] `[CODE]` links allow only hash, HTTP(S), and mailto forms; images allow HTTP(S) and validated private-asset tokens.
- [x] `[CODE]` raw event attributes, scripts, SVG/MathML input, `javascript:`, and `data:` images are not emitted as executable markup.
- [x] `[CODE]` admin preview and public rendering use the same renderer.
- [x] `[CODE]` post detail reads re-render Markdown under the current sanitizer instead of trusting legacy stored HTML.
- [x] `[CODE]` admin single-post API responses also recalculate `content_html` from Markdown before returning it.
- [x] `[TEST]` malicious Markdown security checks remove executable script, event-handler, JavaScript URL, and data-image output.
- [x] `[CODE]` JSON embedded with `set:html` escapes `<`; JSON-LD also escapes `<`.
- [x] `[CODE]` search highlighting uses text nodes/textContent for user-controlled values.
- [ ] `[PENDING]` a full nonce/hash CSP awaits extraction of legacy inline scripts and a decision on the external Waline client.

## Private R2 media

- [x] `[CODE]` upload/list/update/delete endpoints require admin authentication.
- [x] `[CODE]` exactly one file is accepted and size is limited to 5 MiB.
- [x] `[CODE]` JPEG, PNG, GIF, and WebP require matching MIME, extension (when present), and magic bytes; SVG/HTML are rejected.
- [x] `[TEST]` signature tests cover PNG/JPEG/GIF/WebP signatures, empty/truncated files, MIME/signature mismatch, SVG/HTML rejection, double extension rejection, and filename control/path cleanup.
- [x] `[CODE]` object keys and 24-byte public access tokens are generated server-side.
- [x] `[CODE]` filenames are control/path sanitized and are not used as object keys or response header values.
- [x] `[CODE]` a failed D1 insert triggers best-effort deletion of the newly uploaded R2 object.
- [x] `[CODE]` referenced assets cannot be manually deleted; scheduled cleanup rechecks references per candidate.
- [x] `[CODE]` media responses use allowlisted types, `nosniff`, inline disposition, ETag, and private/public cache policy.
- [x] `[CODE]` upload frequency is D1-rate-limited per admin/client address.
- [ ] `[CONSOLE]` R2 bucket is private.
- [ ] `[CONSOLE]` R2 public development URL is disabled.
- [ ] `[CONSOLE]` R2 has no public custom domain.

## SSRF and external URLs

- [x] `[CODE]` friend URLs accept only HTTP(S), reject URL credentials and local/internal hostnames.
- [x] `[CODE]` canonical integer/hex IPv4, loopback, private, carrier NAT, link-local, reserved/documentation, multicast, and unsafe IPv6 ranges are blocked.
- [x] `[CODE]` redirects are manual, limited to three, and every destination is revalidated.
- [x] `[CODE]` health checks have an eight-second total timeout, use HEAD then a one-byte Range GET fallback, and cancel bodies.
- [x] `[CODE]` checks run with bounded concurrency and isolate each link failure.
- [x] `[TEST]` pure tests reject representative IPv4, IPv6, metadata, integer, and hexadecimal targets.
- [ ] `[PENDING]` DNS rebinding cannot be cryptographically pinned with the standard Workers fetch API; retain platform egress controls and review this boundary if Cloudflare adds a supported resolver/pinning primitive.

## Cache and response policy

- [x] `[CODE]` public Cache API storage is an explicit GET-path allowlist and only stores 200 responses with approved content types.
- [x] `[CODE]` admin pages/APIs, auth APIs, `/write`, `/settings`, `Set-Cookie`, admin-cookie, and `fresh=1` responses bypass public cache.
- [x] `[CODE]` all private responses, including redirects and errors, force `Cache-Control: no-store`.
- [x] `[CODE]` public post/feed/search queries require published, public, non-deleted, non-future rows.
- [x] `[CODE]` security headers set `nosniff`, strict-origin referrer policy, restrictive permissions, frame denial, CSP `base-uri`/`object-src`/`frame-ancestors`, and HTTPS HSTS.
- [ ] `[CONSOLE]` verify dashboard Cache Rules do not override/bypass the application policy for admin/auth/media routes.

## Dependencies, logging, and operations

- [x] `[CODE]` direct dependencies are exact versions; no `latest` specifiers remain.
- [x] `[CODE]` same-major overrides pin patched Vite, Undici, WS, and esbuild versions.
- [x] `[TEST]` Astro 6.4.8 and overrides pass `pnpm check` and `pnpm build`.
- [ ] `[PENDING]` npm audit retains the Babel source-map advisory because no patched Babel 7.x version is published; upgrading to Babel 8 would be a major toolchain change.
- [x] `[CODE]` server error logs emit only a fixed scope, error name, and sanitized code rather than raw error/request bodies.
- [x] `[CODE]` friend health errors stored in D1 are generic and do not include the target URL.
- [ ] `[PENDING]` pin/self-host the optional Waline client instead of the mutable `@v3` unpkg URL after compatibility testing.
- [ ] `[CONSOLE]` review Worker observability retention/access and confirm logs contain no historical secrets.
