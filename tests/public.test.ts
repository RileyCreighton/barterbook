import { afterEach, describe, expect, it } from "vitest";
import bs58 from "bs58";
import { createPublicRouter } from "../src/server/public";
import {
  acquireAttemptLocks,
  createRoom,
  getRoom,
  releaseAttemptLocks,
  saveAttempt,
} from "../src/server/db";
import type { Attempt, Env, Receipt } from "../src/shared/types";
import { fixture } from "./fixtures";
import { testDatabase } from "./db-fixture";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = testDatabase();
  databases.push(db);
  const f = fixture();
  const env = {
    DB: db,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    DEMO_PARTICIPANTS_JSON: JSON.stringify(f.terms.owners),
    SOLANA_RPC_URL:
      "https://private.invalid/?api-key=EXAMPLE_secret-test-value",
  } as unknown as Env;
  const app = createPublicRouter();
  return { db, f, env, request: (path: string) => app.request(path, {}, env) };
}
async function record(
  t: ReturnType<typeof setup>,
  options: {
    state?: Attempt["state"];
    verified?: boolean;
    cluster?: string;
    time?: number;
    archive?: boolean;
  } = {},
) {
  const terms = {
    ...t.f.terms,
    cluster: options.cluster ?? "devnet",
  } as typeof t.f.terms;
  let room = await createRoom(t.db, { terms, termsHash: crypto.randomUUID() });
  await t.db
    .prepare(
      "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=?",
    )
    .bind(room.id)
    .run();
  await t.db
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(room.id)
    .run();
  room = (await getRoom(t.db, room.id))!;
  const old: Attempt = {
    id: crypto.randomUUID(),
    roomId: room.id,
    termsHash: room.termsHash,
    plan: { ...t.f.plan, terms },
    messageBase64: "dGVzdCBvbmx5",
    messageHash: "test-message-hash",
    wireBase64: "private-unbroadcast-wire",
    fullWireBase64: null,
    txid: null,
    state: "SIGNING",
    signatures: {},
    createdAt: options.time ?? Date.now(),
    submissionStartedAt: null,
    lastCheckedAt: null,
    stopRequested: false,
    safeToRetry: false,
    receipt: null,
    error: null,
  };
  await acquireAttemptLocks(t.db, room, old);
  const txid = bs58.encode(crypto.getRandomValues(new Uint8Array(64)));
  const receipt: Receipt = {
    txid,
    cluster: terms.cluster,
    slot: "123",
    blockTime: 1790312400,
    status: "FINALIZED",
    networkFeeLamports: "10000",
    accountRentLamports: "0",
    verified: options.verified ?? true,
    issuerFees: terms.legs.map((l) => ({
      mint: l.mint,
      feeRaw: l.expectedFeeRaw,
    })),
    deltas: terms.legs.flatMap((l) => [
      {
        account: l.sourceAccount,
        owner: l.fromOwner,
        mint: l.mint,
        preRaw: l.grossRaw,
        postRaw: "0",
        deltaRaw: `-${l.grossRaw}`,
      },
      {
        account: l.destinationATA,
        owner: l.toOwner,
        mint: l.mint,
        preRaw: "0",
        postRaw: l.netRaw,
        deltaRaw: l.netRaw,
      },
    ]),
  };
  const next: Attempt = {
    ...old,
    state: options.state ?? "FINALIZED",
    txid,
    receipt,
    fullWireBase64: "finalized-test-wire",
    submissionStartedAt: Date.now(),
    ...(options.archive
      ? {
          publicEvidence: {
            observedAt: Date.now(),
            buildId: "1234567",
            transaction: {
              slot: 123,
              transaction: ["finalized-test-wire", "base64"],
              meta: null,
            },
          },
        }
      : {}),
  };
  await saveAttempt(t.db, next, old.state, old);
  if (next.state === "FINALIZED") await releaseAttemptLocks(t.db, next.id);
  return next;
}
describe("public history and evidence privacy", () => {
  it("returns only verified matching-cluster receipts and no private attempt data", async () => {
    const t = setup();
    const good = await record(t);
    await record(t, { verified: false });
    await record(t, { cluster: "mainnet-beta" });
    const result = (await (await t.request("/history")).json()) as {
      receipts: (Receipt & {
        demo: boolean;
        owners: number;
        transfers: number;
      })[];
    };
    expect(result.receipts).toHaveLength(1);
    expect(result.receipts[0]).toMatchObject({
      txid: good.txid,
      demo: true,
      owners: 2,
      transfers: 3,
      blockTime: 1790312400,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private|wireBase64|signatures|secret-test/,
    );
    expect((await t.request(`/receipts/${good.txid}`)).status).toBe(200);
    expect((await t.request(`/receipts/${good.txid}/evidence`)).status).toBe(
      404,
    );
  });
  it("never exposes signed bytes for a non-finalized or unarchived attempt", async () => {
    const t = setup();
    const attempt = await record(t, { state: "CONFIRMED", archive: true });
    expect((await t.request(`/receipts/${attempt.txid}/evidence`)).status).toBe(
      404,
    );
    const finalized = { ...attempt, state: "FINALIZED" as const };
    await saveAttempt(t.db, finalized, attempt.state, attempt);
    const response = await t.request(`/receipts/${attempt.txid}/evidence`);
    expect(response.status).toBe(200);
    const proof = (await response.json()) as { source: string };
    expect(proof).toMatchObject({
      cluster: "devnet",
      fullWireBase64: "finalized-test-wire",
      buildId: "1234567",
    });
    expect(proof).not.toHaveProperty("signatures");
    expect(proof.source).toContain("type is not inferred");
  });
  it("paginates deterministically across equal timestamps without losing history", async () => {
    const t = setup();
    const ids = [];
    const createdAt = Date.now() - 60_000;
    for (let i = 0; i < 32; i++)
      ids.push((await record(t, { time: createdAt })).txid);
    const first = (await (await t.request("/history")).json()) as {
      receipts: Receipt[];
      nextCursor: string;
    };
    expect(first.receipts).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const second = (await (
      await t.request(`/history?cursor=${encodeURIComponent(first.nextCursor)}`)
    ).json()) as { receipts: Receipt[]; nextCursor: string | null };
    expect(second.receipts).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    expect(
      new Set([...first.receipts, ...second.receipts].map((r) => r.txid)),
    ).toEqual(new Set(ids));
    expect((await t.request("/history?cursor=malformed")).status).toBe(400);
  });
  it("publishes only safe public configuration and labels configured wallets transparently", async () => {
    const t = setup();
    t.env.REPOSITORY_URL = "https://github.com/RileyCreighton/barterbook";
    t.env.SITE_URL = "https://user:secret@site.invalid";
    t.env.BUILD_ID = "1234567";
    const config = (await (await t.request("/demo")).json()) as {
      participants: { address: string; label: string }[];
    };
    expect(config).toMatchObject({
      cluster: "devnet",
      siteUrl: null,
      buildId: "1234567",
      settlementEnabled: true,
    });
    expect(config.participants[0]).toEqual({
      address: t.f.terms.owners[0],
      label: "Demo wallet 1",
    });
    expect(JSON.stringify(config)).not.toContain("secret");
  });
});
