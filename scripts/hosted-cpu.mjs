import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Read-only telemetry query: never emits credentials, request bodies, headers or raw logs.
// API reference: https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
const [accountId = process.env.CLOUDFLARE_ACCOUNT_ID, worker = 'barterbook-devnet', fromArg, toArg] = process.argv.slice(2);
if (!/^[a-f0-9]{32}$/i.test(accountId || '') || !/^[a-z0-9_-]{1,63}$/i.test(worker)) {
  throw new Error('Usage: node scripts/hosted-cpu.mjs ACCOUNT_ID WORKER [FROM_ISO TO_ISO]');
}
const to = toArg ? Date.parse(toArg) : Date.now();
const from = fromArg ? Date.parse(fromArg) : to - 30 * 60_000;
if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 2 * 60 * 60_000) {
  throw new Error('Use an increasing time window no longer than two hours');
}
function credential() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), '.wrangler/config/default.toml'),
    join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), '.wrangler/config/default.toml'),
    join(homedir(), 'Library/Preferences/.wrangler/config/default.toml'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const match = text.match(/^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error('No supported local Wrangler OAuth token found. Sign in with Wrangler or provide an environment-only API token.');
}
const body = {
  queryId: `barterbook-cpu-${Date.now()}`,
  timeframe: { from, to },
  dry: true,
  view: 'events',
  limit: 2000,
  parameters: {
    datasets: ['cloudflare-workers'],
    filterCombination: 'and',
    filters: [
      { key: '$metadata.service', operation: 'eq', type: 'string', value: worker },
      { key: '$workers.cpuTimeMs', operation: 'exists', type: 'number' },
    ],
  },
};
let response;
try {
  response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
} catch {
  throw new Error('Telemetry request could not complete; no CPU evidence recorded. Check network or local Wrangler authentication.');
}
if (!response.ok) throw new Error(`Telemetry query returned HTTP ${response.status}; no CPU evidence recorded. This endpoint requires Workers Observability Write permission. Use dashboard Query Builder if OAuth lacks it.`);
let data;
try { data = await response.json(); } catch { throw new Error('Telemetry response was not JSON; no evidence recorded'); }
if (data.success === false || data.errors?.length) throw new Error('Telemetry API rejected this query; no CPU evidence recorded. Inspect the same fields in dashboard Query Builder.');
const rawEvents = data.result?.events?.events;
if (!Array.isArray(rawEvents)) throw new Error('Telemetry event shape was unavailable; no CPU evidence recorded');
const rows = [];
const seen = new Set();
for (const event of rawEvents) {
  const w = event.$workers;
  const meta = event.$metadata || {};
  if (!w || w.scriptName !== worker || !Number.isFinite(w.cpuTimeMs) || w.cpuTimeMs < 0) continue;
  const id = w.requestId || meta.requestId || meta.id;
  if (!id || seen.has(id)) continue;
  seen.add(id);
  const req = w.event?.request || {};
  let path = req.path;
  if (!path && (req.url || meta.url)) { try { path = new URL(req.url || meta.url).pathname; } catch {} }
  if (typeof path !== 'string' || !path.startsWith('/')) path = 'unattributed';
  else path = path.split('?')[0].split('/').map((part) => part.length > 28 ? ':id' : part).join('/').slice(0,180);
  rows.push({
    timestamp: Number.isFinite(event.timestamp) ? new Date(event.timestamp).toISOString() : null,
    path,
    method: /^[A-Z]{3,10}$/.test(req.method || '') ? req.method : null,
    status: Number.isInteger(w.event?.response?.status) ? w.event.response.status : (Number.isInteger(meta.statusCode) ? meta.statusCode : null),
    cpuTimeMs: w.cpuTimeMs,
    wallTimeMs: Number.isFinite(w.wallTimeMs) ? w.wallTimeMs : null,
    outcome: /^[a-zA-Z_ -]{1,50}$/.test(w.outcome || '') ? w.outcome : null,
    versionId: /^[a-f0-9-]{36}$/i.test(w.scriptVersion?.id || '') ? w.scriptVersion.id : null,
  });
}
const groups = new Map();
for (const row of rows) { const key = `${row.method || '?'} ${row.path}`; const group = groups.get(key) || []; group.push(row); groups.set(key, group); }
const summaries = [...groups].map(([route, records]) => {
  const sorted = records.map((r) => r.cpuTimeMs).sort((a,b) => a-b);
  const p = (q) => sorted[Math.max(0,Math.ceil(sorted.length*q)-1)];
  return { route, samples: records.length, cpuP50Ms: p(.5), cpuP95Ms: p(.95), cpuP99Ms: p(.99), cpuMaxMs: sorted.at(-1), observedAbove10Ms: sorted.filter((n) => n>10).length, nonOkOutcomes: records.filter((r) => r.outcome !== 'ok').length };
});
const evidence = {
  executedAt: new Date().toISOString(), environment: 'HOSTED_CLOUDFLARE_TELEMETRY', worker,
  timeWindow: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
  scope: 'Cloudflare invocation CPU in milliseconds, grouped from returned events. Not wall-clock request timing.',
  source: 'https://developers.cloudflare.com/workers/observability/query-builder/',
  returnedEvents: rawEvents.length, providerMatchingCount: data.result.events.count ?? null,
  truncatedOrAtLimit: rawEvents.length >= 2000 || (Number.isFinite(data.result.events.count) && data.result.events.count > rawEvents.length),
  samples: rows.length, summaries, rows,
  limitations: ['Log retention, sampling and ingestion delay can omit requests.', 'Empty data, unknown paths, an unexercised path or only rejected/unauthenticated requests do not establish full-path headroom.', 'This script does not generate traffic, broadcast transactions, enable settlement or certify the plan tier.', 'Review actual auth/prepare/signature/submit/reconcile paths and version IDs alongside the exercise record.'],
};
mkdirSync('evidence/hosted', { recursive: true });
const output = `evidence/hosted/cpu-${new Date().toISOString().replaceAll(':','-')}.json`;
writeFileSync(output, `${JSON.stringify(evidence,null,2)}\n`);
console.log(JSON.stringify({ output, samples: rows.length, summaries, actualCpuEvidenceAvailable: rows.length > 0 }));
