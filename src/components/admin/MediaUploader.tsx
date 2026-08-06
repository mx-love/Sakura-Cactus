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
    <form className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" onSubmit={handleSubmit}>
      <label className="sc-media-dropzone group flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-[28px] border border-dashed border-[var(--color-border-strong)] px-5 py-6 text-center transition hover:border-[var(--color-primary)]">
        <span className="text-2xl font-light text-[var(--color-primary)]">+</span>
        <span className="mt-3 block text-sm font-black">Choose an image to upload</span>
        <span className="mt-1 block text-xs leading-5 text-[var(--color-muted)]">
          WebP, JPG, PNG, or GIF. Files stay in private R2.
        </span>
        <input
          accept="image/webp,image/jpeg,image/png,image/gif"
          className="mt-4 w-full max-w-sm text-sm text-[var(--color-muted)] file:mr-3 file:rounded-full file:border-0 file:bg-[var(--color-primary-soft)] file:px-3 file:py-2 file:text-sm file:font-bold file:text-[var(--color-text)]"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          type="file"
        />
        {file ? <span className="mt-2 block text-xs font-bold text-[var(--color-text)]">{file.name}</span> : null}
      </label>
      <div className="space-y-3">
        <button
          className="sc-button sc-button-primary w-full disabled:opacity-60 lg:w-auto"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? 'Uploading...' : 'Upload image'}
        </button>
        {error ? <p className="sc-field-error max-w-sm">{error}</p> : null}
      </div>
    </form>
  );
}
