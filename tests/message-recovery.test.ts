import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { Keypair, Message, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { reconcileAttempt } from "../src/server/settlement";
import {
  acquireAttemptLocks,
  createRoom,
  getAttempt,
  getRoom,
  saveAttempt,
} from "../src/server/db";
import { b64, sha256, unb64, verifyEd25519 } from "../src/shared/crypto";
import {
  buildTransaction,
  hashTerms,
  transactionId,
  unsignedWire,
  verifyWireSignatures,
  wireParts,
} from "../src/shared/transactions";
import type { Attempt, Env } from "../src/shared/types";
import type { TransactionEvidence } from "../src/shared/receipt";
import { fixture } from "./fixtures";
import { testDatabase } from "./db-fixture";
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});
type Entry = {
  signature: string;
  slot: number;
  err: unknown;
  confirmationStatus: string;
};
async function setup() {
  const db = testDatabase();
  databases.push(db);
  const f = fixture();
  f.plan.contextSlot = "100";
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
  const ready = (await getRoom(db, room.id))!;
  const wire = unsignedWire(f.plan),
    message = wireParts(unb64(wire)).message;
  const original: Attempt = {
    id: crypto.randomUUID(),
    roomId: room.id,
    termsHash: room.termsHash,
    plan: f.plan,
    messageBase64: b64(message),
    messageHash: await sha256(message),
    wireBase64: wire,
    fullWireBase64: null,
    txid: null,
    state: "SIGNING",
    signatures: {},
    createdAt: Date.now(),
    submissionStartedAt: null,
    lastCheckedAt: null,
    stopRequested: true,
    safeToRetry: false,
    receipt: null,
    error: null,
  };
  await acquireAttemptLocks(db, ready, original);
  // Pacing is separately tested against real SQLite; avoid real delays here.
  const pacedDb = {
    prepare(sql: string) {
      if (sql.includes("rpc_slots"))
        return { bind: () => ({ first: async () => ({ next_at: 0 }) }) };
      return db.prepare(sql);
    },
    batch: db.batch.bind(db),
  } as D1Database;
  const env = {
    DB: pacedDb,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    SOLANA_RPC_URL: "https://primary.test",
    SOLANA_RPC_FALLBACK_URL: "https://fallback.test",
    RPC_HISTORY_TRUSTED: "true",
    FALLBACK_HISTORY_TRUSTED: "true",
    RPC_ADDRESS_HISTORY_TRUSTED: "true",
    FALLBACK_ADDRESS_HISTORY_TRUSTED: "true",
  } as Env;
  const node = () => ({
    page: [] as Entry[],
    tail: [] as Entry[],
    metadata: new Map<string, TransactionEvidence | null>(),
    root: 1000,
    height: 501,
    epochHeights: [] as number[],
    statusContext: 1000,
    hashContext: 1000,
    valid: false,
    firstAvailable: 1,
    anchor: { blockhash: f.plan.blockhash } as { blockhash: string } | null,
    fail: "",
  });
  const primary = node(),
    fallback = node();
  const calls: Array<{ host: string; method: string; params: any[] }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const { method, params } = JSON.parse(init.body as string),
        host = new URL(url).host;
      calls.push({ host, method, params });
      const state = host === "primary.test" ? primary : fallback;
      if (state.fail === method) throw new Error("mock unavailable");
      let result: unknown;
      switch (method) {
        case "getHealth":
          result = "ok";
          break;
        case "getGenesisHash":
          result = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
          break;
        case "getFirstAvailableBlock":
          result = state.firstAvailable;
          break;
        case "getBlockHeight":
          result = state.height;
          break;
        case "isBlockhashValid":
          expect(params[1]).toEqual({
            commitment: "finalized",
            minContextSlot: state.root,
          });
          result = { context: { slot: state.hashContext }, value: state.valid };
          break;
        case "getEpochInfo":
          expect(params[0]).toEqual({ commitment: "finalized" });
          result = {
            absoluteSlot: state.root,
            blockHeight: state.epochHeights.shift() ?? state.height,
          };
          break;
        case "getSignatureStatuses":
          result = { context: { slot: state.statusContext }, value: [null] };
          break;
        case "getBlock":
          result = state.anchor;
          break;
        case "getSignaturesForAddress":
          expect(params[0]).toBe(f.terms.feePayer);
          expect(params[1]).toMatchObject({
            commitment: "finalized",
            minContextSlot: state.root,
          });
          result = params[1].before ? state.tail : state.page;
          break;
        case "getTransaction":
          expect(["confirmed", "finalized"]).toContain(params[1].commitment);
          expect(params[1].encoding).toBe("base64");
          result = state.metadata.get(params[0]) ?? null;
          break;
        default:
          throw new Error(`Forbidden or unexpected mock RPC ${method}`);
      }
      return Response.json({ jsonrpc: "2.0", id: 1, result });
    }),
  );
  function signedEvidence(
    err: unknown = null,
    slot = 222,
  ): TransactionEvidence {
    const tx = buildTransaction(f.plan);
    tx.partialSign(...f.owners);
    const bytes = tx.serialize(),
      keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
    const evidence: TransactionEvidence = {
      slot,
      transaction: [b64(bytes), "base64"],
      meta: {
        err,
        fee: 10000,
        preBalances: keys.map(() => 100000000),
        postBalances: keys.map((_, i) => (i ? 100000000 : 99990000)),
        preTokenBalances: [],
        postTokenBalances: [],
      },
    };
    for (const leg of f.terms.legs)
      for (const [account, owner, delta] of [
        [leg.sourceAccount, leg.fromOwner, -BigInt(leg.grossRaw)],
        [leg.destinationATA, leg.toOwner, BigInt(leg.netRaw)],
      ] as const) {
        const entry = {
          accountIndex: keys.indexOf(account),
          mint: leg.mint,
          owner,
          programId: leg.tokenProgram,
          uiTokenAmount: { amount: "50000000", decimals: leg.decimals },
        };
        evidence.meta!.preTokenBalances!.push(entry);
        evidence.meta!.postTokenBalances!.push({
          ...entry,
          uiTokenAmount: {
            amount: (50000000n + (err === null ? delta : 0n)).toString(),
            decimals: leg.decimals,
          },
        });
      }
    return evidence;
  }
  function put(state: typeof primary, evidence: TransactionEvidence) {
    const bytes = unb64(evidence.transaction[0]),
      signature = bs58.encode(bytes.subarray(1, 65));
    state.page.push({
      signature,
      slot: Number(evidence.slot),
      err: evidence.meta!.err,
      confirmationStatus: "finalized",
    });
    state.page.sort((a, b) => b.slot - a.slot);
    state.metadata.set(signature, evidence);
    return signature;
  }
  function unrelated(slot: number): TransactionEvidence {
    const tx = new Transaction({
      feePayer: f.owners[0].publicKey,
      recentBlockhash: f.plan.blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: f.owners[0].publicKey,
        toPubkey: f.owners[1].publicKey,
        lamports: slot + 1,
      }),
    );
    tx.sign(f.owners[0]);
    return {
      slot,
      transaction: [b64(tx.serialize()), "base64"],
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    };
  }
  const locks = async () =>
    (await db
      .prepare("SELECT count(*) AS n FROM active_locks WHERE attempt_id=?")
      .bind(original.id)
      .first<{ n: number }>())!.n;
  async function persistKnownAttempt() {
    const evidence = signedEvidence(),
      wire = unb64(evidence.transaction[0]),
      parts = wireParts(wire);
    const known: Attempt = {
      ...original,
      state: "FULLY_SIGNED",
      wireBase64: b64(wire),
      fullWireBase64: b64(wire),
      txid: transactionId(wire),
      signatures: Object.fromEntries(
        parts.signers.map((signer, i) => [signer, b64(parts.signatures[i])]),
      ),
    };
    await saveAttempt(db, known, original.state, original);
    return { known, evidence };
  }
  return {
    db,
    f,
    env,
    original,
    primary,
    fallback,
    calls,
    signedEvidence,
    put,
    unrelated,
    locks,
    persistKnownAttempt,
  };
}
// Test-only alternate valid EdDSA nonce proves different valid transaction IDs
// can bind one message. Never used with saved or funded wallets.
function alternateSignature(owner: Keypair, message: Uint8Array) {
  const extended = ed25519.utils.getExtendedPublicKey(
    owner.secretKey.subarray(0, 32),
  );
  const r = 7n,
    R = ed25519.Point.BASE.multiply(r).toBytes();
  const hash = createHash("sha512")
    .update(R)
    .update(extended.pointBytes)
    .update(message)
    .digest();
  const h = BigInt("0x" + Buffer.from(hash).reverse().toString("hex"));
  let scalar = (r + h * extended.scalar) % ed25519.CURVE.n;
  const result = new Uint8Array(64);
  result.set(R);
  for (let i = 32; i < 64; i++) {
    result[i] = Number(scalar & 255n);
    scalar >>= 8n;
  }
  return result;
}

describe("bounded immutable-message recovery without a transaction identifier", () => {
  it("releases only after two complete independently trusted, anchored expired histories", async () => {
    const h = await setup();
    const result = await reconcileAttempt(h.env, h.original);
    expect(result).toMatchObject({
      state: "EXPIRED_UNLANDED",
      safeToRetry: true,
      txid: null,
    });
    expect(await h.locks()).toBe(0);
    expect((await getAttempt(h.db, result.id))!.messageBase64).toBe(
      h.original.messageBase64,
    );
    expect(
      h.calls.filter((c) => c.method === "getSignaturesForAddress"),
    ).toHaveLength(2);
  });
  it("holds when the captured scan bank is still live despite an earlier expired height response", async () => {
    const h = await setup();
    h.fallback.height = 501;
    h.fallback.epochHeights = [501, 500];
    const result = await reconcileAttempt(h.env, h.original);
    expect(result).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      txid: null,
    });
    expect(await h.locks()).toBe(2);
    expect(
      h.calls.some(
        (c) => c.host === "fallback.test" && c.method === "getEpochInfo",
      ),
    ).toBe(true);
    expect(
      h.calls.some(
        (c) =>
          c.host === "fallback.test" && c.method === "getSignaturesForAddress",
      ),
    ).toBe(false);
    h.fallback.epochHeights = [];
    expect(await reconcileAttempt(h.env, result)).toMatchObject({
      state: "EXPIRED_UNLANDED",
      safeToRetry: true,
      txid: null,
    });
  });
  it.each(["statusContext", "hashContext"] as const)(
    "known-ID absence holds for stale %s, then releases only with a fresh expired bank",
    async (field) => {
      const h = await setup(),
        { known } = await h.persistKnownAttempt();
      h.fallback[field] = 999;
      const first = await reconcileAttempt(h.env, known);
      expect(first).toMatchObject({
        state: "STATUS_UNKNOWN",
        safeToRetry: false,
        txid: known.txid,
      });
      expect(await h.locks()).toBe(2);
      h.fallback[field] = 1000;
      const second = await reconcileAttempt(h.env, first);
      expect(second).toMatchObject({
        state: "EXPIRED_UNLANDED",
        safeToRetry: true,
        txid: known.txid,
      });
      expect(await h.locks()).toBe(0);
      expect(h.calls.some((c) => c.method === "getSignaturesForAddress")).toBe(
        false,
      );
    },
  );
  it("known-ID finalized success remains verifiable despite stale null-status and blockhash contexts", async () => {
    const h = await setup(),
      { known, evidence } = await h.persistKnownAttempt();
    for (const state of [h.primary, h.fallback]) {
      state.statusContext = 999;
      state.hashContext = 999;
      state.metadata.set(known.txid!, evidence);
    }
    const result = await reconcileAttempt(h.env, known);
    expect(result).toMatchObject({
      state: "FINALIZED",
      safeToRetry: false,
      successObserved: true,
      receipt: { verified: true },
    });
    expect(await h.locks()).toBe(0);
  });
  it.each([
    "flag",
    "retention",
    "anchor",
    "missingAnchor",
    "height",
    "valid",
    "root",
    "hashContext",
    "provider",
    "sameHost",
  ])("holds when %s prevents authoritative completeness", async (condition) => {
    const h = await setup();
    if (condition === "flag") h.env.FALLBACK_ADDRESS_HISTORY_TRUSTED = "false";
    if (condition === "retention") h.fallback.firstAvailable = 101;
    if (condition === "anchor")
      h.fallback.anchor = {
        blockhash: Keypair.generate().publicKey.toBase58(),
      };
    if (condition === "missingAnchor") h.fallback.anchor = null;
    if (condition === "height") h.fallback.height = 500;
    if (condition === "valid") h.fallback.valid = true;
    if (condition === "root") h.fallback.root = 99;
    if (condition === "hashContext") h.fallback.hashContext = 999;
    if (condition === "provider") h.fallback.fail = "getSignaturesForAddress";
    if (condition === "sameHost")
      h.env.SOLANA_RPC_FALLBACK_URL = "https://primary.test/other-key";
    expect(await reconcileAttempt(h.env, h.original)).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      txid: null,
    });
    expect(await h.locks()).toBe(2);
  });
  it("includes context-slot transactions and verifies short-page exhaustion", async () => {
    const h = await setup(),
      other = h.unrelated(100);
    h.put(h.primary, other);
    h.put(h.fallback, other);
    const result = await reconcileAttempt(h.env, h.original);
    expect(result.safeToRetry).toBe(true);
    expect(h.calls.filter((c) => c.method === "getTransaction")).toHaveLength(
      2,
    );
    expect(
      h.calls.filter(
        (c) => c.method === "getSignaturesForAddress" && c.params[1].before,
      ),
    ).toHaveLength(2);
  });
  it("stops only below the original slot and does not fetch older metadata", async () => {
    const h = await setup(),
      older = h.unrelated(99);
    h.put(h.primary, older);
    h.put(h.fallback, older);
    expect((await reconcileAttempt(h.env, h.original)).safeToRetry).toBe(true);
    expect(h.calls.some((c) => c.method === "getTransaction")).toBe(false);
  });
  it.each([
    "notExhausted",
    "duplicate",
    "order",
    "missingMetadata",
    "wrongSlot",
    "malformed",
    "candidateCap",
  ])(
    "holds on %s rather than treating incomplete or malformed history as absence",
    async (condition) => {
      const h = await setup(),
        other = h.unrelated(101);
      const signature = h.put(h.primary, other);
      h.put(h.fallback, other);
      if (condition === "notExhausted") h.fallback.tail = [h.fallback.page[0]];
      if (condition === "duplicate") h.fallback.page.push(h.fallback.page[0]);
      if (condition === "order") {
        const newer = h.unrelated(102);
        h.put(h.fallback, newer);
        h.fallback.page.reverse();
      }
      if (condition === "missingMetadata")
        h.fallback.metadata.delete(signature);
      if (condition === "wrongSlot")
        h.fallback.metadata.set(signature, { ...other, slot: 103 });
      if (condition === "malformed") {
        const bytes = unb64(other.transaction[0]);
        bytes.fill(255, 65);
        h.fallback.metadata.set(signature, {
          ...other,
          transaction: [b64(bytes), "base64"],
        });
      }
      if (condition === "candidateCap") {
        h.put(h.fallback, h.unrelated(102));
        h.put(h.fallback, h.unrelated(103));
      }
      expect(await reconcileAttempt(h.env, h.original)).toMatchObject({
        state: "STATUS_UNKNOWN",
        safeToRetry: false,
        txid: null,
      });
      expect(await h.locks()).toBe(2);
    },
  );
  it("adopts a verified original success and derives its exact receipt without signing or broadcasting", async () => {
    const h = await setup(),
      evidence = h.signedEvidence();
    const txid = h.put(h.primary, evidence);
    h.put(h.fallback, evidence);
    const result = await reconcileAttempt(h.env, h.original);
    expect(result).toMatchObject({
      state: "FINALIZED",
      safeToRetry: false,
      txid,
      receipt: { verified: true },
      successObserved: true,
    });
    expect(result.fullWireBase64).toBe(evidence.transaction[0]);
    expect(result.messageBase64).toBe(h.original.messageBase64);
    expect(await h.locks()).toBe(0);
    expect(
      h.calls.some((c) => /send|simulate|LatestBlockhash/.test(c.method)),
    ).toBe(false);
  });
  it("adopts a finalized failure only after both complete searches", async () => {
    const h = await setup(),
      evidence = h.signedEvidence({ InstructionError: [7, { Custom: 1 }] });
    h.put(h.primary, evidence);
    h.put(h.fallback, evidence);
    const result = await reconcileAttempt(h.env, h.original);
    expect(result).toMatchObject({
      state: "FAILED_ONCHAIN",
      safeToRetry: true,
    });
    expect(result.txid).toBe(transactionId(unb64(evidence.transaction[0])));
    expect(await h.locks()).toBe(0);
  });
  it("does not promote partial failure discovery into a known-ID escape across reconciliations; later conflicting success remains held", async () => {
    const h = await setup(),
      failure = h.signedEvidence({ InstructionError: [7, { Custom: 1 }] });
    h.put(h.primary, failure);
    h.fallback.fail = "getSignaturesForAddress";
    const first = await reconcileAttempt(h.env, h.original);
    expect(first).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      txid: null,
      fullWireBase64: null,
    });
    const success = h.signedEvidence(null, 223),
      bytes = unb64(success.transaction[0]);
    const signature = alternateSignature(
      h.f.owners[0],
      wireParts(bytes).message,
    );
    expect(
      await verifyEd25519(
        h.f.terms.feePayer,
        signature,
        wireParts(bytes).message,
      ),
    ).toBe(true);
    bytes.set(signature, 1);
    success.transaction = [b64(bytes), "base64"];
    await verifyWireSignatures(bytes, h.f.plan, true);
    expect(transactionId(bytes)).not.toBe(
      transactionId(unb64(failure.transaction[0])),
    );
    h.fallback.fail = "";
    h.put(h.fallback, success);
    const second = await reconcileAttempt(h.env, first);
    expect(second).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      txid: null,
      successObserved: true,
    });
    expect(await h.locks()).toBe(2);
    expect(h.calls.some((c) => c.method === "getSignatureStatuses")).toBe(
      false,
    );
  });
  it("keeps exact-message success sticky when a later provider fails and then reports absence", async () => {
    const h = await setup(),
      success = h.signedEvidence();
    h.put(h.primary, success);
    h.fallback.fail = "getSignaturesForAddress";
    const first = await reconcileAttempt(h.env, h.original);
    expect(first).toMatchObject({
      txid: null,
      safeToRetry: false,
      successObserved: true,
    });
    h.primary.page = [];
    h.fallback.fail = "";
    const second = await reconcileAttempt(h.env, first);
    expect(second).toMatchObject({
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
      successObserved: true,
    });
    expect(await h.locks()).toBe(2);
  });
  it("preserves an already stored nonpayer partial signature", async () => {
    const h = await setup(),
      tx = Transaction.from(unb64(h.original.wireBase64));
    tx.partialSign(h.f.owners[1]);
    const partial = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const parts = wireParts(partial),
      original = {
        ...h.original,
        wireBase64: b64(partial),
        signatures: { [h.f.terms.owners[1]]: b64(parts.signatures[1]) },
      };
    await saveAttempt(h.db, original, h.original.state, h.original);
    const evidence = h.signedEvidence();
    h.put(h.primary, evidence);
    h.put(h.fallback, evidence);
    const result = await reconcileAttempt(h.env, original);
    expect(result.state).toBe("FINALIZED");
    expect(result.signatures[h.f.terms.owners[1]]).toBe(
      original.signatures[h.f.terms.owners[1]],
    );
  });
  it("bounded worst-case absence uses at most 22 RPCs and no replacement operations", async () => {
    const h = await setup();
    for (const state of [h.primary, h.fallback]) {
      h.put(state, h.unrelated(102));
      h.put(state, h.unrelated(101));
    }
    expect((await reconcileAttempt(h.env, h.original)).safeToRetry).toBe(true);
    expect(h.calls).toHaveLength(22);
    expect(
      h.calls.some((c) => /send|simulate|LatestBlockhash/.test(c.method)),
    ).toBe(false);
  });
});
