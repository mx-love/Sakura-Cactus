export function reportError(scope: string, error: unknown, context: Record<string, unknown> = {}): void {
  const details: Record<string, string> = {
    name: error instanceof Error ? error.name : 'UnknownError'
  };

  if (error instanceof Error && error.message) {
    details.message = error.message.slice(0, 300);
  }

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    details.code = error.code.slice(0, 80).replace(/[^A-Za-z0-9_-]/g, '');
  }

  for (const [key, value] of Object.entries(context)) {
    if (value == null) {
      continue;
    }

    details[key] = String(value).slice(0, 300);
  }

  console.error(scope, details);
}
