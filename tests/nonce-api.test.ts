import { afterEach, expect, it, vi } from "vitest";
import {
  Keypair,
  Message,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { HTTPException } from "hono/http-exception";
import bs58 from "bs58";
import { createNonceRouter } from "../src/server/nonce";
import { testDatabase } from "./db-fixture";
import { b64, sha256, unb64 } from "../src/shared/crypto";
import { nonceAddress, type NonceOperation } from "../src/shared/nonce";
import type { Env } from "../src/shared/types";
import type { Attempt } from "../src/shared/types";
import {
  acquireAttemptLocks,
  createRoom,
  getAttempt,
  getRoom,
} from "../src/server/db";
import { hashTerms, unsignedWire, wireParts } from "../src/shared/transactions";
import { fixture as tradeFixture } from "./fixtures";
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  databases.splice(0).forEach((db) => db.close());
});

async function fixture(key = Keypair.generate()) {
  const db = testDatabase();
  databases.push(db);
  const wallet = key.publicKey.toBase58(),
    address = await nonceAddress(wallet);
  const origin = "https://barterbook.test",
    now = Date.now(),
    token = "a".repeat(43),
    challenge = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      challenge,
      wallet,
      origin,
      "devnet",
      "local fixture",
      now + 60000,
      now,
    )
    .run();
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,challenge_id,wallet,origin,cluster,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      await sha256(token),
      challenge,
      wallet,
      origin,
      "devnet",
      now + 3600000,
      now,
    )
    .run();
  const env = {
    DB: db,
    APP_ORIGIN: origin,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    SOLANA_RPC_URL: "https://primary.test",
    SOLANA_RPC_FALLBACK_URL: "https://fallback.test",
  } as unknown as Env;
  const state = {
    exists: false,
    slot: 100,
    height: 100,
    rent: 1447680,
    blockhash: Keypair.generate().publicKey.toBase58(),
    nonce: Keypair.generate().publicKey.toBase58(),
    sendCalls: 0,
    timeout: false,
    persistedBeforeSend: false,
    transactions: new Map<string, unknown>(),
  };
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body));
    let result: unknown;
    switch (method) {
      case "getGenesisHash":
        result = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
        break;
      case "getAccountInfo": {
        expect(params[0]).toBe(address);
        const data = Buffer.alloc(80);
        data.writeUInt32LE(1, 0);
        data.writeUInt32LE(1, 4);
        data.set(key.publicKey.toBytes(), 8);
        data.set(new PublicKey(state.nonce).toBytes(), 40);
        data.writeBigUInt64LE(5000n, 72);
        result = {
          context: { slot: state.slot },
          value: state.exists
            ? {
                data: [b64(data), "base64"],
                owner: SystemProgram.programId.toBase58(),
                executable: false,
              }
            : null,
        };
        break;
      }
      case "getMinimumBalanceForRentExemption":
        result = state.rent;
        break;
      case "getLatestBlockhash":
        result = {
          context: { slot: state.slot },
          value: { blockhash: state.blockhash, lastValidBlockHeight: 250 },
        };
        break;
      case "getFeeForMessage":
        result = { context: { slot: state.slot }, value: 5000 };
        break;
      case "getBlockHeight":
        result = state.height;
        break;
      case "getEpochInfo":
        result = { absoluteSlot: state.slot, blockHeight: state.height };
        break;
      case "isBlockhashValid":
        result = { context: { slot: state.slot }, value: state.height <= 250 };
        break;
      case "getTransaction":
        result = state.transactions.get(params[0]) ?? null;
        break;
      case "sendTransaction": {
        const wire = unb64(params[0]),
          txid = bs58.encode(wire.slice(1, 65));
        state.sendCalls++;
        const saved = await db
          .prepare(
            "SELECT state,signed_wire_base64 FROM nonce_operations WHERE txid=?",
          )
          .bind(txid)
          .first<{ state: string; signed_wire_base64: string }>();
        state.persistedBeforeSend =
          saved?.state === "SUBMISSION_STARTED" &&
          saved.signed_wire_base64 === params[0];
        state.exists = true;
        state.nonce = Keypair.generate().publicKey.toBase58();
        state.slot++;
        state.transactions.set(txid, {
          transaction: [params[0], "base64"],
          meta: { err: null, fee: 5000 },
          slot: state.slot,
        });
        if (state.timeout)
          throw new Error("Transport interrupted after acceptance");
        result = txid;
        break;
      }
      default:
        throw new Error(`Unexpected mock RPC ${method}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const app = createNonceRouter();
  app.onError((e, c) =>
    c.json({ error: e.message }, e instanceof HTTPException ? e.status : 400),
  );
  const request = (path: string, body: unknown = {}, authenticated = true) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(authenticated ? { Cookie: `__Host-bb_session=${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      env,
    );
  async function prepare() {
    const r = await request("/nonce/setup");
    expect(r.status).toBe(201);
    return ((await r.json()) as { operation: NonceOperation }).operation;
  }
  function signed(op: NonceOperation) {
    const tx = Transaction.from(unb64(op.wireBase64));
    tx.sign(key);
    return b64(tx.serialize());
  }
  return { db, key, state, request, prepare, signed, fetchMock, app, env };
}

it("journals a bounded one-time setup before broadcast and reuses the payer-controlled account", async () => {
  const f = await fixture(),
    op = await f.prepare();
  expect(op.plan).toMatchObject({
    kind: "setup",
    wallet: f.key.publicKey.toBase58(),
    rentLamports: "1447680",
  });
  const result = await f.request(`/nonce/operations/${op.id}/submit`, {
    wireBase64: f.signed(op),
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    operation: { state: "FINALIZED" },
  });
  expect(f.state.persistedBeforeSend).toBe(true);
  expect(f.state.sendCalls).toBe(1);
  expect(await (await f.request("/nonce/setup")).json()).toMatchObject({
    ready: true,
  });
  expect(f.state.sendCalls).toBe(1);
});
it("recovers setup after a send timeout without issuing a second transaction", async () => {
  const f = await fixture(),
    op = await f.prepare();
  f.state.timeout = true;
  const body = { wireBase64: f.signed(op) };
  expect(
    await (await f.request(`/nonce/operations/${op.id}/submit`, body)).json(),
  ).toMatchObject({ operation: { state: "FINALIZED" } });
  await f.request(`/nonce/operations/${op.id}/submit`, body);
  expect(f.state.sendCalls).toBe(1);
});
it("rejects changed instructions before persisting or broadcasting a setup signature", async () => {
  const f = await fixture(),
    op = await f.prepare(),
    tx = Transaction.from(unb64(op.wireBase64));
  tx.add(
    SystemProgram.transfer({
      fromPubkey: f.key.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(f.key);
  expect(
    (
      await f.request(`/nonce/operations/${op.id}/submit`, {
        wireBase64: b64(tx.serialize()),
      })
    ).status,
  ).toBe(400);
  expect(f.state.sendCalls).toBe(0);
  const row = await f.db
    .prepare("SELECT state,txid FROM nonce_operations WHERE id=?")
    .bind(op.id)
    .first();
  expect(row).toEqual({ state: "PREPARED", txid: null });
});
it("requires authentication and rejects an excessive nonce rent quote", async () => {
  const f = await fixture();
  expect((await f.request("/nonce/setup", {}, false)).status).toBe(401);
  f.state.rent = 2000001;
  expect((await f.request("/nonce/setup")).status).toBe(400);
  expect(f.state.sendCalls).toBe(0);
});
it("requires expiry evidence before offering a new setup after interrupted approval", async () => {
  const f = await fixture(),
    op = await f.prepare();
  const stillLive = await f.request("/nonce/setup");
  expect(await stillLive.json()).toMatchObject({
    operation: { id: op.id, state: "PREPARED" },
  });
  f.state.height = 251;
  f.state.slot = 300;
  expect(
    await (await f.request(`/nonce/operations/${op.id}/reconcile`)).json(),
  ).toMatchObject({ operation: { id: op.id, state: "EXPIRED" } });
  const next = await f.prepare();
  expect(next.id).not.toBe(op.id);
  expect(f.state.sendCalls).toBe(0);
});

it("journals cancellation against the original nonce and retains exchange locks until original-outcome reconciliation", async () => {
  const trade = tradeFixture(),
    f = await fixture(trade.owners[0]);
  f.state.exists = true;
  trade.terms.nonceAccount = await nonceAddress(trade.terms.feePayer);
  trade.plan.blockhash = f.state.nonce;
  trade.plan.contextSlot = "100";
  trade.plan.lastValidBlockHeight = "0";
  const room = await createRoom(f.db, {
    terms: trade.terms,
    termsHash: await hashTerms(trade.terms),
  });
  await f.db
    .prepare(
      "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=?",
    )
    .bind(room.id)
    .run();
  await f.db
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(room.id)
    .run();
  const wire = unsignedWire(trade.plan),
    parts = wireParts(unb64(wire));
  const attempt: Attempt = {
    id: crypto.randomUUID(),
    roomId: room.id,
    termsHash: room.termsHash,
    plan: trade.plan,
    messageBase64: b64(parts.message),
    messageHash: await sha256(parts.message),
    wireBase64: wire,
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
  await acquireAttemptLocks(f.db, (await getRoom(f.db, room.id))!, attempt);
  const response = await f.request(`/attempts/${attempt.id}/cancel-onchain`);
  expect(response.status).toBe(201);
  const op = ((await response.json()) as { operation: NonceOperation })
    .operation;
  expect(op.plan).toMatchObject({
    kind: "cancel",
    blockhash: attempt.plan.blockhash,
    attemptId: attempt.id,
    rentLamports: "0",
  });
  expect((await getAttempt(f.db, attempt.id))!).toMatchObject({
    stopRequested: true,
    safeToRetry: false,
  });
  expect(
    await (
      await f.request(`/nonce/operations/${op.id}/submit`, {
        wireBase64: f.signed(op),
      })
    ).json(),
  ).toMatchObject({ operation: { state: "FINALIZED" } });
  expect(f.state.persistedBeforeSend).toBe(true);
  expect((await getAttempt(f.db, attempt.id))!.safeToRetry).toBe(false);
  expect(
    await f.db
      .prepare("SELECT COUNT(*) AS n FROM active_locks WHERE attempt_id=?")
      .bind(attempt.id)
      .first<number>("n"),
  ).toBeGreaterThan(0);
});
