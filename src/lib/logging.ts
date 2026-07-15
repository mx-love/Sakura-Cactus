export function reportError(scope: string, error: unknown): void {
  const details: Record<string, string> = {
    name: error instanceof Error ? error.name : 'UnknownError'
  };

  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    details.code = error.code.slice(0, 80).replace(/[^A-Za-z0-9_-]/g, '');
  }

  console.error(scope, details);
}
