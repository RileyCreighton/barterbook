import { afterEach, describe, expect, it, vi } from "vitest";
import { Rpc } from "../src/server/chain";
import { testDatabase } from "./db-fixture";

const databases: ReturnType<typeof testDatabase>[] = [];
const now = 1_800_000_000_000;
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  const db = testDatabase();
  databases.push(db);
  const sent: Array<{ at: number; method: string; host: string }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({
      at: Date.now(),
      method: JSON.parse(init.body as string).method,
      host: new URL(url).host,
    });
    return Response.json({ jsonrpc: "2.0", id: 1, result: "ok" });
  });
  vi.stubGlobal("fetch", fetch);
  return { db, sent, fetch };
}
async function nextAt(db: D1Database, provider = "provider.test:read") {
  return db
    .prepare("SELECT next_at FROM rpc_slots WHERE provider=?")
    .bind(provider)
    .first<number>("next_at");
}

describe("global RPC pacing reservations", () => {
  it("reserves a first provider slot with one D1 statement and sends immediately", async () => {
    const { db, sent } = setup();
    const prepare = vi.spyOn(db, "prepare");
    await expect(
      new Rpc("https://provider.test/rpc", db).call("getBlockHeight"),
    ).resolves.toBe("ok");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      { at: now, method: "getBlockHeight", host: "provider.test" },
    ]);
    expect(await nextAt(db)).toBe(now + 125);
  });

  it("starts an idle existing provider at the current time instead of the stale slot", async () => {
    const { db, sent } = setup();
    await db
      .prepare("INSERT INTO rpc_slots(provider,next_at) VALUES(?,?)")
      .bind("provider.test:read", now - 5000)
      .run();
    const prepare = vi.spyOn(db, "prepare");
    await new Rpc("https://provider.test/rpc", db).call("getBlockHeight");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sent.map((entry) => entry.at)).toEqual([now]);
    expect(await nextAt(db)).toBe(now + 125);
  });

  it("waits for an existing future slot and retains its spacing with one D1 statement", async () => {
    const { db, sent } = setup();
    await db
      .prepare("INSERT INTO rpc_slots(provider,next_at) VALUES(?,?)")
      .bind("provider.test:read", now + 375)
      .run();
    const prepare = vi.spyOn(db, "prepare");
    const pending = new Rpc("https://provider.test/rpc", db).call(
      "getBlockHeight",
    );
    await vi.advanceTimersByTimeAsync(374);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    expect(await nextAt(db)).toBe(now + 500);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("ok");
    expect(sent.map((entry) => entry.at)).toEqual([now + 375]);
  });

  it("serializes concurrent callers across RPC instances and rejects excess backlog without reserving or sending", async () => {
    const { db, sent } = setup();
    const first = new Rpc("https://provider.test/one?credential=a", db),
      second = new Rpc("https://provider.test/two?credential=b", db);
    const prepare = vi.spyOn(db, "prepare");
    const pending = Promise.allSettled(
      Array.from({ length: 19 }, (_, i) =>
        (i % 2 ? first : second).call("getSignatureStatuses"),
      ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(19);
    // The existing admission boundary includes a reservation exactly 2s ahead.
    expect(await nextAt(db)).toBe(now + 2125);
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    const results = await pending;
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(17);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const result of rejected)
      expect((result as PromiseRejectedResult).reason.message).toMatch(
        /request budget is busy/,
      );
    expect(sent.map((entry) => entry.at)).toEqual(
      Array.from({ length: 17 }, (_, i) => now + i * 125),
    );
    expect(await nextAt(db)).toBe(now + 2125);
  });

  it("keeps send and read budgets separate while sharing each method budget by host", async () => {
    const { db, sent } = setup();
    const rpc = new Rpc("https://provider.test/rpc", db),
      other = new Rpc("https://other.test/rpc", db);
    const prepare = vi.spyOn(db, "prepare");
    const pending = Promise.all([
      rpc.call("sendTransaction"),
      rpc.call("getBlockHeight"),
      rpc.call("sendTransaction"),
      rpc.call("getTransaction"),
      other.call("getBlockHeight"),
    ]);
    await vi.advanceTimersByTimeAsync(0);
    expect(prepare).toHaveBeenCalledTimes(5);
    expect(sent).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1100);
    await pending;
    expect(
      sent
        .filter((entry) => entry.method === "sendTransaction")
        .map((entry) => entry.at),
    ).toEqual([now, now + 1100]);
    expect(
      sent
        .filter(
          (entry) =>
            entry.host === "provider.test" &&
            entry.method !== "sendTransaction",
        )
        .map((entry) => entry.at),
    ).toEqual([now, now + 125]);
    expect(await nextAt(db, "provider.test:send")).toBe(now + 2200);
    expect(await nextAt(db)).toBe(now + 250);
    expect(await nextAt(db, "other.test:read")).toBe(now + 125);
  });
});
