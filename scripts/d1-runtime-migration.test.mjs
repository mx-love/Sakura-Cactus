import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = path.join(repoRoot, '.tmp', 'd1-runtime-migration');
const fullPersistPath = path.join(tempRoot, 'empty-to-0010');
const upgradePersistPath = path.join(tempRoot, 'upgrade-0009-to-0010');
const v9MigrationsPath = path.join(tempRoot, 'migrations-v9');
const v9ConfigPath = path.join(tempRoot, 'wrangler-v9.jsonc');
const seedPath = path.join(tempRoot, 'seed-0009.sql');
const postMigrationHttpSetupPath = path.join(tempRoot, 'prepare-http-0010.sql');
const wranglerCli = path.join(repoRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const databaseName = 'sakura_blog_prod';
const testPort = 8796;
const testOrigin = `http://127.0.0.1:${testPort}`;
const wranglerEnv = {
  ...process.env,
  CI: '1',
  WRANGLER_WRITE_LOGS: 'false',
  XDG_CONFIG_HOME: path.join(tempRoot, 'xdg-config')
};

assert.ok(tempRoot.startsWith(path.join(repoRoot, '.tmp') + path.sep));
rmSync(tempRoot, { recursive: true, force: true });
mkdirSync(v9MigrationsPath, { recursive: true });

function runWrangler(args, options = {}) {
  const result = spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: repoRoot,
    env: wranglerEnv,
    encoding: 'utf8',
    windowsHide: true,
    ...options
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  if (result.status !== 0) {
    throw new Error(`Wrangler command failed: wrangler ${args.join(' ')}\n${output}`);
  }

  assert.doesNotMatch(output, /BEGIN TRANSACTION|SAVEPOINT statements/i);
  return output;
}

function migrationArgs(configPath, persistPath) {
  return [
    'd1',
    'migrations',
    'apply',
    databaseName,
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath
  ];
}

function executeFile(configPath, persistPath, filePath) {
  runWrangler([
    'd1',
    'execute',
    databaseName,
    '--local',
    '--config',
    configPath,
    '--persist-to',
    persistPath,
    '--file',
    filePath,
    '--yes'
  ]);
}

function findSqliteFiles(root) {
  const files = [];

  for (const name of readdirSync(root)) {
    const absolutePath = path.join(root, name);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      files.push(...findSqliteFiles(absolutePath));
    } else if (name.endsWith('.sqlite') && name !== 'metadata.sqlite') {
      files.push(absolutePath);
    }
  }

  return files;
}

function openPersistedD1(persistPath) {
  const sqliteFiles = findSqliteFiles(persistPath);
  assert.equal(sqliteFiles.length, 1, `Expected one persisted D1 database, found ${sqliteFiles.length}.`);
  return new DatabaseSync(sqliteFiles[0]);
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDatabaseHealthy(db) {
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
}

function assertPublishedOnlySchema(db) {
  const postsSql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'")
    .get().sql;
  assert.match(postsSql, /status TEXT NOT NULL DEFAULT 'published' CHECK \(status IN \('published'\)\)/);
  assert.match(postsSql, /visibility TEXT NOT NULL DEFAULT 'public' CHECK \(visibility IN \('public'\)\)/);
  assert.match(postsSql, /FOREIGN KEY \(cover_asset_id\) REFERENCES assets\(id\) ON DELETE SET NULL/);

  const indexNames = new Set(
    db.prepare('PRAGMA index_list(posts)').all().map((index) => index.name)
  );
  assert.equal(indexNames.has('idx_posts_slug'), true);
  assert.equal(indexNames.has('idx_posts_public_lookup'), true);
  assert.equal(indexNames.has('idx_posts_created_at'), true);
  assert.equal(indexNames.has('idx_posts_pinned_at'), true);
  assert.equal(indexNames.has('idx_posts_status_published'), false);

  for (const childTable of ['post_tags', 'post_assets', 'post_view_counts']) {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${childTable})`).all();
    assert.ok(
      foreignKeys.some(
        (foreignKey) =>
          foreignKey.table === 'posts' &&
          foreignKey.from === 'post_id' &&
          foreignKey.to === 'id' &&
          foreignKey.on_delete === 'CASCADE'
      ),
      `${childTable} should still cascade to posts(id).`
    );
  }

  const insertSql = `INSERT INTO posts (
    id, slug, title, content_markdown, status, visibility, reading_time_minutes,
    word_count, published_at, created_at, updated_at
  ) VALUES (?, ?, ?, 'body', ?, ?, 1, 1, datetime('now'), datetime('now'), datetime('now'))`;
  assert.throws(() => db.prepare(insertSql).run('invalid-draft', 'invalid-draft', 'Draft', 'draft', 'public'));
  assert.throws(() => db.prepare(insertSql).run('invalid-archived', 'invalid-archived', 'Archived', 'archived', 'public'));
  assert.throws(() => db.prepare(insertSql).run('invalid-private', 'invalid-private', 'Private', 'published', 'private'));
}

function lifecycleSnapshot(db) {
  return {
    version: db.prepare('SELECT version FROM sakura_schema_state WHERE id = 1').get().version,
    posts: db.prepare('SELECT id, status, visibility FROM posts ORDER BY id').all(),
    postTags: db.prepare('SELECT post_id, tag_id FROM post_tags ORDER BY post_id, tag_id').all(),
    postAssets: db.prepare('SELECT post_id, asset_id, role FROM post_assets ORDER BY post_id, asset_id, role').all(),
    viewCounts: db.prepare('SELECT post_id, count FROM post_view_counts ORDER BY post_id').all(),
    candidates: db
      .prepare('SELECT asset_id FROM historical_post_asset_cleanup_candidates ORDER BY asset_id')
      .all()
  };
}

function jsonConfig(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function createV9MigrationFixture() {
  for (const name of readdirSync(path.join(repoRoot, 'migrations')).sort()) {
    if (/^000[1-9]_.*\.sql$/.test(name)) {
      copyFileSync(path.join(repoRoot, 'migrations', name), path.join(v9MigrationsPath, name));
    }
  }

  writeFileSync(
    v9ConfigPath,
    jsonConfig({
      name: 'sakura-cactus-d1-migration-test',
      main: '../../src/worker.ts',
      compatibility_date: '2026-05-19',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [
        {
          binding: 'DB',
          database_name: databaseName,
          database_id: 'REPLACE_WITH_YOUR_D1_DATABASE_ID',
          migrations_dir: './migrations-v9'
        }
      ]
    })
  );

  writeFileSync(
    seedPath,
    `INSERT INTO users (
  id, username, email, display_name, password_hash, role, status, created_at, updated_at, last_login_at
) VALUES (
  'fixture-user', 'fixture-user', NULL, 'Fixture user', 'fixture-hash',
  'admin', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL
);

INSERT INTO tags (id, name, slug, color, created_at, updated_at)
VALUES ('tag-fixture', 'Fixture', 'fixture', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO assets (
  id, token, r2_key, original_filename, mime_type, size_bytes, width, height, sha256,
  visibility, usage_count, created_by, created_at, updated_at, deleted_at
) VALUES
  ('asset-live', '${'L'.repeat(24)}', 'fixture/live.png', 'live.png', 'image/png', 68, NULL, NULL, 'sha-live', 'public', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-about', '${'M'.repeat(24)}', 'fixture/about.png', 'about.png', 'image/png', 68, NULL, NULL, 'sha-about', 'public', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-draft-inline', '${'N'.repeat(24)}', 'fixture/draft-inline.png', 'draft-inline.png', 'image/png', 68, NULL, NULL, 'sha-draft-inline', 'draft', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-draft-cover', '${'O'.repeat(24)}', 'fixture/draft-cover.png', 'draft-cover.png', 'image/png', 68, NULL, NULL, 'sha-draft-cover', 'draft', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-archived-inline', '${'P'.repeat(24)}', 'fixture/archived-inline.png', 'archived-inline.png', 'image/png', 68, NULL, NULL, 'sha-archived-inline', 'public', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-private-inline', '${'Q'.repeat(24)}', 'fixture/private-inline.png', 'private-inline.png', 'image/png', 68, NULL, NULL, 'sha-private-inline', 'private', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-shared', '${'R'.repeat(24)}', 'fixture/shared.png', 'shared.png', 'image/png', 68, NULL, NULL, 'sha-shared', 'public', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL),
  ('asset-temp', '${'S'.repeat(24)}', 'fixture/temp.png', 'temp.png', 'image/png', 68, NULL, NULL, 'sha-temp', 'draft', 0, 'fixture-user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL);

INSERT INTO posts (
  id, slug, title, excerpt, content_markdown, content_html, cover_asset_id, status, visibility,
  seo_title, seo_description, reading_time_minutes, word_count, published_at, pinned_at, created_at, updated_at
) VALUES
  ('p-live', 'live', 'Live', NULL, 'Published body', NULL, NULL, 'published', 'public', NULL, NULL, 1, 2, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('p-about', 'about', 'About', NULL, 'About body', NULL, NULL, 'published', 'public', NULL, NULL, 1, 2, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('p-draft', 'draft', 'Draft', NULL, 'Draft body', NULL, 'asset-draft-cover', 'draft', 'public', NULL, NULL, 1, 2, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('p-archived', 'archived', 'Archived', NULL, 'Archived body', NULL, NULL, 'archived', 'public', NULL, NULL, 1, 2, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
  ('p-private', 'private', 'Private', NULL, 'Private body', NULL, NULL, 'published', 'private', NULL, NULL, 1, 2, '2026-01-01T00:00:00.000Z', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO post_tags (post_id, tag_id) VALUES
  ('p-live', 'tag-fixture'),
  ('p-about', 'tag-fixture'),
  ('p-draft', 'tag-fixture'),
  ('p-archived', 'tag-fixture'),
  ('p-private', 'tag-fixture');

INSERT INTO post_assets (post_id, asset_id, role, created_at) VALUES
  ('p-live', 'asset-live', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-live', 'asset-shared', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-about', 'asset-about', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-draft', 'asset-draft-inline', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-archived', 'asset-archived-inline', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-archived', 'asset-shared', 'inline', '2026-01-01T00:00:00.000Z'),
  ('p-private', 'asset-private-inline', 'inline', '2026-01-01T00:00:00.000Z');

INSERT INTO post_view_counts (post_id, count, updated_at) VALUES
  ('p-live', 10, '2026-01-01T00:00:00.000Z'),
  ('p-about', 2, '2026-01-01T00:00:00.000Z'),
  ('p-draft', 1, '2026-01-01T00:00:00.000Z'),
  ('p-archived', 1, '2026-01-01T00:00:00.000Z'),
  ('p-private', 1, '2026-01-01T00:00:00.000Z');
`
  );
}

async function waitForServer(child, output) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Wrangler dev exited before startup.\n${output.join('')}`);
    }

    try {
      const response = await fetch(`${testOrigin}/?fresh=1`, {
        signal: AbortSignal.timeout(5_000)
      });

      if (response.status === 200) {
        return;
      }
    } catch {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Wrangler dev did not become ready.\n${output.join('')}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000))
  ]);

  if (child.exitCode === null && process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true
    });
  }

  child.stdout.destroy();
  child.stderr.destroy();
}

async function request(pathname, init = {}) {
  return fetch(`${testOrigin}${pathname}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000)
  });
}

async function login() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: testOrigin
    },
    body: JSON.stringify({
      username: 'smoke-admin',
      password: 'smoke-password'
    })
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie);
  return setCookie.split(';', 1)[0];
}

async function inspectAndImport(file, cookie, media) {
  const inspectForm = new FormData();
  inspectForm.append('file', file);
  const inspectResponse = await request('/api/admin/data-portability/inspect', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: testOrigin
    },
    body: inspectForm
  });
  assert.equal(inspectResponse.status, 200);
  const inspectPayload = await inspectResponse.json();
  const importPlanToken = inspectPayload.data.inspect.importPlanToken;
  assert.ok(importPlanToken);

  const importForm = new FormData();
  importForm.append('file', file);
  importForm.append(
    'options',
    JSON.stringify({
      importPlanToken,
      sections: {
        articles: true,
        media,
        friends: false
      },
      articleConflictStrategy: 'skip',
      friendConflictStrategy: 'skip'
    })
  );
  const importResponse = await request('/api/admin/data-portability/import', {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: testOrigin
    },
    body: importForm
  });
  assert.equal(importResponse.status, 200);
}

async function runHttpSmoke(persistPath, { testZip }) {
  const output = [];
  const child = spawn(
    process.execPath,
    [
      wranglerCli,
      'dev',
      '--local',
      '--config',
      path.join(repoRoot, 'dist', 'server', 'wrangler.json'),
      '--persist-to',
      persistPath,
      '--ip',
      '127.0.0.1',
      '--port',
      String(testPort),
      '--inspector-port',
      String(testPort + 1000),
      '--show-interactive-dev-session=false',
      '--log-level',
      'error',
      '--var',
      'ADMIN_USERNAME:smoke-admin',
      '--var',
      'ADMIN_PASSWORD:smoke-password',
      '--var',
      `SITE_URL:${testOrigin}`
    ],
    {
      cwd: repoRoot,
      env: wranglerEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  );
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    await waitForServer(child, output);

    console.log('  HTTP: public pages and login page');
    for (const pathname of ['/?fresh=1', '/about?fresh=1', '/posts/live?fresh=1', '/admin/login']) {
      const response = await request(pathname);
      assert.equal(response.status, 200, `${pathname} should return 200.`);
    }

    console.log('  HTTP: admin login and data page');
    const cookie = await login();
    const dataPage = await request('/settings/data', {
      headers: { Cookie: cookie }
    });
    assert.equal(dataPage.status, 200);
    const dataPageHtml = await dataPage.text();
    assert.match(dataPageHtml, /博客数据/);
    assert.match(dataPageHtml, /当前站点可导出内容/);

    console.log('  HTTP: summary, JSON export, inspect, and import');
    const summaryResponse = await request('/api/admin/data-portability/summary', {
      headers: { Cookie: cookie }
    });
    assert.equal(summaryResponse.status, 200);

    const jsonExport = await request('/api/admin/data-portability/export', {
      method: 'POST',
      headers: {
        Cookie: cookie,
        Origin: testOrigin,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ articles: true, media: false, friends: false })
    });
    assert.equal(jsonExport.status, 200);
    assert.match(jsonExport.headers.get('content-type') ?? '', /application\/json/);
    const jsonFile = new File([await jsonExport.arrayBuffer()], 'smoke.json', {
      type: 'application/json'
    });
    await inspectAndImport(jsonFile, cookie, false);

    if (testZip) {
      console.log('  HTTP: media upload, article create, ZIP export, inspect, and import');
      const pngBytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
        0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99,
        0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
        0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
      ]);
      const uploadForm = new FormData();
      uploadForm.append('file', new File([pngBytes], 'smoke.png', { type: 'image/png' }));
      const uploadResponse = await request('/api/admin/assets/upload', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: testOrigin
        },
        body: uploadForm
      });
      assert.equal(uploadResponse.status, 201);
      const uploadPayload = await uploadResponse.json();
      const token = uploadPayload.data.asset.token;

      const createResponse = await request('/api/admin/posts', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: testOrigin,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: 'Wrangler ZIP smoke',
          excerpt: '',
          contentMarkdown: `![smoke](asset:${token})`,
          status: 'published',
          visibility: 'public',
          tags: ''
        })
      });
      assert.equal(createResponse.status, 201);

      const zipExport = await request('/api/admin/data-portability/export', {
        method: 'POST',
        headers: {
          Cookie: cookie,
          Origin: testOrigin,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ articles: true, media: true, friends: false })
      });
      assert.equal(zipExport.status, 200);
      assert.match(zipExport.headers.get('content-type') ?? '', /application\/zip/);
      const zipFile = new File([await zipExport.arrayBuffer()], 'smoke.zip', {
        type: 'application/zip'
      });
      await inspectAndImport(zipFile, cookie, true);
    }

    assert.doesNotMatch(output.join(''), /BEGIN TRANSACTION|SAVEPOINT statements/i);
  } finally {
    await stopServer(child);
  }
}

console.log('Wrangler D1 path A: applying 0001 through 0010 to an empty local database.');
runWrangler(migrationArgs(path.join(repoRoot, 'wrangler.jsonc'), fullPersistPath));
{
  const db = openPersistedD1(fullPersistPath);
  assertDatabaseHealthy(db);
  assertPublishedOnlySchema(db);
  assert.equal(db.prepare('SELECT version FROM sakura_schema_state WHERE id = 1').get().version, 10);
  db.close();
}

console.log('Wrangler D1 path B: creating and seeding a local 0009 database.');
createV9MigrationFixture();
runWrangler(migrationArgs(v9ConfigPath, upgradePersistPath));
executeFile(v9ConfigPath, upgradePersistPath, seedPath);
let beforeHttp;
{
  const db = openPersistedD1(upgradePersistPath);
  assertDatabaseHealthy(db);
  beforeHttp = lifecycleSnapshot(db);
  assert.equal(beforeHttp.version, 9);
  db.close();
}

console.log('Wrangler HTTP path B: serving the 0009 database without runtime migration.');
await runHttpSmoke(upgradePersistPath, { testZip: false });
{
  const db = openPersistedD1(upgradePersistPath);
  assertDatabaseHealthy(db);
  assert.deepEqual(lifecycleSnapshot(db), beforeHttp);
  db.close();
}

copyFileSync(
  path.join(repoRoot, 'migrations', '0010_simplify_post_status.sql'),
  path.join(v9MigrationsPath, '0010_simplify_post_status.sql')
);
console.log('Wrangler D1 path B: explicitly applying 0010.');
runWrangler(migrationArgs(v9ConfigPath, upgradePersistPath));

{
  const db = openPersistedD1(upgradePersistPath);
  assertDatabaseHealthy(db);
  assertPublishedOnlySchema(db);
  assert.equal(db.prepare('SELECT version FROM sakura_schema_state WHERE id = 1').get().version, 10);
  assert.deepEqual(
    plain(db.prepare('SELECT id FROM posts ORDER BY id').all()),
    [{ id: 'p-about' }, { id: 'p-live' }]
  );
  assert.deepEqual(
    plain(db.prepare('SELECT post_id, asset_id FROM post_assets ORDER BY post_id, asset_id').all()),
    [
      { post_id: 'p-about', asset_id: 'asset-about' },
      { post_id: 'p-live', asset_id: 'asset-live' },
      { post_id: 'p-live', asset_id: 'asset-shared' }
    ]
  );
  assert.deepEqual(
    plain(db.prepare('SELECT post_id FROM post_tags ORDER BY post_id').all()),
    [{ post_id: 'p-about' }, { post_id: 'p-live' }]
  );
  assert.deepEqual(
    plain(db.prepare('SELECT post_id, count FROM post_view_counts ORDER BY post_id').all()),
    [{ post_id: 'p-about', count: 2 }, { post_id: 'p-live', count: 10 }]
  );
  assert.deepEqual(
    plain(db.prepare('SELECT asset_id FROM historical_post_asset_cleanup_candidates ORDER BY asset_id').all()),
    [
      { asset_id: 'asset-archived-inline' },
      { asset_id: 'asset-draft-cover' },
      { asset_id: 'asset-draft-inline' },
      { asset_id: 'asset-private-inline' },
      { asset_id: 'asset-shared' }
    ]
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM assets WHERE id = 'asset-shared'").get().count,
    1
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM assets WHERE id = 'asset-temp'").get().count,
    1
  );
  db.close();
}

writeFileSync(
  postMigrationHttpSetupPath,
  "DELETE FROM post_assets WHERE post_id IN ('p-live', 'p-about');\n"
);
executeFile(v9ConfigPath, upgradePersistPath, postMigrationHttpSetupPath);

console.log('Wrangler HTTP path B: serving the migrated 0010 database.');
await runHttpSmoke(upgradePersistPath, { testZip: true });

console.log('Wrangler local D1 migration and HTTP checks passed.');
