import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

// Creates only a local, ignored config. No provider credentials enter this file.
const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync('wrangler.jsonc', 'utf8'));
if (parsed.error) throw new Error('Unable to parse wrangler.jsonc');
const config = parsed.config;
const env = process.env;
const databaseId = env.CLOUDFLARE_D1_DATABASE_ID ?? '';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId) || /^0{8}-/.test(databaseId)) {
  throw new Error('Set CLOUDFLARE_D1_DATABASE_ID to the actual devnet D1 database UUID');
}
const origin = new URL(env.APP_ORIGIN ?? '');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.href !== `${origin.origin}/`) {
  throw new Error('APP_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment');
}
const readArray = (key) => {
  const raw = env[key] || '[]';
  if (Buffer.byteLength(raw) > 5000 || !Array.isArray(JSON.parse(raw))) throw new Error(`${key} must be a JSON array below 5 KB`);
  return raw;
};
const bool = (key) => {
  const value = env[key] || 'false';
  if (!['true', 'false'].includes(value)) throw new Error(`${key} must be true or false`);
  return value;
};
const assets = readArray('DEVNET_ASSETS_JSON');
const enabled = bool('SETTLEMENT_ENABLED');
if (enabled === 'true' && JSON.parse(assets).length !== 3) throw new Error('Enabled demo requires the three validated devnet assets');
const siteUrl = env.SITE_URL || origin.origin;
const repositoryUrl = env.REPOSITORY_URL || '';
for (const [name, value] of [['SITE_URL', siteUrl], ['REPOSITORY_URL', repositoryUrl]]) {
  if (value) { const u = new URL(value); if (u.protocol !== 'https:' || u.username || u.password) throw new Error(`${name} must be a public HTTPS URL`); }
}
config.main = resolve(config.main);
config.assets.directory = resolve(config.assets.directory);
config.d1_databases = config.d1_databases.map((db) => ({ ...db, database_id: databaseId, migrations_dir: resolve(db.migrations_dir || 'migrations') }));
config.vars = {
  ...config.vars,
  APP_ORIGIN: origin.origin,
  SOLANA_CLUSTER: 'devnet',
  SETTLEMENT_ENABLED: enabled,
  DEVNET_ASSETS_JSON: assets,
  DEMO_PARTICIPANTS_JSON: readArray('DEMO_PARTICIPANTS_JSON'),
  RPC_HISTORY_TRUSTED: bool('RPC_HISTORY_TRUSTED'),
  FALLBACK_HISTORY_TRUSTED: bool('FALLBACK_HISTORY_TRUSTED'),
  RPC_ADDRESS_HISTORY_TRUSTED: bool('RPC_ADDRESS_HISTORY_TRUSTED'),
  FALLBACK_ADDRESS_HISTORY_TRUSTED: bool('FALLBACK_ADDRESS_HISTORY_TRUSTED'),
  SITE_URL: siteUrl,
  REPOSITORY_URL: repositoryUrl,
  BUILD_ID: env.BUILD_ID || env.GITHUB_SHA || 'local-release',
};
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/deploy.json', `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log('Prepared .wrangler/deploy.json; original local config unchanged; no RPC credentials included.');
