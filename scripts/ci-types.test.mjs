import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const configPath = ts.findConfigFile(root, ts.sys.fileExists);
assert.ok(configPath, 'Project tsconfig must exist.');
const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(error, undefined);
const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
assert.equal(parsed.errors.length, 0);

// Compile against the real project configuration, but make generated Astro
// declarations unavailable. Never delete or move the user's .astro directory.
const virtualPath = resolve(root, 'scripts/__ci_runtime_check__.ts');
const source = `import type { APIContext } from 'astro';
export function check(context: Pick<APIContext, 'locals'>) {
  context.locals.cfContext.waitUntil(Promise.resolve());
}`;
const host = ts.createCompilerHost(parsed.options);
const originalGetSourceFile = host.getSourceFile.bind(host);
const originalFileExists = host.fileExists.bind(host);
const originalReadFile = host.readFile.bind(host);
const generated = (path) => path.replaceAll('\\', '/').includes('/.astro/');
host.getSourceFile = (path, languageVersion, ...rest) => {
  if (generated(path)) return undefined;
  if (resolve(path) === virtualPath) return ts.createSourceFile(path, source, languageVersion, true);
  return originalGetSourceFile(path, languageVersion, ...rest);
};
host.fileExists = (path) => !generated(path) && (resolve(path) === virtualPath || originalFileExists(path));
host.readFile = (path) => generated(path) ? undefined : resolve(path) === virtualPath ? source : originalReadFile(path);
const program = ts.createProgram([
  resolve(root, 'src/env.d.ts'), resolve(root, 'worker-configuration.d.ts'), virtualPath
], { ...parsed.options, noEmit: true }, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
assert.equal(program.getSourceFiles().some((file) => generated(file.fileName)), false,
  'The regression must not consume any local .astro cache.');
assert.deepEqual(diagnostics.map((diagnostic) => ({
  code: diagnostic.code,
  message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
})), [], 'Cloudflare locals must type-check without generated .astro declarations.');

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const sync = workflow.indexOf('run: pnpm exec astro sync');
const typecheck = workflow.indexOf('run: pnpm exec tsc --noEmit --pretty false');
assert.ok(sync >= 0 && typecheck > sync, 'CI must generate Astro types before running tsc.');
console.log('Clean-checkout Cloudflare types and CI ordering regression checks passed.');
