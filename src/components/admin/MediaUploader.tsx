import { useState } from 'react';

interface ApiErrorResponse {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export function MediaUploader() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError('Choose an image first.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/assets/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setError(payload?.error.message ?? 'Unable to upload image.');
        return;
      }

      window.location.reload();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={handleSubmit}>
      <label className="flex-1 space-y-2">
        <span className="block text-sm font-medium">Image</span>
        <input
          accept="image/webp,image/jpeg,image/png,image/gif"
          className="w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
      </label>
      <button
        className="rounded-lg bg-[var(--color-text)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? 'Uploading...' : 'Upload'}
      </button>
      {error ? <p className="text-sm text-red-700 sm:basis-full">{error}</p> : null}
    </form>
  );
}
