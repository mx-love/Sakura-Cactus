import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const configPath = resolve(process.cwd(), 'wrangler.jsonc');
const d1DatabaseId = process.env.SAKURA_D1_DATABASE_ID?.trim();
const d1DatabaseName = process.env.SAKURA_D1_DATABASE_NAME?.trim() || 'sakura_blog_prod';
const r2BucketName = process.env.SAKURA_R2_BUCKET_NAME?.trim() || 'sakura-blog-media-prod';

if (!d1DatabaseId) {
  console.error('Missing SAKURA_D1_DATABASE_ID. Copy it from Cloudflare D1 database settings.');
  process.exit(1);
}

const rawConfig = await readFile(configPath, 'utf8');
const config = JSON.parse(rawConfig);

config.keep_vars = true;
config.d1_databases = [
  {
    binding: 'DB',
    database_name: d1DatabaseName,
    database_id: d1DatabaseId,
    migrations_dir: './migrations'
  }
];
config.r2_buckets = [
  {
    binding: 'MEDIA_BUCKET',
    bucket_name: r2BucketName
  }
];

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log('Prepared Cloudflare Wrangler config with DB and MEDIA_BUCKET bindings.');
