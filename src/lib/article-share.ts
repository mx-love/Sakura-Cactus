interface ShareServices {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (value: string) => Promise<void> };
}

export async function shareArticle(
  title: string,
  url: string,
  services: ShareServices = navigator
): Promise<'shared' | 'copied' | 'cancelled'> {
  if (services.share) {
    try {
      await services.share({ title, url });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  if (!services.clipboard?.writeText) {
    throw new Error('Clipboard is unavailable.');
  }

  await services.clipboard.writeText(url);
  return 'copied';
}
