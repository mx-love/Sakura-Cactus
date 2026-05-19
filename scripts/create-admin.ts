import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const PASSWORD_HASH_ALGORITHM = 'pbkdf2_sha256';
const PASSWORD_HASH_ITERATIONS = 210_000;
const PASSWORD_HASH_BYTES = 32;
const TEXT_ENCODER = new TextEncoder();

interface Options {
  database: string;
  username: string | null;
  displayName: string | null;
  password: string | null;
  config: string | null;
  persistTo: string | null;
  local: boolean;
  remote: boolean;
  preview: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    database: 'sakura_blog_prod',
    username: null,
    displayName: null,
    password: process.env.SAKURA_ADMIN_PASSWORD ?? null,
    config: null,
    persistTo: null,
    local: true,
    remote: false,
    preview: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--database' && next) {
      options.database = next;
      i += 1;
    } else if (arg === '--username' && next) {
      options.username = next;
      i += 1;
    } else if (arg === '--display-name' && next) {
      options.displayName = next;
      i += 1;
    } else if (arg === '--password' && next) {
      options.password = next;
      i += 1;
    } else if (arg === '--config' && next) {
      options.config = next;
      i += 1;
    } else if (arg === '--persist-to' && next) {
      options.persistTo = next;
      i += 1;
    } else if (arg === '--remote') {
      options.remote = true;
      options.local = false;
    } else if (arg === '--local') {
      options.local = true;
      options.remote = false;
    } else if (arg === '--preview') {
      options.preview = true;
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Create the first Sakura Cactus administrator.

Usage:
  pnpm admin:create -- --local
  pnpm admin:create -- --remote --username admin --display-name "Admin"

Options:
  --database <name>       D1 database name or binding. Default: sakura_blog_prod
  --username <username>   Admin username. Prompted if omitted.
  --display-name <name>   Optional display name. Prompted if omitted.
  --password <password>   Admin password. Prefer SAKURA_ADMIN_PASSWORD or prompt.
  --config <path>         Optional Wrangler config path.
  --persist-to <path>     Optional Wrangler local persistence directory.
  --local                 Create admin in local D1. Default.
  --remote                Create admin in remote D1.
  --preview               Use Wrangler preview database flag.
`);
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function createRandomId(prefix: string): string {
  return `${prefix}_${bytesToBase64Url(randomBytes(16))}`;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    TEXT_ENCODER.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations: PASSWORD_HASH_ITERATIONS
    },
    keyMaterial,
    PASSWORD_HASH_BYTES * 8
  );

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS.toString(),
    bytesToBase64Url(salt),
    bytesToBase64Url(new Uint8Array(bits))
  ].join('$');
}

function sqlString(value: string | null): string {
  if (value === null) {
    return 'NULL';
  }

  return `'${value.replaceAll("'", "''")}'`;
}

function runWrangler(options: Options, args: string[]): string {
  const globalArgs = options.config ? ['--config', options.config] : [];
  return execFileSync(process.execPath, [
    'node_modules/wrangler/bin/wrangler.js',
    ...globalArgs,
    'd1',
    'execute',
    options.database,
    ...args
  ], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function readJsonFromWrangler(outputValue: string): unknown {
  const jsonStart = outputValue.indexOf('[');

  if (jsonStart < 0) {
    throw new Error(`Wrangler did not return JSON:\n${outputValue}`);
  }

  return JSON.parse(outputValue.slice(jsonStart));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rl = createInterface({ input, output });

  try {
    const username = (options.username ?? (await rl.question('Username: '))).trim();
    const displayNameInput = options.displayName ?? (await rl.question('Display name (optional): '));
    const displayName = displayNameInput.trim() || null;
    const password = options.password ?? (await rl.question('Password: '));

    if (!username) {
      throw new Error('Username is required.');
    }

    if (password.length < 12) {
      throw new Error('Password must be at least 12 characters long.');
    }

    const locationArgs = [
      options.remote ? '--remote' : '--local',
      ...(options.preview ? ['--preview'] : []),
      ...(options.persistTo ? ['--persist-to', options.persistTo] : []),
      '--json'
    ];

    const countOutput = runWrangler(options, [
      ...locationArgs,
      '--command',
      'SELECT COUNT(*) AS count FROM users;'
    ]);
    const countResult = readJsonFromWrangler(countOutput) as Array<{ results?: Array<{ count?: number }> }>;
    const userCount = countResult[0]?.results?.[0]?.count ?? 0;

    if (userCount > 0) {
      throw new Error('At least one user already exists. This script only creates the first administrator.');
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const userId = createRandomId('u');
    const sql = `INSERT INTO users (
      id, username, display_name, password_hash, role, status, created_at, updated_at, last_login_at
    ) VALUES (
      ${sqlString(userId)},
      ${sqlString(username)},
      ${sqlString(displayName)},
      ${sqlString(passwordHash)},
      'admin',
      'active',
      ${sqlString(now)},
      ${sqlString(now)},
      NULL
    );`;

    runWrangler(options, [...locationArgs, '--command', sql]);

    console.log(`Created administrator "${username}" in ${options.remote ? 'remote' : 'local'} D1 database.`);
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Failed to create administrator: ${message}`);
  process.exit(1);
});
