const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingRequest(request: Request): boolean {
  return MUTATING_METHODS.has(request.method.toUpperCase());
}

export function isSameOriginBrowserRequest(request: Request, url: URL): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase();

  if (fetchSite === 'cross-site') {
    return false;
  }

  const origin = request.headers.get('origin');

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

export function normalizeInternalRedirect(value: string | null | undefined, fallback = '/write'): string {
  if (!value || value.length > 2_048) {
    return fallback;
  }

  let decoded = value;

  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }

  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    !decoded.startsWith('/') ||
    decoded.startsWith('//') ||
    value.includes('\\') ||
    decoded.includes('\\') ||
    /[\u0000-\u001F\u007F]/.test(value) ||
    /[\u0000-\u001F\u007F]/.test(decoded)
  ) {
    return fallback;
  }

  try {
    const base = new URL('https://sakura.invalid');
    const target = new URL(value, base);
    return target.origin === base.origin && target.pathname.startsWith('/') ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch {
    return fallback;
  }
}

export function getClientAddress(request: Request): string {
  const normalized = request.headers.get('cf-connecting-ip')?.trim().toLowerCase().slice(0, 128);
  return normalized || 'unknown';
}

export function applySecurityHeaders(response: Response, url: URL, options: { privateResponse?: boolean } = {}): Response {
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "base-uri 'self'; frame-ancestors 'none'; object-src 'none'");
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');

  if (url.protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  }

  if (options.privateResponse) {
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
