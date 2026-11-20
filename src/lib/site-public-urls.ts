import { normalizePublicHttpUrl } from './security/external-url';

/** Optional public links must not weaken the existing external-URL policy. */
export function optionalPublicHttpsUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const normalized = normalizePublicHttpUrl(value.trim());
    return new URL(normalized).protocol === 'https:' ? normalized : undefined;
  } catch {
    return undefined;
  }
}
