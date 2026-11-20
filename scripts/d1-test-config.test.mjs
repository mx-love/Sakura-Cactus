import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createD1MigrationTestConfig } from './d1-test-config.mjs';

function runtime(databaseId, extra = {}) {
  return {
    compatibility_date: '2026-05-19', compatibility_flags: ['nodejs_compat'],
    d1_databases: [
      { binding: 'UNRELATED', database_name: 'other', database_id: 'other-id' },
      { binding: 'DB', database_name: 'sakura_blog_prod', database_id: databaseId, ...extra }
    ]
  };
}

test('migration fixtures follow the built ID, including CI and customized bindings', () => {
  for (const id of ['ci-placeholder', '11111111-2222-4333-8444-555555555555', 'custom-local-id']) {
    const input = runtime(id);
    const before = JSON.stringify(input);
    const full = createD1MigrationTestConfig(input, '/repo/migrations', '/repo/src/worker.ts');
    const upgrade = createD1MigrationTestConfig(input, '/tmp/migrations-v9', '/repo/src/worker.ts');
    assert.equal(full.d1_databases[0].database_id, id);
    assert.equal(upgrade.d1_databases[0].database_id, id);
    assert.equal(full.d1_databases[0].database_name, 'sakura_blog_prod');
    assert.equal(full.d1_databases[0].migrations_dir, '/repo/migrations');
    assert.equal(upgrade.d1_databases[0].migrations_dir, '/tmp/migrations-v9');
    assert.equal(JSON.stringify(input), before, 'Do not rewrite the production configuration.');
  }
});

test('preview identity matches Wrangler dev and migration fixtures only copy local fields', () => {
  const config = createD1MigrationTestConfig(runtime('primary-id', {
    preview_database_id: 'preview-id', extra: 'not-copied'
  }), '/tmp/migrations', '/repo/worker.ts');
  assert.equal(config.d1_databases[0].database_id, 'preview-id');
  assert.equal(config.d1_databases[0].remote, undefined);
  assert.equal(config.d1_databases[0].preview_database_id, undefined);
  assert.equal(config.d1_databases[0].extra, undefined);
});

test('integration configuration rejects remote D1 and R2 resources', () => {
  assert.throws(() => createD1MigrationTestConfig(runtime('id', { remote: true }), '/tmp', '/repo/worker.ts'), /remote resources/);
  assert.throws(() => createD1MigrationTestConfig({ ...runtime('id'), r2_buckets: [{ binding: 'MEDIA_BUCKET', remote: true }] }, '/tmp', '/repo/worker.ts'), /remote resources/);
});

test('missing build bindings fail early instead of starting a different empty database', () => {
  assert.throws(() => createD1MigrationTestConfig({}, '/tmp', '/repo/worker.ts'), /DB binding/);
  assert.throws(() => createD1MigrationTestConfig(runtime(''), '/tmp', '/repo/worker.ts'), /database ID/);
});
