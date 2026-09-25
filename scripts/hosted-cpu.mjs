import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Read-only telemetry query: never emits credentials, request bodies, headers or raw logs.
// API reference: https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
function credential() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const candidates = [
    join(homedir(), ".wrangler/config/default.toml"),
    join(
      process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
      ".wrangler/config/default.toml",
    ),
    join(homedir(), "Library/Preferences/.wrangler/config/default.toml"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const match = text.match(/^oauth_token\s*=\s*("(?:[^"\\]|\\.)*")\s*$/m);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error(
    "No supported local Wrangler OAuth token found. Sign in with Wrangler or provide an environment-only API token.",
  );
}
export function buildTelemetryQuery(worker, from, to) {
  return {
    queryId: `barterbook-cpu-${Date.now()}`,
    timeframe: { from, to },
    dry: true,
    view: "events",
    limit: 2000,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "or",
      // Worker identity stays narrow across documented and legacy layouts.
      // CPU existence is checked locally: a wrong field filter must not hide all logs.
      filters: [
        "$metadata.service",
        "$workers.scriptName",
        "$cloudflare.$metadata.service",
        "$cloudflare.$workers.scriptName",
        "$cloudflare.scriptName",
      ].map((key) => ({ key, operation: "eq", type: "string", value: worker })),
    },
  };
}
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function normalizedPath(request, metadata) {
  let path = request.path;
  if (typeof path !== "string" && (request.url || metadata.url)) {
    try {
      path = new URL(request.url || metadata.url).pathname;
    } catch {}
  }
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//")
  )
    return "unattributed";
  path = path.split(/[?#]/, 1)[0];
  if (
    /^\/(?:api\/(?:health|demo|assets(?:\/fresh)?|holdings|matches(?:\/room)?|listings|offers|rooms|history|auth\/(?:challenge|verify|me|logout))|favicon\.ico)?$/.test(
      path,
    )
  )
    return path;
  const route = path.match(
    /^\/api\/(rooms|attempts|offers|listings|receipts)\/[^/]+(?:\/(accept|ready|renew|attempts|signatures|submit|reconcile|rebroadcast|stop|counter|reject|withdraw|evidence))?$/,
  );
  if (route) return `/api/${route[1]}/:id${route[2] ? `/${route[2]}` : ""}`;
  if (path.startsWith("/assets/")) return "/assets/:asset";
  return "unattributed";
}
function fieldNames(event) {
  const keys = [];
  const add = (value, prefix) => {
    for (const key of Object.keys(object(value)))
      if (/^[$A-Za-z_][$A-Za-z0-9_.]{0,79}$/.test(key)) keys.push(prefix + key);
  };
  add(event, "");
  for (const prefix of ["$metadata", "$workers", "$cloudflare"])
    add(event[prefix], `${prefix}.`);
  const nested = object(event.$cloudflare);
  for (const prefix of ["$metadata", "$workers"])
    add(nested[prefix], `$cloudflare.${prefix}.`);
  return keys;
}
export function parseCpuEvents(rawEvents, worker) {
  const rows = [],
    seen = new Set(),
    fields = new Set();
  const skipped = {
    noWorkerMetrics: 0,
    wrongWorker: 0,
    missingCpu: 0,
    missingIdentity: 0,
    duplicate: 0,
  };
  for (const item of rawEvents) {
    const event = object(item),
      nested = object(event.$cloudflare);
    const candidates = [
      [object(event.$workers), object(event.$metadata)],
      [object(nested.$workers), object(nested.$metadata || event.$metadata)],
      [nested, object(nested.$metadata || event.$metadata)],
    ];
    const candidate =
      candidates.find(
        ([w]) =>
          w.scriptName === worker &&
          Number.isFinite(w.cpuTimeMs) &&
          w.cpuTimeMs >= 0,
      ) || candidates.find(([w]) => w.scriptName === worker);
    if (!candidate) {
      skipped[
        candidates.some(([w]) => w.scriptName)
          ? "wrongWorker"
          : "noWorkerMetrics"
      ]++;
      for (const key of fieldNames(event)) fields.add(key);
      continue;
    }
    const [w, meta] = candidate;
    if (meta.service && meta.service !== worker) {
      skipped.wrongWorker++;
      continue;
    }
    if (!Number.isFinite(w.cpuTimeMs) || w.cpuTimeMs < 0) {
      skipped.missingCpu++;
      for (const key of fieldNames(event)) fields.add(key);
      continue;
    }
    const id = w.requestId || meta.requestId || meta.id;
    if (typeof id !== "string" || !id) {
      skipped.missingIdentity++;
      continue;
    }
    if (seen.has(id)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(id);
    const req = object(w.event?.request);
    const timestamp =
      Number.isFinite(event.timestamp) &&
      event.timestamp >= 0 &&
      event.timestamp <= 8.64e15
        ? new Date(event.timestamp).toISOString()
        : null;
    const outcome = new Set([
      "ok",
      "exception",
      "exceededCpu",
      "exceededMemory",
      "canceled",
      "unknown",
      "exceededWallTime",
      "scriptNotFound",
      "responseStreamDisconnected",
    ]);
    rows.push({
      timestamp,
      path: normalizedPath(req, meta),
      method: [
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
        "HEAD",
      ].includes(req.method)
        ? req.method
        : null,
      status: Number.isInteger(w.event?.response?.status)
        ? w.event.response.status
        : Number.isInteger(meta.statusCode)
          ? meta.statusCode
          : null,
      cpuTimeMs: w.cpuTimeMs,
      wallTimeMs:
        Number.isFinite(w.wallTimeMs) && w.wallTimeMs >= 0
          ? w.wallTimeMs
          : null,
      outcome: outcome.has(w.outcome) ? w.outcome : "unknown",
      versionId: /^[a-f0-9-]{36}$/i.test(w.scriptVersion?.id || "")
        ? w.scriptVersion.id
        : null,
    });
  }
  return {
    rows,
    diagnostics: { skipped, fieldNames: [...fields].sort().slice(0, 100) },
  };
}
export function summarizeCpuRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.method || "?"} ${row.path}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups].map(([route, records]) => {
    const sorted = records.map((r) => r.cpuTimeMs).sort((a, b) => a - b);
    const p = (q) => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
    return {
      route,
      samples: records.length,
      cpuP50Ms: p(0.5),
      cpuP95Ms: p(0.95),
      cpuP99Ms: p(0.99),
      cpuMaxMs: sorted.at(-1),
      observedAbove10Ms: sorted.filter((n) => n > 10).length,
      nonOkOutcomes: records.filter((r) => r.outcome !== "ok").length,
    };
  });
}
export async function main() {
  const [
    accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
    worker = "barterbook-devnet",
    fromArg,
    toArg,
  ] = process.argv.slice(2);
  if (
    !/^[a-f0-9]{32}$/i.test(accountId || "") ||
    !/^[a-z0-9_-]{1,63}$/i.test(worker)
  ) {
    throw new Error(
      "Usage: node scripts/hosted-cpu.mjs ACCOUNT_ID WORKER [FROM_ISO TO_ISO]",
    );
  }
  const to = toArg ? Date.parse(toArg) : Date.now();
  const from = fromArg ? Date.parse(fromArg) : to - 30 * 60_000;
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to - from > 2 * 60 * 60_000
  ) {
    throw new Error("Use an increasing time window no longer than two hours");
  }
  const body = buildTelemetryQuery(worker, from, to);
  let response;
  try {
    response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new Error(
      "Telemetry request could not complete; no CPU evidence recorded. Check network or local Wrangler authentication.",
    );
  }
  if (!response.ok)
    throw new Error(
      `Telemetry query returned HTTP ${response.status}; no CPU evidence recorded. This endpoint requires Workers Observability Write permission. Use dashboard Query Builder if OAuth lacks it.`,
    );
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Telemetry response was not JSON; no evidence recorded");
  }
  if (data.success === false || data.errors?.length)
    throw new Error(
      "Telemetry API rejected this query; no CPU evidence recorded. Inspect the same fields in dashboard Query Builder.",
    );
  const rawEvents = data.result?.events?.events;
  if (!Array.isArray(rawEvents))
    throw new Error(
      "Telemetry event shape was unavailable; no CPU evidence recorded",
    );
  const { rows, diagnostics } = parseCpuEvents(rawEvents, worker);
  const summaries = summarizeCpuRows(rows);
  const evidence = {
    executedAt: new Date().toISOString(),
    environment: "HOSTED_CLOUDFLARE_TELEMETRY",
    worker,
    timeWindow: {
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    },
    scope:
      "Cloudflare invocation CPU in milliseconds, grouped from returned events. Not wall-clock request timing.",
    source:
      "https://developers.cloudflare.com/workers/observability/query-builder/",
    returnedEvents: rawEvents.length,
    providerMatchingCount: data.result.events.count ?? null,
    truncatedOrAtLimit:
      rawEvents.length >= 2000 ||
      (Number.isFinite(data.result.events.count) &&
        data.result.events.count > rawEvents.length),
    samples: rows.length,
    summaries,
    rows,
    diagnostics,
    limitations: [
      "Log retention, sampling and ingestion delay can omit requests.",
      "Empty data, unknown paths, an unexercised path or only rejected/unauthenticated requests do not establish full-path headroom.",
      "This script does not generate traffic, broadcast transactions, enable settlement or certify the plan tier.",
      "Review actual auth/prepare/signature/submit/reconcile paths and version IDs alongside the exercise record.",
    ],
  };
  mkdirSync("evidence/hosted", { recursive: true });
  const output = `evidence/hosted/cpu-${new Date().toISOString().replaceAll(":", "-")}.json`;
  writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    JSON.stringify({
      output,
      samples: rows.length,
      summaries,
      diagnostics,
      actualCpuEvidenceAvailable: rows.length > 0,
    }),
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
