const BLOCKED_HOST_SUFFIXES = [
  '.example',
  '.home',
  '.internal',
  '.invalid',
  '.lan',
  '.local',
  '.localdomain',
  '.localhost',
  '.test'
];
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal'
]);

export class UnsafeExternalUrlError extends Error {
  constructor(message = 'URL must target a public http or https address.') {
    super(message);
    this.name = 'UnsafeExternalUrlError';
  }
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.');

  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }

  const octets = parts.map(Number);
  return octets.every((part) => part >= 0 && part <= 255) ? octets : null;
}

function isPublicIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;

  return true;
}

function parseIpv6(hostname: string): bigint | null {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();

  if (!value.includes(':') || !/^[0-9a-f:]+$/.test(value) || value.split('::').length > 2) {
    return null;
  }

  const [leftValue, rightValue = ''] = value.split('::');
  const left = leftValue ? leftValue.split(':') : [];
  const right = rightValue ? rightValue.split(':') : [];
  const missing = 8 - left.length - right.length;

  if ((value.includes('::') && missing < 1) || (!value.includes('::') && missing !== 0)) {
    return null;
  }

  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];

  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
    return null;
  }

  return groups.reduce((result, group) => (result << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

function isPublicIpv6(value: bigint): boolean {
  if (value === 0n || value === 1n) return false;

  const firstByte = Number(value >> 120n);
  const first16 = Number(value >> 112n);
  const first32 = Number(value >> 96n);

  if ((firstByte & 0xfe) === 0xfc || firstByte === 0xff) return false;
  if ((first16 & 0xffc0) === 0xfe80 || (first16 & 0xffc0) === 0xfec0) return false;
  if (first16 === 0x2002 || first32 === 0x0064ff9b || first32 === 0x20010000 || first32 === 0x20010db8) return false;

  if (value >> 32n === 0n) return false;

  if (value >> 32n === 0xffffn) {
    const ipv4Value = Number(value & 0xffffffffn);
    return isPublicIpv4([
      (ipv4Value >>> 24) & 0xff,
      (ipv4Value >>> 16) & 0xff,
      (ipv4Value >>> 8) & 0xff,
      ipv4Value & 0xff
    ]);
  }

  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

  if (BLOCKED_HOSTS.has(normalized) || BLOCKED_HOST_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return !isPublicIpv4(ipv4);

  const ipv6 = parseIpv6(normalized);
  if (ipv6 !== null) return !isPublicIpv6(ipv6);

  return !normalized.includes('.');
}

export function normalizePublicHttpUrl(value: string, base?: string): string {
  let url: URL;

  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    throw new UnsafeExternalUrlError();
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password ||
    isBlockedHostname(url.hostname)
  ) {
    throw new UnsafeExternalUrlError();
  }

  return url.toString();
}

export async function fetchPublicHttpStatusWithRedirects(input: {
  url: string;
  method: 'HEAD' | 'GET';
  headers?: HeadersInit;
  timeoutMs: number;
  maxRedirects?: number;
}): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), input.timeoutMs);
  const maxRedirects = input.maxRedirects ?? 3;
  let currentUrl = normalizePublicHttpUrl(input.url);

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        method: input.method,
        redirect: 'manual',
        headers: input.headers,
        signal: controller.signal
      });

      if (response.status < 300 || response.status > 399) {
        await response.body?.cancel().catch(() => undefined);
        return response.status;
      }

      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);

      if (!location || redirectCount === maxRedirects) {
        throw new Error('Redirect limit exceeded.');
      }

      currentUrl = normalizePublicHttpUrl(location, currentUrl);
    }

    throw new Error('Redirect limit exceeded.');
  } finally {
    clearTimeout(timeoutId);
  }
}
