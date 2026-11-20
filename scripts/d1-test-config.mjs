import assert from 'node:assert/strict';

/** Use the same local database identity as the Worker under test. */
export function createD1MigrationTestConfig(runtimeConfig, migrationsDirectory, workerMain) {
  for (const resource of ['d1_databases', 'r2_buckets']) {
    assert.ok(!(runtimeConfig[resource] ?? []).some((entry) => entry.remote === true),
      `D1 integration tests require local ${resource} bindings; remote resources are not allowed.`);
  }
  const binding = runtimeConfig.d1_databases?.find((entry) => entry.binding === 'DB');
  assert.ok(binding, 'The built Wrangler configuration must contain the DB binding. Run pnpm build first.');
  const databaseId = binding.preview_database_id ?? binding.database_id;
  assert.ok(typeof databaseId === 'string' && databaseId.trim(), 'The built DB binding must have a local database ID.');
  assert.ok(typeof binding.database_name === 'string' && binding.database_name.trim(), 'The built DB binding must have a database name.');
  return {
    name: 'sakura-cactus-d1-migration-test',
    main: workerMain,
    compatibility_date: runtimeConfig.compatibility_date,
    compatibility_flags: runtimeConfig.compatibility_flags,
    // Copy only local migration fields, never remote credentials or remote:true.
    d1_databases: [{
      binding: 'DB', database_name: binding.database_name,
      database_id: databaseId, migrations_dir: migrationsDirectory
    }]
  };
}
