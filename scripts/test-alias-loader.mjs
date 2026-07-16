import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function resolveExistingFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }

  throw new Error(`Unable to resolve test import: ${basePath}`);
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') {
    return {
      shortCircuit: true,
      url: 'data:text/javascript,export const env = globalThis.__cloudflareWorkersEnv ?? (globalThis.__cloudflareWorkersEnv = {});'
    };
  }

  if (specifier.startsWith('@/')) {
    const filePath = resolveExistingFile(path.resolve(process.cwd(), 'src', specifier.slice(2)));
    return {
      shortCircuit: true,
      url: pathToFileURL(filePath).href
    };
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const filePath = resolveExistingFile(path.resolve(parentDir, specifier));
    return {
      shortCircuit: true,
      url: pathToFileURL(filePath).href
    };
  }

  return nextResolve(specifier, context);
}
