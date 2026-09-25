import { afterEach, describe, expect, it } from "vitest";
import {
  acquireAttemptLocks,
  createRoom,
  getAttempt,
  getMemberAttempt,
  getRoom,
  releaseAttemptLocks,
  requireRoomMember,
  reviseRoom,
  saveAttempt,
} from "../src/server/db";
import type { Attempt, Room, Terms } from "../src/shared/types";
import { testDatabase } from "./db-fixture";
const databases: ReturnType<typeof testDatabase>[] = [];
function db() {
  const d = testDatabase();
  databases.push(d);
  return d;
}
afterEach(() => {
  for (const d of databases.splice(0)) d.close();
});
function terms(owners = ["Alice", "Bob"]): Terms {
  return {
    cluster: "devnet",
    version: 1,
    mode: "BASKET",
    owners,
    feePayer: owners[0],
    maxNetworkFeeLamports: "10000",
    maxAccountRentLamports: "0",
    legs: [],
    minima: [],
    expiresAt: Date.now() + 300_000,
  };
}
async function ready(database: D1Database, room: Room): Promise<Room> {
  await database
    .prepare(
      "UPDATE room_members SET accepted_version=?,ready=1 WHERE room_id=?",
    )
    .bind(room.terms.version, room.id)
    .run();
  await database
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(room.id)
    .run();
  return (await getRoom(database, room.id))!;
}
function attempt(room: Room): Attempt {
  return {
    id: crypto.randomUUID(),
    roomId: room.id,
    termsHash: room.termsHash,
    plan: {
      terms: room.terms,
      assets: [],
      blockhash: "fixed-blockhash",
      lastValidBlockHeight: "123",
      contextSlot: "100",
      computeUnitLimit: 100_000,
      microLamports: "0",
      createAtas: [],
      networkFeeLamports: "10000",
      accountRentLamports: "0",
    },
    messageBase64: "aW1tdXRhYmxl",
    messageHash: "message-hash",
    wireBase64: "d2lyZQ==",
    fullWireBase64: null,
    txid: null,
    state: "SIGNING",
    signatures: {},
    createdAt: Date.now(),
    submissionStartedAt: null,
    lastCheckedAt: null,
    stopRequested: false,
    safeToRetry: false,
    receipt: null,
    error: null,
  };
}
describe("durable room and attempt constraints", () => {
  it("loads a signed attempt only for its own room's participant", async () => {
    const database = db();
    const room = await ready(
      database,
      await createRoom(database, { terms: terms(), termsHash: "a" }),
    );
    const a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    await createRoom(database, {
      terms: terms(["Carol", "Dave"]),
      termsHash: "b",
    });
    expect(await getMemberAttempt(database, a.id, "Alice")).toEqual(a);
    expect(await getMemberAttempt(database, a.id, "Bob")).toEqual(a);
    expect(await getMemberAttempt(database, a.id, "Carol")).toBeNull();
    expect(await getMemberAttempt(database, a.id, "stranger")).toBeNull();
    expect(await getMemberAttempt(database, "missing", "Alice")).toBeNull();
  });
  it("atomically acquires every owner lock or none when rooms compete", async () => {
    const database = db();
    const a = await ready(
      database,
      await createRoom(database, { terms: terms(), termsHash: "a" }),
    );
    const b = await ready(
      database,
      await createRoom(database, {
        terms: terms(["Carol", "Bob"]),
        termsHash: "b",
      }),
    );
    const aa = attempt(a),
      bb = attempt(b);
    const result = await Promise.allSettled([
      acquireAttemptLocks(database, a, aa),
      acquireAttemptLocks(database, b, bb),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const locks = await database
      .prepare("SELECT lock_key FROM active_locks")
      .all<{ lock_key: string }>();
    expect(locks.results).toHaveLength(2);
    const attempts = await database.prepare("SELECT id FROM attempts").all();
    expect(attempts.results).toHaveLength(1);
    expect((await getRoom(database, b.id))?.attempt).toBeNull();
  });
  it("prevents stale readiness and resets every acceptance on immutable revision", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      );
    const revised = await reviseRoom(
      database,
      room,
      { ...room.terms, version: 2 },
      "v2",
      "Alice",
    );
    expect(
      revised.members.every((m) => !m.ready && m.acceptedVersion === null),
    ).toBe(true);
    await expect(
      database
        .prepare(
          "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=? AND wallet=?",
        )
        .bind(room.id, "Alice")
        .run(),
    ).rejects.toThrow("stale acceptance");
    await expect(
      reviseRoom(
        database,
        room,
        { ...room.terms, version: 2 },
        "another-v2",
        "Bob",
      ),
    ).rejects.toThrow();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
  });
  it("does not let a stale rejection cancel a counteroffer that won the race", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      );
    await reviseRoom(
      database,
      room,
      { ...room.terms, version: 2 },
      "v2",
      "Bob",
    );
    await expect(
      database
        .prepare(
          "INSERT INTO events(id,room_id,kind,detail_json,created_at) VALUES(?,?,?,?,?)",
        )
        .bind(
          "rejection",
          room.id,
          "ROOM_REJECTED",
          JSON.stringify({ version: 1, termsHash: "v1", wallet: "Alice" }),
          Date.now(),
        )
        .run(),
    ).rejects.toThrow("stale rejection");
    expect((await getRoom(database, room.id))?.state).toBe("NEGOTIATING");
  });
  it("requires all participants ready at the atomic preparation boundary", async () => {
    const database = db(),
      room = await createRoom(database, { terms: terms(), termsHash: "v1" });
    await database
      .prepare(
        "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=? AND wallet=?",
      )
      .bind(room.id, "Alice")
      .run();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
    expect(
      (await database.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(0);
  });
  it("never releases frozen attempts through cancellation or allows a revision while unresolved", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      ),
      a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    await expect(releaseAttemptLocks(database, a.id)).rejects.toThrow(
      "reconciled",
    );
    await expect(
      reviseRoom(database, room, { ...room.terms, version: 2 }, "v2", "Bob"),
    ).rejects.toThrow();
    await expect(
      database
        .prepare("UPDATE room_members SET ready=0 WHERE room_id=?")
        .bind(room.id)
        .run(),
    ).rejects.toThrow("already frozen");
    await expect(
      requireRoomMember(database, room.id, "Intruder"),
    ).rejects.toThrow("not found");
    const stopped = { ...a, stopRequested: true };
    await saveAttempt(database, stopped, "SIGNING", a);
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
  });
  it("recognizes the returned CAS row when D1 counts the reflected room trigger as another change", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      ),
      original = attempt(room);
    await acquireAttemptLocks(database, room, original);
    const reflected = await database
      .prepare("UPDATE attempts SET state=state WHERE id=? RETURNING id")
      .bind(original.id)
      .all<{ id: string }>();
    expect(reflected.results).toEqual([{ id: original.id }]);
    expect(reflected.meta.changes).toBe(2); // attempt + reflect_attempt_state room update
    const first = {
      ...original,
      wireBase64: "cGFydGlhbA==",
      txid: "first-payer-signature-id",
      signatures: { Alice: "signature-a" },
    };
    await expect(
      saveAttempt(database, first, "SIGNING", original),
    ).resolves.toBeUndefined();
    expect(await getAttempt(database, original.id)).toEqual(first);
    expect((await getRoom(database, room.id))?.state).toBe("SIGNING");
    await expect(
      saveAttempt(
        database,
        { ...original, signatures: { Bob: "stale-signature-b" } },
        "SIGNING",
        original,
      ),
    ).rejects.toThrow("changed concurrently");
    expect(await getAttempt(database, original.id)).toEqual(first);
    const complete: Attempt = {
      ...first,
      state: "FULLY_SIGNED",
      fullWireBase64: "ZnVsbHktc2lnbmVk",
      signatures: { Alice: "signature-a", Bob: "signature-b" },
    };
    await expect(
      saveAttempt(database, complete, "SIGNING", first),
    ).resolves.toBeUndefined();
    expect((await getRoom(database, room.id))?.state).toBe("FULLY_SIGNED");
    await expect(
      saveAttempt(
        database,
        { ...complete, error: "stale-state" },
        "SIGNING",
        complete,
      ),
    ).rejects.toThrow("changed concurrently");
    expect(await getAttempt(database, original.id)).toEqual(complete);
    await expect(
      saveAttempt(
        database,
        { ...complete, id: "missing-attempt" },
        "FULLY_SIGNED",
        complete,
      ),
    ).rejects.toThrow("changed concurrently");
  });
  it("uses compare-and-swap to prevent concurrent signatures overwriting each other", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      ),
      a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    const first = { ...a, signatures: { Alice: "signature-a" } },
      second = { ...a, signatures: { Bob: "signature-b" } };
    await saveAttempt(database, first, "SIGNING", a);
    await expect(saveAttempt(database, second, "SIGNING", a)).rejects.toThrow(
      "changed concurrently",
    );
    expect((await getAttempt(database, a.id))?.signatures).toEqual({
      Alice: "signature-a",
    });
  });
  it("keeps message/lifetime/fully signed bytes and transaction identity immutable", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      ),
      a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    await expect(
      saveAttempt(database, { ...a, messageBase64: "different" }),
    ).rejects.toThrow("immutable");
    await expect(
      saveAttempt(database, {
        ...a,
        plan: { ...a.plan, blockhash: "replacement" },
      }),
    ).rejects.toThrow("immutable");
    await expect(
      saveAttempt(database, { ...a, state: "SUBMISSION_STARTED" }),
    ).rejects.toThrow();
    const started: Attempt = {
      ...a,
      state: "SUBMISSION_STARTED",
      txid: "locally-derived-id",
      fullWireBase64: "c2lnbmVk",
      submissionStartedAt: Date.now(),
    };
    await saveAttempt(database, started, "SIGNING", a);
    expect(await getAttempt(database, a.id)).toMatchObject({
      state: "SUBMISSION_STARTED",
      txid: "locally-derived-id",
      fullWireBase64: "c2lnbmVk",
    });
    await expect(
      saveAttempt(database, { ...started, fullWireBase64: "changed" }),
    ).rejects.toThrow("immutable");
    await expect(
      saveAttempt(database, { ...started, txid: "new-id" }),
    ).rejects.toThrow("immutable");
    await expect(
      saveAttempt(database, { ...started, submissionStartedAt: null }),
    ).rejects.toThrow();
  });
  it("only releases a reconciled expiry/failure or final success", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      ),
      a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    await expect(
      saveAttempt(database, { ...a, safeToRetry: true }),
    ).rejects.toThrow();
    const expired: Attempt = {
      ...a,
      state: "EXPIRED_UNLANDED",
      safeToRetry: true,
    };
    await saveAttempt(database, expired, "SIGNING", a);
    await releaseAttemptLocks(database, a.id);
    expect(
      (await database.prepare("SELECT lock_key FROM active_locks").all())
        .results,
    ).toHaveLength(0);
    await database
      .prepare("UPDATE rooms SET state='READY' WHERE id=?")
      .bind(room.id)
      .run();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
  });
  it("rejects a rejected or expired room at the database preparation boundary", async () => {
    const database = db(),
      room = await ready(
        database,
        await createRoom(database, { terms: terms(), termsHash: "v1" }),
      );
    await database
      .prepare("UPDATE rooms SET state='REJECTED' WHERE id=?")
      .bind(room.id)
      .run();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
    await database
      .prepare("UPDATE rooms SET state='READY',terms_json=? WHERE id=?")
      .bind(
        JSON.stringify({ ...room.terms, expiresAt: Date.now() - 1 }),
        room.id,
      )
      .run();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
  });
  it("atomically consumes source listings and unlocks owners when final success is persisted", async () => {
    const database = db(),
      now = Date.now();
    await database
      .prepare(
        `INSERT INTO listings(id,owner,cluster,give_mint,want_mint,gross_raw,min_receive_net_raw,expires_at,created_at,balance_raw,balance_checked_at) VALUES('consumed','Alice','devnet','mint-a','mint-b','1','1',?,?,'1',?)`,
      )
      .bind(now + 300000, now, now)
      .run();
    const room = await ready(
        database,
        await createRoom(database, {
          terms: terms(),
          termsHash: "v1",
          listingIds: ["consumed"],
        }),
      ),
      a = attempt(room);
    await acquireAttemptLocks(database, room, a);
    await saveAttempt(
      database,
      {
        ...a,
        state: "FINALIZED",
        txid: "settled-identity",
        fullWireBase64: "c2lnbmVk",
        submissionStartedAt: now,
      },
      "SIGNING",
      a,
    );
    // No explicit release helper ran: all effects belong to the terminal-state write.
    expect(
      (await database.prepare("SELECT lock_key FROM active_locks").all())
        .results,
    ).toHaveLength(0);
    expect(
      await database
        .prepare("SELECT status FROM listings WHERE id='consumed'")
        .first(),
    ).toEqual({ status: "FILLED" });
    expect((await getRoom(database, room.id))?.state).toBe("FINALIZED");
    await expect(
      createRoom(database, {
        terms: terms(),
        termsHash: "other",
        listingIds: ["consumed"],
      }),
    ).rejects.toThrow();
  });
  it("stores u64 quantities losslessly and rechecks listing versions before preparation", async () => {
    const database = db(),
      value = "18446744073709551615",
      now = Date.now();
    await database
      .prepare(
        `INSERT INTO listings(id,owner,cluster,give_mint,want_mint,gross_raw,min_receive_net_raw,expires_at,created_at,balance_raw,balance_checked_at) VALUES('listing','Alice','devnet','mint-a','mint-b',?,?,?, ?,?,?)`,
      )
      .bind(value, value, now + 300_000, now, value, now)
      .run();
    const stored = await database
      .prepare(
        "SELECT gross_raw,typeof(gross_raw) AS kind FROM listings WHERE id='listing'",
      )
      .first<{ gross_raw: string; kind: string }>();
    expect(stored).toEqual({ gross_raw: value, kind: "text" });
    const room = await ready(
      database,
      await createRoom(database, {
        terms: terms(),
        termsHash: "v1",
        listingIds: ["listing"],
      }),
    );
    await database
      .prepare(
        "UPDATE listings SET status='WITHDRAWN',version=2 WHERE id='listing'",
      )
      .run();
    await expect(
      acquireAttemptLocks(database, room, attempt(room)),
    ).rejects.toThrow();
    expect(
      (await database.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(0);
  });
});
