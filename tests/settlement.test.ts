import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AccountLayout,
  ExtensionType,
  MintLayout,
  TransferFeeAmountLayout,
  TransferFeeConfigLayout,
} from "@solana/spl-token";
import { Message, PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { HTTPException } from "hono/http-exception";
import {
  createSettlementRouter,
  reconcileAttempt,
} from "../src/server/settlement";
import { createRoom, getAttempt, getRoom } from "../src/server/db";
import { b64, sha256, unb64 } from "../src/shared/crypto";
import {
  hashTerms,
  transactionId,
  wireParts,
} from "../src/shared/transactions";
import type { TransactionEvidence } from "../src/shared/receipt";
import type { Asset, Attempt, Env } from "../src/shared/types";
import { fixture } from "./fixtures";
import { testDatabase } from "./db-fixture";
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});
function mintInfo(asset: Asset) {
  const bytes = Buffer.alloc(170 + TransferFeeConfigLayout.span);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 1_000_000_000n,
      decimals: asset.decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    bytes,
  );
  bytes[165] = 1;
  bytes.writeUInt16LE(ExtensionType.TransferFeeConfig, 166);
  bytes.writeUInt16LE(TransferFeeConfigLayout.span, 168);
  const fee = (s: Asset["olderFee"]) => ({
    epoch: BigInt(s.epoch),
    maximumFee: BigInt(s.maximumFeeRaw),
    transferFeeBasisPoints: s.basisPoints,
  });
  TransferFeeConfigLayout.encode(
    {
      transferFeeConfigAuthority: PublicKey.default,
      withdrawWithheldAuthority: PublicKey.default,
      withheldAmount: 0n,
      olderTransferFee: fee(asset.olderFee),
      newerTransferFee: fee(asset.newerFee),
    },
    bytes,
    170,
  );
  return {
    data: [b64(bytes), "base64"],
    owner: asset.tokenProgram,
    lamports: 2_000_000,
    executable: false,
    rentEpoch: 0,
  };
}
function accountInfo(asset: Asset, owner: string, amount = 50_000_000n) {
  const bytes = Buffer.alloc(170 + TransferFeeAmountLayout.span);
  AccountLayout.encode(
    {
      mint: new PublicKey(asset.mint),
      owner: new PublicKey(owner),
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    bytes,
  );
  bytes[165] = 2;
  bytes.writeUInt16LE(ExtensionType.TransferFeeAmount, 166);
  bytes.writeUInt16LE(TransferFeeAmountLayout.span, 168);
  TransferFeeAmountLayout.encode({ withheldAmount: 0n }, bytes, 170);
  return {
    data: [b64(bytes), "base64"],
    owner: asset.tokenProgram,
    lamports: 2_000_000,
    executable: false,
    rentEpoch: 0,
  };
}
function metadata(wire: string, attempt: Attempt): TransactionEvidence {
  const keys = Message.from(wireParts(unb64(wire)).message).accountKeys.map(
    (k) => k.toBase58(),
  );
  const evidence: TransactionEvidence = {
    slot: 222,
    transaction: [wire, "base64"],
    meta: {
      err: null,
      fee: Number(attempt.plan.networkFeeLamports),
      preBalances: keys.map(() => 100_000_000),
      postBalances: keys.map((_, i) =>
        i === 0
          ? 100_000_000 - Number(attempt.plan.networkFeeLamports)
          : 100_000_000,
      ),
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
  for (const leg of attempt.plan.terms.legs)
    for (const [account, owner, delta] of [
      [leg.sourceAccount, leg.fromOwner, -BigInt(leg.grossRaw)],
      [leg.destinationATA, leg.toOwner, BigInt(leg.netRaw)],
    ] as const) {
      const before = {
        accountIndex: keys.indexOf(account),
        mint: leg.mint,
        owner,
        programId: leg.tokenProgram,
        uiTokenAmount: { amount: "50000000", decimals: leg.decimals },
      };
      evidence.meta!.preTokenBalances!.push(before);
      evidence.meta!.postTokenBalances!.push({
        ...before,
        uiTokenAmount: {
          amount: (50_000_000n + delta).toString(),
          decimals: leg.decimals,
        },
      });
    }
  return evidence;
}
async function setup(options: { rentCap?: string } = {}) {
  const db = testDatabase();
  databases.push(db);
  const f = fixture(),
    origin = "https://barterbook.test";
  if (options.rentCap !== undefined)
    f.terms.maxAccountRentLamports = options.rentCap;
  const env = {
    DB: db,
    APP_ORIGIN: origin,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    SOLANA_RPC_URL: "https://rpc-primary.test",
    SOLANA_RPC_FALLBACK_URL: "https://rpc-fallback.test",
    RPC_HISTORY_TRUSTED: "true",
    FALLBACK_HISTORY_TRUSTED: "true",
    DEVNET_ASSETS_JSON: JSON.stringify(f.assets),
  } as unknown as Env;
  const room = await createRoom(db, {
    terms: f.terms,
    termsHash: await hashTerms(f.terms),
  });
  await db
    .prepare(
      "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=?",
    )
    .bind(room.id)
    .run();
  await db
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(room.id)
    .run();
  const tokens = new Map<string, string>();
  for (const wallet of f.terms.owners) {
    const token = b64(crypto.getRandomValues(new Uint8Array(32)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_"),
      id = crypto.randomUUID(),
      now = Date.now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(id, wallet, origin, "devnet", "test fixture", now + 60000, now),
      db
        .prepare(
          "INSERT INTO sessions(token_hash,challenge_id,wallet,origin,cluster,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          await sha256(token),
          id,
          wallet,
          origin,
          "devnet",
          now + 3600000,
          now,
        ),
    ]);
    tokens.set(wallet, token);
  }
  const state = {
    height: 100,
    blockhashValid: true,
    timeoutSend: false,
    simulateError: false,
    lowTokenBalance: false,
    lowSolBalance: false,
    missingDestination: false,
    emptyDestinations: false,
    rentQuote: 2_000_000,
    historyUnavailable: false,
    finalized: false,
    receipt: null as TransactionEvidence | null,
    sendCalls: 0,
    persistedAtSend: null as Attempt | null,
    sentWire: null as string | null,
    attemptId: null as string | null,
  };
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { method, params } = JSON.parse(String(init?.body)) as {
      method: string;
      params: any[];
    };
    let result: unknown;
    switch (method) {
      case "getGenesisHash":
        result = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
        break;
      case "getFirstAvailableBlock":
        result = 1;
        break;
      case "getEpochInfo":
        result = { epoch: 1, absoluteSlot: 100 };
        break;
      case "getMultipleAccounts":
        result = {
          context: { slot: 100 },
          value: params[0].map((address: string) => {
            const asset = f.assets.find((a) => a.mint === address);
            if (asset) return mintInfo(asset);
            for (const leg of f.terms.legs) {
              const a = f.assets.find((a) => a.mint === leg.mint)!;
              if (address === leg.sourceAccount)
                return accountInfo(
                  a,
                  leg.fromOwner,
                  state.lowTokenBalance ? 1n : 50_000_000n,
                );
              if (address === leg.destinationATA)
                return state.missingDestination
                  ? null
                  : accountInfo(
                      a,
                      leg.toOwner,
                      state.emptyDestinations ? 0n : 50_000_000n,
                    );
            }
            return null;
          }),
        };
        break;
      case "getMinimumBalanceForRentExemption":
        result = state.rentQuote;
        break;
      case "getLatestBlockhash":
        result = {
          context: { slot: 100 },
          value: { blockhash: f.plan.blockhash, lastValidBlockHeight: 500 },
        };
        break;
      case "simulateTransaction":
        result = {
          value: {
            err: state.simulateError
              ? { InstructionError: [3, "InsufficientFunds"] }
              : null,
            unitsConsumed: 100000,
          },
        };
        break;
      case "getFeeForMessage":
        result = { context: { slot: 100 }, value: 10000 };
        break;
      case "getBalance":
        result = {
          context: { slot: 100 },
          value: state.lowSolBalance ? 1 : 100_000_000,
        };
        break;
      case "getHealth":
        if (state.historyUnavailable) throw new Error("history unavailable");
        result = "ok";
        break;
      case "getBlockHeight":
        result = state.height;
        break;
      case "isBlockhashValid":
        result = { context: { slot: 100 }, value: state.blockhashValid };
        break;
      case "getSignatureStatuses":
        result = {
          context: { slot: 222 },
          value: [
            state.receipt
              ? {
                  confirmationStatus: state.finalized
                    ? "finalized"
                    : "confirmed",
                  err: state.receipt.meta!.err,
                }
              : null,
          ],
        };
        break;
      case "getTransaction":
        result =
          params[1].commitment === "finalized" && !state.finalized
            ? null
            : state.receipt;
        break;
      case "sendTransaction": {
        state.sendCalls++;
        state.sentWire = params[0];
        state.persistedAtSend = await getAttempt(db, state.attemptId!);
        state.receipt = metadata(params[0], state.persistedAtSend!);
        state.finalized = true;
        if (state.timeoutSend)
          throw new Error("transport failed after node accepted transaction");
        result = transactionId(unb64(params[0]));
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
  const app = createSettlementRouter();
  app.onError((error, c) =>
    c.json(
      { error: error.message },
      error instanceof HTTPException ? error.status : 400,
    ),
  );
  const request = (
    path: string,
    wallet = f.terms.owners[0],
    body: unknown = {},
  ) =>
    app.request(
      path,
      {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: `__Host-bb_session=${tokens.get(wallet)}`,
        },
        body: JSON.stringify(body),
      },
      env,
    );
  async function prepare() {
    const response = await request(`/rooms/${room.id}/attempts`, undefined, {
      version: 1,
      termsHash: room.termsHash,
    });
    expect(response.status).toBe(201);
    const { attempt } = (await response.json()) as { attempt: Attempt };
    state.attemptId = attempt.id;
    return attempt;
  }
  async function sign(attempt: Attempt, ownerIndex: number) {
    const tx = Transaction.from(Buffer.from(attempt.wireBase64, "base64"));
    tx.partialSign(f.owners[ownerIndex]);
    return request(
      `/attempts/${attempt.id}/signatures`,
      f.terms.owners[ownerIndex],
      {
        wireBase64: b64(
          tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        ),
      },
    );
  }
  async function fullySigned() {
    let attempt = await prepare();
    for (let i = 0; i < f.owners.length; i++) {
      const response = await sign(attempt, i);
      expect(response.status).toBe(200);
      attempt = ((await response.json()) as { attempt: Attempt }).attempt;
    }
    return attempt;
  }
  return {
    db,
    f,
    env,
    room,
    state,
    request,
    prepare,
    sign,
    fullySigned,
    fetchMock,
  };
}
describe("settlement HTTP + SQLite + mocked RPC integration (not onchain evidence)", () => {
  it("keeps active signing and fully signed attempts usable while polling a healthy valid lifetime", async () => {
    const t = await setup();
    let attempt = await t.prepare();
    attempt = await reconcileAttempt(t.env, attempt);
    expect(attempt.state).toBe("SIGNING");
    for (let i = 0; i < 2; i++) {
      const response = await t.sign(attempt, i);
      expect(response.status).toBe(200);
      attempt = ((await response.json()) as { attempt: Attempt }).attempt;
    }
    attempt = await reconcileAttempt(t.env, attempt);
    expect(attempt.state).toBe("FULLY_SIGNED");
    expect((await t.request(`/attempts/${attempt.id}/submit`)).status).toBe(
      200,
    );
    expect(t.state.sendCalls).toBe(1);
  });
  it("persists full bytes, local identifier, lifetime and submission marker before broadcasting exact bytes", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    expect(attempt.state).toBe("FULLY_SIGNED");
    expect(attempt.txid).toBe(transactionId(unb64(attempt.fullWireBase64!)));
    const response = await t.request(`/attempts/${attempt.id}/submit`);
    expect(response.status).toBe(200);
    expect(t.state.sendCalls).toBe(1);
    expect(t.state.persistedAtSend).toMatchObject({
      state: "SUBMISSION_STARTED",
      fullWireBase64: attempt.fullWireBase64,
      txid: attempt.txid,
      plan: {
        blockhash: attempt.plan.blockhash,
        lastValidBlockHeight: attempt.plan.lastValidBlockHeight,
      },
    });
    expect(t.state.persistedAtSend!.submissionStartedAt).toBeTypeOf("number");
    expect(t.state.sentWire).toBe(attempt.fullWireBase64);
    await t.request(`/attempts/${attempt.id}/submit`);
    expect(t.state.sendCalls).toBe(1);
  });
  it("broadcasts only once when two submit requests race", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    const responses = await Promise.all([
      t.request(`/attempts/${attempt.id}/submit`),
      t.request(`/attempts/${attempt.id}/submit`),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(t.state.sendCalls).toBe(1);
    expect((await getAttempt(t.db, attempt.id))?.fullWireBase64).toBe(
      attempt.fullWireBase64,
    );
  });
  it("recovers original success and transaction metadata after a send timeout and a new router instance", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.timeoutSend = true;
    const response = await t.request(`/attempts/${attempt.id}/submit`);
    const pending = ((await response.json()) as { attempt: Attempt }).attempt;
    expect(pending.state).toBe("STATUS_UNKNOWN");
    expect(pending.safeToRetry).toBe(false);
    const persisted = (await getAttempt(t.db, attempt.id))!;
    const recovered = await reconcileAttempt(t.env, persisted);
    expect(recovered).toMatchObject({
      state: "FINALIZED",
      safeToRetry: false,
      txid: attempt.txid,
      receipt: {
        verified: true,
        status: "FINALIZED",
        networkFeeLamports: "10000",
      },
    });
    expect(recovered.receipt?.deltas).toHaveLength(6);
    expect(recovered.publicEvidence?.transaction.transaction[0]).toBe(
      attempt.fullWireBase64,
    );
    expect((await getAttempt(t.db, attempt.id))?.publicEvidence).toEqual(
      recovered.publicEvidence,
    );
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(0);
    const repeated = await t.request(
      `/rooms/${t.room.id}/attempts`,
      undefined,
      { version: 1, termsHash: t.room.termsHash },
    );
    expect(repeated.status).toBe(200);
    expect(((await repeated.json()) as { attempt: Attempt }).attempt.id).toBe(
      attempt.id,
    );
    expect(t.state.sendCalls).toBe(1);
    expect(
      (await t.db.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(1);
  });
  it("rejects a concurrent signature overwrite, then safely merges the loser after reloading", async () => {
    const t = await setup(),
      attempt = await t.prepare();
    const results = await Promise.all([t.sign(attempt, 0), t.sign(attempt, 1)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    let current = (await getAttempt(t.db, attempt.id))!;
    expect(Object.keys(current.signatures)).toHaveLength(1);
    const loser = results.findIndex((r) => r.status === 409),
      response = await t.sign(current, loser);
    expect(response.status).toBe(200);
    current = ((await response.json()) as { attempt: Attempt }).attempt;
    expect(current.state).toBe("FULLY_SIGNED");
    expect(Object.keys(current.signatures)).toHaveLength(2);
    expect(current.messageBase64).toBe(attempt.messageBase64);
  });
  it("cannot replace or immediately unlock a canceled attempt even before a signature upload", async () => {
    const t = await setup(),
      attempt = await t.prepare();
    expect((await t.request(`/attempts/${attempt.id}/stop`)).status).toBe(200);
    const retry = await t.request(`/rooms/${t.room.id}/attempts`, undefined, {
      version: 1,
      termsHash: t.room.termsHash,
    });
    expect(((await retry.json()) as { attempt: Attempt }).attempt.id).toBe(
      attempt.id,
    );
    expect((await t.sign(attempt, 0)).status).toBe(409);
    t.state.height = 501;
    t.state.blockhashValid = false;
    const recovered = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, attempt.id))!,
    );
    expect(recovered.state).toBe("STATUS_UNKNOWN");
    expect(recovered.safeToRetry).toBe(false);
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });
  it("does not authorize replacement from preflight failure or unavailable history; authoritative expiry still requires fresh consent", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.simulateError = true;
    const response = await t.request(`/attempts/${attempt.id}/submit`);
    expect(
      ((await response.json()) as { attempt: Attempt }).attempt.state,
    ).toBe("STATUS_UNKNOWN");
    expect(t.state.sendCalls).toBe(0);
    t.state.height = 501;
    t.state.blockhashValid = false;
    t.state.historyUnavailable = true;
    let current = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, attempt.id))!,
    );
    expect(current.safeToRetry).toBe(false);
    t.state.historyUnavailable = false;
    current = await reconcileAttempt(t.env, current);
    expect(current).toMatchObject({
      state: "EXPIRED_UNLANDED",
      safeToRetry: true,
    });
    expect(
      (
        await t.request(`/rooms/${t.room.id}/attempts`, undefined, {
          version: 1,
          termsHash: t.room.termsHash,
        })
      ).status,
    ).toBe(409);
    expect(
      (await t.db.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(1);
  });
  it("budgets extension-aware receiving-account funding before wallet signing", async () => {
    const t = await setup();
    t.state.missingDestination = true;
    const attempt = await t.prepare();
    expect(attempt.plan.accountRentLamports).toBe("6472800");
    expect(new Set(attempt.plan.createAtas).size).toBe(3);
    expect(t.state.sendCalls).toBe(0);
  });
  it("checks source inventory and payer SOL before creating any executable attempt", async () => {
    const t = await setup();
    t.state.lowTokenBalance = true;
    const lowTokens = await t.request(
      `/rooms/${t.room.id}/attempts`,
      undefined,
      { version: 1, termsHash: t.room.termsHash },
    );
    expect(lowTokens.status).toBe(400);
    t.state.lowTokenBalance = false;
    t.state.lowSolBalance = true;
    const lowSol = await t.request(`/rooms/${t.room.id}/attempts`, undefined, {
      version: 1,
      termsHash: t.room.termsHash,
    });
    expect(lowSol.status).toBe(400);
    expect(
      (await t.db.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(0);
    expect(t.state.sendCalls).toBe(0);
  });
});

describe("recovery proof integrity", () => {
  it("does not release allocations for altered failed transaction bytes or invalid signatures", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    const validFailure = metadata(attempt.fullWireBase64!, attempt);
    validFailure.meta!.err = { InstructionError: [7, { Custom: 1 }] };
    t.state.finalized = true;
    let current = attempt;
    const brokenSignature = unb64(attempt.fullWireBase64!);
    brokenSignature[1 + 64 + 3] ^= 1;
    const changedMessage = Transaction.from(
      Buffer.from(attempt.fullWireBase64!, "base64"),
    );
    changedMessage.recentBlockhash = PublicKey.default.toBase58();
    changedMessage.partialSign(...t.f.owners);
    for (const altered of [
      b64(brokenSignature),
      b64(changedMessage.serialize()),
    ]) {
      t.state.receipt = { ...validFailure, transaction: [altered, "base64"] };
      current = await reconcileAttempt(t.env, current);
      expect(current).toMatchObject({
        state: "STATUS_UNKNOWN",
        safeToRetry: false,
      });
      expect(
        (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
      ).toHaveLength(2);
    }
    t.state.receipt = validFailure;
    current = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, attempt.id))!,
    );
    expect(current).toMatchObject({
      state: "FAILED_ONCHAIN",
      safeToRetry: true,
    });
    expect(current.error).toContain("10000 lamports");
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(0);
  });

  it("durably records sanitized recovery diagnostics without releasing an uncertain attempt", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.height = 600;
    t.state.blockhashValid = false;
    const original = t.fetchMock.getMockImplementation()!;
    t.fetchMock.mockImplementation(async (url, init) => {
      const { method } = JSON.parse(String(init?.body));
      if (method === "getHealth" && String(url).includes("rpc-fallback.test"))
        return new Response("sensitive-provider-body", { status: 403 });
      return original(url, init);
    });
    const current = await reconcileAttempt(t.env, attempt);
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
    });
    const stored = (await getAttempt(t.db, attempt.id))!;
    expect(stored.lastRecoveryObservations?.[1]).toMatchObject({
      endpoint: "rpc-fallback.test",
      healthy: false,
      historyTrusted: false,
      failureStage: "getHealth",
      failureKind: "provider_http",
      failureStatus: 403,
    });
    expect(JSON.stringify(stored.lastRecoveryObservations)).not.toContain(
      "sensitive-provider-body",
    );
    expect(stored.messageBase64).toBe(attempt.messageBase64);
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });

  it("requires matching finalized failure metadata rather than a finalized status plus confirmed metadata", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.receipt = metadata(attempt.fullWireBase64!, attempt);
    t.state.receipt.meta!.err = { InstructionError: [7, { Custom: 1 }] };
    t.state.finalized = false;
    const original = t.fetchMock.getMockImplementation()!;
    t.fetchMock.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      const { method } = JSON.parse(String(init?.body));
      if (method !== "getSignatureStatuses") return response;
      const body = (await response.json()) as {
        result: { value: { confirmationStatus: string }[] };
      };
      body.result.value[0].confirmationStatus = "finalized";
      return Response.json(body);
    });
    const current = await reconcileAttempt(t.env, attempt);
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
    });
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });

  it("persists a success signal during conflicting observations and forbids a later absence-based retry", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.receipt = metadata(attempt.fullWireBase64!, attempt);
    t.state.finalized = false;
    const original = t.fetchMock.getMockImplementation()!;
    t.fetchMock.mockImplementation(async (url, init) => {
      const response = await original(url, init);
      const { method } = JSON.parse(String(init?.body));
      if (
        !String(url).includes("rpc-fallback.test") ||
        !["getSignatureStatuses", "getTransaction"].includes(method)
      )
        return response;
      const body = (await response.json()) as { result: any };
      if (method === "getSignatureStatuses")
        body.result.value[0].err = { InstructionError: [7, { Custom: 1 }] };
      else if (body.result?.meta)
        body.result.meta.err = { InstructionError: [7, { Custom: 1 }] };
      return Response.json(body);
    });
    let current = await reconcileAttempt(t.env, attempt);
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect((await getAttempt(t.db, attempt.id))?.successObserved).toBe(true);
    t.fetchMock.mockImplementation(original);
    t.state.receipt = null;
    t.state.height = 501;
    t.state.blockhashValid = false;
    current = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, attempt.id))!,
    );
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });
});

describe("sticky success when receipt retrieval fails", () => {
  it("persists confirmed success before a metadata timeout and refuses a later finalized-failure release", async () => {
    const t = await setup(),
      attempt = await t.fullySigned();
    t.state.receipt = metadata(attempt.fullWireBase64!, attempt);
    const original = t.fetchMock.getMockImplementation()!;
    t.fetchMock.mockImplementation(async (url, init) => {
      const { method } = JSON.parse(String(init?.body));
      if (method === "getTransaction")
        throw new Error("metadata transport timeout after confirmed status");
      return original(url, init);
    });
    let current = await reconcileAttempt(t.env, attempt);
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect((await getAttempt(t.db, attempt.id))?.successObserved).toBe(true);
    t.fetchMock.mockImplementation(original);
    t.state.receipt.meta!.err = { InstructionError: [7, { Custom: 1 }] };
    t.state.finalized = true;
    current = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, attempt.id))!,
    );
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });

  it("retains success when externally completed transaction bytes fail verification before full bytes were saved", async () => {
    const t = await setup(),
      unsigned = await t.prepare();
    const response = await t.sign(unsigned, 0);
    expect(response.status).toBe(200);
    const partial = ((await response.json()) as { attempt: Attempt }).attempt;
    expect(partial.txid).not.toBeNull();
    expect(partial.fullWireBase64).toBeNull();
    const externallySigned = Transaction.from(
      Buffer.from(partial.wireBase64, "base64"),
    );
    externallySigned.partialSign(t.f.owners[1]);
    const invalid = new Uint8Array(externallySigned.serialize());
    invalid[1 + 64 + 4] ^= 1;
    t.state.receipt = metadata(b64(invalid), partial);
    t.state.finalized = true;
    let current = await reconcileAttempt(t.env, partial);
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
      fullWireBase64: null,
    });
    expect((await getAttempt(t.db, partial.id))?.successObserved).toBe(true);
    t.state.receipt = null;
    t.state.height = 501;
    t.state.blockhashValid = false;
    current = await reconcileAttempt(
      t.env,
      (await getAttempt(t.db, partial.id))!,
    );
    expect(current).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(2);
  });
});

it("holds allocations for contradictory finalized-success receipt metadata until the exact receipt verifies", async () => {
  const t = await setup(),
    attempt = await t.fullySigned();
  const correct = metadata(attempt.fullWireBase64!, attempt);
  const contradictory = structuredClone(correct);
  contradictory.meta!.postTokenBalances![0].uiTokenAmount.amount = "1";
  t.state.receipt = contradictory;
  t.state.finalized = true;
  let current = await reconcileAttempt(t.env, attempt);
  expect(current).toMatchObject({
    state: "STATUS_UNKNOWN",
    safeToRetry: false,
    successObserved: true,
  });
  expect(current.receipt?.verified).not.toBe(true);
  expect(
    (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
  ).toHaveLength(2);
  t.state.receipt = correct;
  current = await reconcileAttempt(
    t.env,
    (await getAttempt(t.db, attempt.id))!,
  );
  expect(current).toMatchObject({
    state: "FINALIZED",
    safeToRetry: false,
    receipt: { verified: true },
  });
  expect(
    (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
  ).toHaveLength(0);
});

describe("conservative receiving-account funding", () => {
  it("rejects a zero rent cap even when all empty receiving ATAs currently exist", async () => {
    const t = await setup({ rentCap: "0" });
    t.state.emptyDestinations = true;
    const response = await t.request(
      `/rooms/${t.room.id}/attempts`,
      undefined,
      {
        version: 1,
        termsHash: t.room.termsHash,
      },
    );
    expect(response.status).toBe(400);
    expect(
      (await t.db.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(0);
    expect(t.state.sendCalls).toBe(0);
  });

  it("budgets every encoded receiving ATA and caches the fresh rent quote by account size", async () => {
    const t = await setup();
    t.state.emptyDestinations = true;
    const attempt = await t.prepare();
    expect(attempt.plan.accountRentLamports).toBe("6472800");
    expect(attempt.plan.createAtas).toHaveLength(3);
    const rentCalls = t.fetchMock.mock.calls
      .map(([, init]) => JSON.parse(String(init?.body)))
      .filter((call) => call.method === "getMinimumBalanceForRentExemption");
    expect(rentCalls).toHaveLength(1);
    expect(rentCalls[0].params[0]).toBe(182);
    expect(t.state.rentQuote).toBeLessThan(2_157_600);
  });

  it("refuses preparation when fresh RPC rent exceeds the browser-verifiable policy bound", async () => {
    const t = await setup();
    t.state.rentQuote = 2_157_601;
    const response = await t.request(
      `/rooms/${t.room.id}/attempts`,
      undefined,
      {
        version: 1,
        termsHash: t.room.termsHash,
      },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain(
      "policy bound",
    );
    expect(
      (await t.db.prepare("SELECT id FROM attempts").all()).results,
    ).toHaveLength(0);
  });
});

it("does not label confirmed metadata finalized merely because a status says finalized", async () => {
  const t = await setup(),
    attempt = await t.fullySigned();
  t.state.receipt = metadata(attempt.fullWireBase64!, attempt);
  t.state.finalized = false;
  const original = t.fetchMock.getMockImplementation()!;
  t.fetchMock.mockImplementation(async (url, init) => {
    const response = await original(url, init);
    const { method } = JSON.parse(String(init?.body));
    if (method !== "getSignatureStatuses") return response;
    const body = (await response.json()) as {
      result: { value: { confirmationStatus: string }[] };
    };
    body.result.value[0].confirmationStatus = "finalized";
    return Response.json(body);
  });
  const current = await reconcileAttempt(t.env, attempt);
  expect(current).toMatchObject({
    state: "STATUS_UNKNOWN",
    safeToRetry: false,
    successObserved: true,
  });
  expect(current.publicEvidence).toBeUndefined();
  expect(
    (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
  ).toHaveLength(2);
});

it("archives the actual finalized provider metadata instead of earlier confirmed metadata", async () => {
  const t = await setup(),
    attempt = await t.fullySigned();
  t.state.receipt = metadata(attempt.fullWireBase64!, attempt);
  t.state.finalized = true;
  const original = t.fetchMock.getMockImplementation()!;
  t.fetchMock.mockImplementation(async (url, init) => {
    const response = await original(url, init);
    const { method, params } = JSON.parse(String(init?.body));
    if (method !== "getTransaction") return response;
    const body = (await response.json()) as {
      result: TransactionEvidence | null;
    };
    if (!String(url).includes("rpc-fallback.test")) {
      if (params[1].commitment === "finalized") body.result = null;
      else if (body.result) body.result.slot = 221;
    } else if (body.result) body.result.slot = 222;
    return Response.json(body);
  });
  const current = await reconcileAttempt(t.env, attempt);
  expect(current).toMatchObject({
    state: "FINALIZED",
    receipt: { slot: "222" },
    publicEvidence: { transaction: { slot: 222 } },
  });
});
