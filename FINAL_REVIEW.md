# Final Pre-Commit Review

Review date: 2026-07-16
Scope: local uncommitted security hardening changes only. No commit, push, deploy, stash, reset, clean, or remote D1 operation was executed.

## Review Scope

- Branch remains `main`.
- Reviewed Git status, diff stat, diff check, name-status, tracked diffs, and untracked new files.
- Rechecked authentication, D1 rate limiting, migration 0008, SSRF defenses, CSRF middleware, upload validation, Markdown rendering, response headers, dependency overrides, generated Worker types, local logs, and secret exposure.
- `.astro-dev-audit.log` and `.astro-dev-audit-error.log` were not present; exact ignore rules were added for both audit log names. A temporary fake `.dev.vars` was created only for local HTTP smoke and was deleted before final status.
- Browser automation was requested for CSP verification, but the in-app browser backend was unavailable (`agent.browsers.list()` returned `[]`). Browser CSP behavior is therefore marked unverified, not passed.

## Original Report Inconsistency

- Recounted `SECURITY_AUDIT_REPORT.md`: 12 findings total.
- Final count is 1 P0, 6 P1, and 5 P2.
- Updated `SECURITY_AUDIT_REPORT.md`, `SECURITY_CHECKLIST.md`, and `AI_PROGRESS.md` to use the same count.

## Fixed During This Review

- D1 rate-limit cleanup now deletes expired rows in bounded batches instead of a full unbounded delete.
- Login success now clears the matching IP and IP+account failed-login rate-limit windows.
- Rate-limit identity now trusts only Cloudflare `CF-Connecting-IP`; user-controlled `X-Forwarded-For` is not used as fallback.
- Public 429 rate-limit responses now include `Cache-Control: no-store`.
- Upload D1-insert rollback now logs R2 delete failure without hiding the primary D1 error.
- Friend health checks still isolate per-link network/URL failures, but D1 update failures now propagate instead of returning false success.
- Admin single-post API responses recalculate `content_html` from current Markdown before returning it.
- Exact `.gitignore` rules were added for `.astro-dev-audit.log` and `.astro-dev-audit-error.log`.
- `test:security` now covers rate-limit window/concurrency edges, SSRF variants and redirects, body cancellation, request origin rules, upload edge cases, and broader Markdown injection payloads.

## Unfixed Blockers

- No P0 or high-risk P1 blocker remains for creating a local commit.
- Browser-level CSP/hydration/Waline validation is unverified because no browser backend was available in this session.
- Production deployment is not cleared until Cloudflare dashboard settings and preview/browser checks are completed.
- The remaining dependency advisory is one low-severity Babel source-map advisory from `@astrojs/react -> @vitejs/plugin-react -> @babel/core`; the declared patched Babel 7 version is not published yet.

## Migration Risk

- `migrations/0008_security_hardening.sql` only adds `rate_limits`, `idx_rate_limits_expires_at`, and `sakura_schema_state`; it does not delete or rename production data.
- `src/lib/schema.ts` schema version is consistent with migration version 8.
- Fresh local D1 path verified: official local migration apply ran 0001 through 0008 successfully.
- Upgrade local D1 path verified: executed 0001 through 0007 into a separate local database, then executed 0008 successfully.
- Runtime bootstrap remains idempotent with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`; repeated deployment should not conflict with already-created objects.
- If D1 is unavailable, rate-limited write paths fail closed instead of silently bypassing the limit.

## Cloudflare Console Items

- Confirm `ADMIN_PASSWORD` and optional `SESSION_SECRET` are Secrets, not plain variables.
- Confirm preview and production use separate D1/R2 resources and secrets where appropriate.
- Confirm R2 bucket is private, public development URL is disabled, and no public custom domain is attached.
- Confirm Cache Rules do not cache `/admin*`, `/api/admin*`, `/api/auth*`, `/write*`, `/settings*`, or private media responses.
- Confirm D1 backup/recovery and observability retention/access policies.
- Preview-test login/logout, image upload/read, article publishing/editing/permanent deletion, blog data import/export, friend application/health check, view counting, and scheduled cleanup.

## Test Results

- `git branch --show-current`: `main`.
- `git diff --check`: passed.
- `pnpm.cmd install --offline --frozen-lockfile`: passed.
- `pnpm.cmd db:migration:apply:local`: passed; no pending local migrations.
- Fresh temp local D1 0001-0008 migration apply: passed.
- Temp local D1 0001-0007 then 0008 upgrade: passed.
- `pnpm.cmd exec tsc --noEmit --pretty false`: passed.
- `pnpm.cmd check`: passed with 0 errors and 4 deprecation hints.
- `pnpm.cmd test:security`: passed.
- `pnpm.cmd build`: passed.
- Local HTTP smoke: passed for `/api/health` 200, unauthenticated `/api/admin/health` 401 + no-store, `/write` 302 to login, cross-origin login 403 + no-store, same-origin invalid login 401, login page security headers.
- `pnpm.cmd audit --prod --registry=https://registry.npmjs.org/`: completed with 1 low vulnerability, 0 moderate/high/critical.
- `pnpm.cmd list --depth 0`: passed; 19 direct packages listed.
- `pnpm.cmd why astro/vite/undici/ws/esbuild`: passed; each resolved to one version.
- Direct dependency spec check: no `latest`, caret, tilde, or `workspace:*` direct specs.
- Secret scan: only variable names and documentation examples were found; no real secret value was found.
- Local temp/log scan: no `.dev.vars`, smoke log, `.astro-dev-audit.log`, or `.astro-dev-audit-error.log` remained in the repo.

## Commit Suitability

Suitable to create one or more local commits after user confirmation.

Recommended commit boundary:

1. Security runtime fixes: auth, rate-limit, CSRF, SSRF, upload, Markdown, response headers, scheduled tasks.
2. Dependency and generated type updates.
3. Security tests and documentation.

## Push Suitability

Suitable to push an audit branch after user confirmation. Do not push directly to `main` without explicit instruction.

## Production Deployment Suitability

Not suitable for immediate production deployment. Required first: Cloudflare console verification, preview environment testing, and browser validation for CSP/hydration/Waline behavior.
