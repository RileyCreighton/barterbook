import { describe, expect, it } from "vitest";
// @ts-expect-error Plain Node CLI intentionally has no TypeScript declaration file.
import * as collector from "../scripts/hosted-cpu.mjs";
const { buildTelemetryQuery, parseCpuEvents, summarizeCpuRows } = collector;

const worker = "barterbook-devnet";
function event(
  layout = "top",
  id = "request-1",
  cpuTimeMs: unknown = 2,
): Record<string, any> {
  const metrics = {
    scriptName: worker,
    requestId: id,
    cpuTimeMs,
    wallTimeMs: 1200,
    outcome: "ok",
    event: {
      request: {
        url: "https://private-host.test/api/attempts/private-id/signatures?secret=query-value",
        method: "POST",
        headers: { authorization: "Bearer private-token" },
        body: "private-body",
      },
      response: { status: 200 },
    },
    scriptVersion: { id: "11111111-2222-3333-4444-555555555555" },
  };
  const metadata = { id: "log-id", service: worker, message: "private-log" };
  return {
    timestamp: 1_800_000_000_000,
    source: "private-raw-source",
    ...(layout === "top"
      ? { $workers: metrics, $metadata: metadata }
      : layout === "nested"
        ? { $cloudflare: { $workers: metrics, $metadata: metadata } }
        : { $cloudflare: { ...metrics, $metadata: metadata } }),
  };
}
describe("private hosted CPU collector", () => {
  it.each(["top", "nested", "legacy"])(
    "reads %s invocation CPU and keeps only the normalized route and metrics",
    (layout) => {
      const result = parseCpuEvents([event(layout)], worker);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        path: "/api/attempts/:id/signatures",
        method: "POST",
        status: 200,
        cpuTimeMs: 2,
        wallTimeMs: 1200,
        outcome: "ok",
        versionId: "11111111-2222-3333-4444-555555555555",
      });
      const output = JSON.stringify(result);
      for (const secret of ["private", "query-value", "request-1", "log-id"])
        expect(output).not.toContain(secret);
    },
  );
  it("narrows the query to the selected Worker without dropping events through a CPU-field existence filter", () => {
    const query = buildTelemetryQuery(worker, 1000, 2000);
    expect(query).toMatchObject({
      timeframe: { from: 1000, to: 2000 },
      dry: true,
      view: "events",
      limit: 2000,
      parameters: { datasets: ["cloudflare-workers"], filterCombination: "or" },
    });
    for (const filter of query.parameters.filters) {
      expect(filter.operation).toBe("eq");
      expect(filter.value).toBe(worker);
      expect(filter.key).not.toMatch(/cpuTime/);
    }
  });
  it("reports only field names and counts for unrecognized or missing CPU shapes", () => {
    const result = parseCpuEvents(
      [
        event("top", "one", "2"),
        {
          source: { secret: "private-source" },
          $cloudflare: { newCpuField: "private-value", event: "private-event" },
        },
      ],
      worker,
    );
    expect(result.rows).toEqual([]);
    expect(result.diagnostics.skipped).toMatchObject({
      missingCpu: 1,
      noWorkerMetrics: 1,
    });
    expect(result.diagnostics.fieldNames).toContain("$cloudflare.newCpuField");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.diagnostics.fieldNames).not.toContain("source.secret");
  });
  it("deduplicates the same invocation across layouts and excludes other Workers", () => {
    const other = event("top", "other");
    other.$workers!.scriptName = "different-worker";
    const result = parseCpuEvents([event(), event("nested"), other], worker);
    expect(result.rows).toHaveLength(1);
    expect(result.diagnostics.skipped).toMatchObject({
      duplicate: 1,
      wrongWorker: 1,
    });
  });
  it("does not expose unrecognized paths, invalid timestamps or arbitrary outcomes", () => {
    const unknown = event();
    unknown.timestamp = 1e30;
    unknown.$workers!.event.request.url =
      "https://private.test/private-short-token";
    unknown.$workers!.outcome = "private-outcome";
    const result = parseCpuEvents([unknown], worker);
    expect(result.rows[0]).toMatchObject({
      path: "unattributed",
      timestamp: null,
      outcome: "unknown",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("retains zero CPU and failed high-CPU invocations in the summary", () => {
    const failed = event("top", "failed", 42);
    failed.$workers!.outcome = "exceededCpu";
    const parsed = parseCpuEvents([event("top", "zero", 0), failed], worker);
    expect(summarizeCpuRows(parsed.rows)).toEqual([
      {
        route: "POST /api/attempts/:id/signatures",
        samples: 2,
        cpuP50Ms: 0,
        cpuP95Ms: 42,
        cpuP99Ms: 42,
        cpuMaxMs: 42,
        observedAbove10Ms: 1,
        nonOkOutcomes: 1,
      },
    ]);
  });
});
