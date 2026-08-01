const DEVELOPMENT_SITE_ORIGIN = 'http://localhost:4321';

export class SiteUrlConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteUrlConfigurationError';
  }
}

export function resolveSiteOrigin(value: string | undefined, isDevelopment: boolean): string {
  const candidate = value?.trim();

  if (!candidate) {
    if (isDevelopment) {
      return DEVELOPMENT_SITE_ORIGIN;
    }

    throw new SiteUrlConfigurationError('SITE_URL must be configured in production.');
  }

  let url: URL;

  try {
    url = new URL(candidate);
  } catch {
    throw new SiteUrlConfigurationError('SITE_URL must be a valid absolute URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SiteUrlConfigurationError('SITE_URL must use http: or https:.');
  }

  if (url.protocol !== 'https:' && !isDevelopment) {
    throw new SiteUrlConfigurationError('SITE_URL must use https: in production.');
  }

  return url.origin;
}
