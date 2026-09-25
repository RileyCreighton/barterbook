# Measure actual hosted request CPU

Local Node or workerd profiles do not prove the Free Worker budget. Cloudflare reports invocation CPU separately from wall time; RPC/D1 waiting is excluded. The target is 10 ms CPU for a Free HTTP invocation. Do not infer the account's billing plan from `default_usage_model` alone.

Record the deployed version and a narrow UTC test window. Exercise representative authenticated API paths with authorized fixtures: login verification, asset/inventory reads, preparation, each partial-signature merge, submission and reconciliation. Static pages or rejected unauthenticated calls alone do not test these paths. Complete the first checks with settlement disabled where possible; enable only the authorized devnet rehearsal after fixture compatibility and core-path checks, then measure the real settlement paths too.

Use the [official Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/): Workers & Pages → selected Worker → Observability → Overview. Select the test interval, filter to that Worker and invocation events, visualize count, max and percentiles of `$workers.cpuTimeMs`, and group by `$workers.event.request.path` and response status. Inspect outcomes as well as averages. Include CPU-limit failures; tiny samples do not establish a reliable tail percentile.

The read-only collector uses the documented temporary [telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/):

```sh
node scripts/hosted-cpu.mjs ACTUAL_ACCOUNT_ID barterbook-devnet FROM_ISO_UTC TO_ISO_UTC
```

It reads the local Wrangler OAuth token internally (or an environment-only `CLOUDFLARE_API_TOKEN`), sends a `dry` query, and saves only sanitized CPU/path/status rows under `evidence/hosted/`. It never prints credentials, headers, log bodies or complete URLs. It generates no app traffic and broadcasts nothing. It checks at most two hours and 2,000 records; truncation is explicitly flagged. No data is a pending measurement, not a pass.

For an explicitly scoped token already saved as `CLOUDFLARE_API_TOKEN` in ignored `.env.cloudflare-cpu.local`, use Node's native environment-file loader. This command works in both Fish and Bash and keeps the token out of shell arguments:

```sh
node --env-file=.env.cloudflare-cpu.local scripts/hosted-cpu.mjs ACTUAL_ACCOUNT_ID barterbook-devnet FROM_ISO_UTC TO_ISO_UTC
```

The current [API response schema](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/) exposes `$workers` and `$metadata` on each event. The [Workers Logs guide](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#invocation-logs) also describes invocation metadata under `$cloudflare.$metadata`. The collector accepts these nested and top-level layouts plus legacy direct `$cloudflare` metrics. It queries only the selected Worker, without a CPU-field existence filter that could silently hide a different layout. CPU must still be an actual nonnegative numeric `cpuTimeMs`; missing data is counted, never treated as zero. Unrecognized shapes produce only bounded field-name diagnostics and skip counts. Routes replace all room/attempt/receipt identifiers with `:id`; unrecognized paths remain unattributed.

The endpoint currently requires **Workers Observability Write** permission even for a temporary dry query. Existing Wrangler OAuth may lack it. An HTTP 403 leaves the check pending; use the dashboard or an explicitly scoped token rather than broadening credentials silently. If OAuth expired, sign in again with Wrangler. Do not paste a token into a command argument or chat.

The [GraphQL Workers metrics API](https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) also provides `workersInvocationsAdaptive` CPU quantiles by Worker/time/status, but that aggregation does not identify API paths. This project therefore prefers invocation telemetry for the financial boundary. Log sampling/retention and ingestion delay still limit both approaches. Keep the original test record and observed version IDs with the measurements.
