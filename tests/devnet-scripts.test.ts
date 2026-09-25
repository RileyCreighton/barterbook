import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  type TransactionResponse,
} from "@solana/web3.js";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";
import { Hono } from "hono";
import {
  connection,
  fixtureKey,
  immutableJson,
  journalPath,
  openRun,
  participants,
  readJson,
  readRpc,
  sendFixtureTransaction,
  validateJournal,
  tokenDelta,
  type Journal,
  type Run,
} from "../scripts/devnet-common";
import {
  allowFaucetRequest,
  type FundingInspection,
} from "../scripts/devnet-faucet";
import {
  authenticateSdkWallet,
  createSeedPlan,
  executeSeedPlan,
  type ApiSession,
} from "../scripts/devnet-board-seed";
import { createAuthRouter, type AppContext } from "../src/server/auth";
import { createBoardRouter } from "../src/server/board";
import { sha256 } from "../src/shared/crypto";
import {
  ata,
  buildTransaction,
  validateTerms,
  wireParts,
} from "../src/shared/transactions";
import { testDatabase } from "./db-fixture";
import { fixture } from "./fixtures";
import type { Env } from "../src/shared/types";

const directories: string[] = [];
const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of directories.splice(0))
    rmSync(dir, { recursive: true, force: true });
  for (const db of databases.splice(0)) db.close();
});
function runFixture(): Run {
  const base = mkdtempSync(join(tmpdir(), "barterbook-script-test-"));
  directories.push(base);
  return openRun(
    new Map([
      ["--run", "test-run"],
      ["--execute", "true"],
      ["--resume", "true"],
    ]),
    base,
  );
}
function signedJournal(run: Run): Journal {
  const key = fixtureKey(run, "wallet-0");
  const tx = new Transaction({
    feePayer: key.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: key.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  tx.sign(key);
  return {
    schemaVersion: 1,
    runId: run.runId,
    buildId: run.buildId,
    name: "probe",
    cluster: "devnet",
    txid: bs58.encode(tx.signature!),
    wireBase64: Buffer.from(tx.serialize()).toString("base64"),
    messageBase64: Buffer.from(tx.serializeMessage()).toString("base64"),
    blockhash: tx.recentBlockhash!,
    lastValidBlockHeight: 10,
    createdAt: new Date().toISOString(),
    expectedFailure: false,
  };
}

describe("immutable devnet evidence and transaction journals", () => {
  it("preserves original key/attempt/evidence bytes and rejects changed writes", () => {
    const run = runFixture(),
      key = fixtureKey(run, "wallet-0"),
      path = join(run.privateRoot, "wallet-0.json");
    const original = readFileSync(path);
    expect(fixtureKey(run, "wallet-0").publicKey.equals(key.publicKey)).toBe(
      true,
    );
    expect(Buffer.from(readFileSync(path)).equals(Buffer.from(original))).toBe(
      true,
    );
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(() => immutableJson(path, { secretKey: [1] }, true)).toThrow(
      /Immutable/,
    );
    const journal = signedJournal(run),
      target = journalPath(run, journal.name);
    immutableJson(target, journal, true);
    immutableJson(target, journal, true);
    expect(() =>
      immutableJson(target, { ...journal, blockhash: "changed" }, true),
    ).toThrow(/Immutable/);
    expect(() =>
      validateJournal({
        ...journal,
        txid: Keypair.generate().publicKey.toBase58(),
      }),
    ).toThrow(/identity/);
  });
  it("can add public browser recipients without changing the original SDK manifest", () => {
    const run = runFixture();
    participants(run);
    const original = readFileSync(join(run.evidenceRoot, "participants.json"));
    const file = join(run.privateRoot, "browser-public.json"),
      address = Keypair.generate().publicKey.toBase58();
    immutableJson(file, [{ address, label: "New browser wallet" }]);
    expect(participants(run, file)).toHaveLength(4);
    expect(participants(run, file)).toHaveLength(4);
    expect(
      Buffer.from(
        readFileSync(join(run.evidenceRoot, "participants.json")),
      ).equals(Buffer.from(original)),
    ).toBe(true);
    expect(
      participants(run).find((p) => p.publicKey === address)?.signingEvidence,
    ).toBe("not-yet-proven");
  });
  it("persists exact full bytes, local ID, lifetime and submission marker before send; timeout then success never replaces them", async () => {
    const run = runFixture(),
      key = fixtureKey(run, "wallet-0"),
      blockhash = Keypair.generate().publicKey.toBase58();
    const latest = vi
      .spyOn(connection, "getLatestBlockhash")
      .mockResolvedValue({ blockhash, lastValidBlockHeight: 10 });
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 1 },
      value: { err: null, logs: [] },
    });
    let receipt: TransactionResponse;
    const sender = vi
      .spyOn(connection, "sendRawTransaction")
      .mockImplementation(async (bytes) => {
        const saved = readJson<Journal>(journalPath(run, "probe"));
        expect(saved.wireBase64).toBe(Buffer.from(bytes).toString("base64"));
        expect(saved.lastValidBlockHeight).toBe(10);
        const events = readdirSync(
          join(run.privateRoot, "transactions", "probe", "events"),
        ).map((f) =>
          readJson<{ state: string }>(
            join(run.privateRoot, "transactions", "probe", "events", f),
          ),
        );
        expect(events.some((e) => e.state === "SUBMISSION_STARTED")).toBe(true);
        const tx = Transaction.from(bytes);
        receipt = {
          slot: 5,
          blockTime: 1_700_000_000,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [10000, 0],
            postBalances: [4999, 1],
            preTokenBalances: [],
            postTokenBalances: [],
            logMessages: [],
          },
          transaction: {
            signatures: [saved.txid],
            message: tx.compileMessage(),
          },
        };
        throw new Error("Timeout after actual acceptance");
      });
    vi.spyOn(connection, "getSignatureStatuses").mockImplementation(
      async () => ({
        context: { slot: 6 },
        value: [
          {
            slot: 5,
            confirmations: null,
            err: null,
            confirmationStatus: "finalized",
          },
        ],
      }),
    );
    vi.spyOn(connection, "getTransaction").mockImplementation(
      async () => receipt,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                slot: receipt.slot,
                blockTime: receipt.blockTime,
                meta: receipt.meta,
                transaction: [
                  readJson<Journal>(journalPath(run, "probe")).wireBase64,
                  "base64",
                ],
              },
            }),
          ),
      ),
    );
    const build = vi.fn(() =>
      new Transaction({
        feePayer: key.publicKey,
        recentBlockhash: blockhash,
      }).add(
        SystemProgram.transfer({
          fromPubkey: key.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      ),
    );
    const first = await sendFixtureTransaction(run, "probe", build, [key]);
    const journal = readFileSync(journalPath(run, "probe"));
    const second = await sendFixtureTransaction(run, "probe", build, [key]);
    expect(second.transaction.signatures).toEqual(first.transaction.signatures);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(
      Buffer.from(readFileSync(journalPath(run, "probe"))).equals(
        Buffer.from(journal),
      ),
    ).toBe(true);
    expect(existsSync(join(run.evidenceRoot, "probe-transaction.json"))).toBe(
      true,
    );
  });
  it("unresolved expiry never fetches a fresh blockhash or builds a replacement", async () => {
    const run = runFixture(),
      journal = signedJournal(run);
    immutableJson(journalPath(run, "probe"), journal, true);
    vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 20 },
      value: [null],
    });
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(11);
    vi.spyOn(connection, "getTransaction").mockResolvedValue(null);
    const latest = vi.spyOn(connection, "getLatestBlockhash"),
      sender = vi.spyOn(connection, "sendRawTransaction"),
      build = vi.fn();
    await expect(
      sendFixtureTransaction(run, "probe", build, [
        fixtureKey(run, "wallet-0"),
      ]),
    ).rejects.toThrow(/single endpoint/);
    expect(latest).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });
});

describe("explicit faucet retries", () => {
  const current = (now: number): FundingInspection => ({
    checkedAt: new Date(now).toISOString(),
    wallet: "test",
    finalizedLamports: "0",
    history: [],
    priorRequests: [
      { at: new Date(now - 3_600_000).toISOString(), state: "REQUEST_STARTED" },
    ],
  });
  it("requires fresh inspection, explicit retry, zero balance/history and cooldown; unresolved signatures remain blocked", () => {
    const now = Date.now(),
      good = current(now);
    expect(() => allowFaucetRequest(good, true, now)).not.toThrow();
    expect(() => allowFaucetRequest(good, false, now)).toThrow(/--retry/);
    expect(() =>
      allowFaucetRequest({ ...good, finalizedLamports: "1" }, true, now),
    ).toThrow(/already/);
    expect(() => allowFaucetRequest(good, true, now + 61_000)).toThrow(/Fresh/);
    expect(() =>
      allowFaucetRequest(
        {
          ...good,
          priorRequests: [
            { at: new Date(now).toISOString(), state: "REQUEST_STARTED" },
          ],
        },
        true,
        now,
      ),
    ).toThrow(/15 minutes/);
    expect(() =>
      allowFaucetRequest(
        {
          ...good,
          priorRequests: [
            { ...good.priorRequests[0], txid: "returned-signature" },
          ],
        },
        true,
        now,
      ),
    ).toThrow(/unresolved/);
  });
  it("uses bounded exponential backoff for rate-limited reads", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("429"))
      .mockRejectedValueOnce(new Error("rate limit"))
      .mockResolvedValue("read result");
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await readRpc(read, sleep)).toBe("read result");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000]);
  });
});

describe("normal authenticated HTTP board reseeding", () => {
  it("signs real one-use auth challenges, reuses persisted exact intents after a dropped response and leaves consent pending", async () => {
    const run = runFixture(),
      db = testDatabase();
    databases.push(db);
    const assets = fixture(3).assets,
      origin = "https://barterbook.test";
    const app = new Hono<AppContext>();
    app.get("/api/health", (c) => c.json({ cluster: "devnet" }));
    app.route("/api/auth", createAuthRouter());
    app.route(
      "/api",
      createBoardRouter({
        getAssets: async () => assets,
        getHoldings: async (_env, wallet) =>
          assets.map((asset) => ({
            asset,
            account: ata(wallet, asset.mint, asset.tokenProgram),
            amountRaw: "1000000000",
            supported: true,
            checkedAt: Date.now(),
          })),
        validateTerms,
      }),
    );
    const env = {
      DB: db,
      APP_ORIGIN: origin,
      SOLANA_CLUSTER: "devnet",
    } as unknown as Env;
    let dropResponse = true;
    const transport = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await app.fetch(new Request(input, init), env);
      if (
        new URL(String(input)).pathname === "/api/listings" &&
        init?.method === "POST" &&
        dropResponse
      ) {
        dropResponse = false;
        throw new Error("Dropped response after server committed");
      }
      return response;
    }) as typeof fetch;
    const plan = createSeedPlan(run, "judge-1", origin, assets),
      sessions = new Map<string, ApiSession>();
    for (let i = 0; i < 3; i++) {
      const wallet = fixtureKey(run, `wallet-${i}`);
      sessions.set(
        wallet.publicKey.toBase58(),
        await authenticateSdkWallet(origin, wallet, transport),
      );
    }
    await expect(executeSeedPlan(plan, sessions)).rejects.toThrow(
      /Dropped response/,
    );
    const resumed = createSeedPlan(
      run,
      "judge-1",
      origin,
      assets,
      Date.now() + 60_000,
    );
    expect(resumed).toEqual(plan);
    const first = await executeSeedPlan(resumed, sessions),
      second = await executeSeedPlan(resumed, sessions);
    expect(second.listings.map((l) => l.id)).toEqual(
      first.listings.map((l) => l.id),
    );
    expect(second.room.id).toBe(first.room.id);
    expect(
      await db.prepare("SELECT count(*) AS n FROM listings").first("n"),
    ).toBe(3);
    expect(await db.prepare("SELECT count(*) AS n FROM rooms").first("n")).toBe(
      1,
    );
    expect(
      await db.prepare("SELECT count(*) AS n FROM attempts").first("n"),
    ).toBe(0);
    expect(
      first.room.members.every((p) => p.acceptedVersion === null && !p.ready),
    ).toBe(true);
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM auth_challenges WHERE consumed_at IS NOT NULL",
        )
        .first("n"),
    ).toBe(3);
  });
  it("rejects a challenge for another origin before disclosing any signature", async () => {
    const wallet = Keypair.generate(),
      calls: string[] = [];
    const transport = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      return new Response(
        JSON.stringify(
          path.endsWith("health")
            ? { cluster: "devnet" }
            : {
                id: "nonce",
                wallet: wallet.publicKey.toBase58(),
                origin: "https://attacker.test",
                cluster: "devnet",
                expiresAt: Date.now() + 60_000,
                message: "arbitrary message",
              },
        ),
      );
    }) as typeof fetch;
    await expect(
      authenticateSdkWallet("https://barterbook.test", wallet, transport),
    ).rejects.toThrow(/challenge scope/);
    expect(calls).not.toContain("/api/auth/verify");
  });
});

describe("devnet recovery boundaries", () => {
  it("finds finalized metadata despite absent status and preserves archived success despite later RPC pruning and low funding", async () => {
    const run = runFixture(),
      journal = signedJournal(run);
    immutableJson(journalPath(run, "probe"), journal, true);
    const tx = Transaction.from(Buffer.from(journal.wireBase64, "base64"));
    const receipt: TransactionResponse = {
      slot: 10,
      blockTime: 1_700_000_000,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [10000, 0],
        postBalances: [4999, 1],
        preTokenBalances: [],
        postTokenBalances: [],
      },
      transaction: { signatures: [journal.txid], message: tx.compileMessage() },
    };
    const status = vi
      .spyOn(connection, "getSignatureStatuses")
      .mockResolvedValue({ context: { slot: 11 }, value: [null] });
    const metadata = vi
      .spyOn(connection, "getTransaction")
      .mockResolvedValue(receipt);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                slot: receipt.slot,
                blockTime: receipt.blockTime,
                meta: receipt.meta,
                transaction: [journal.wireBase64, "base64"],
              },
            }),
          ),
      ),
    );
    const funding = vi.fn(async () => {
      throw new Error("insufficient faucet SOL");
    });
    run.beforeBroadcast = funding;
    const sender = vi.spyOn(connection, "sendRawTransaction"),
      latest = vi.spyOn(connection, "getLatestBlockhash"),
      build = vi.fn();
    const result = await sendFixtureTransaction(run, "probe", build, []);
    expect(result.transaction.signatures[0]).toBe(journal.txid);
    status.mockRejectedValue(new Error("pruned status history"));
    metadata.mockResolvedValue(null);
    const prior = await sendFixtureTransaction(run, "probe", build, []);
    expect(prior.transaction.signatures[0]).toBe(journal.txid);
    expect(status).toHaveBeenCalledTimes(1);
    expect(metadata).toHaveBeenCalledTimes(1);
    expect(funding).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });
  it("recovers SDK signing evidence from its durable frozen wire after a crash before evidence publication", async () => {
    const run = runFixture(),
      f = fixture(3),
      transaction = buildTransaction(f.plan);
    transaction.partialSign(...f.owners);
    const bytes = transaction.serialize(),
      messageHash = await sha256(wireParts(bytes).message);
    const journal: Journal = {
      schemaVersion: 1,
      runId: run.runId,
      buildId: run.buildId,
      name: "sdk-proof",
      cluster: "devnet",
      txid: bs58.encode(transaction.signature!),
      wireBase64: Buffer.from(bytes).toString("base64"),
      messageBase64: Buffer.from(transaction.serializeMessage()).toString(
        "base64",
      ),
      blockhash: f.plan.blockhash,
      lastValidBlockHeight: Number(f.plan.lastValidBlockHeight),
      createdAt: new Date().toISOString(),
      expectedFailure: false,
      sdkSigning: {
        plan: f.plan,
        messageHashesAfterEachSignature: f.owners.map(() => messageHash),
      },
    };
    immutableJson(journalPath(run, journal.name), journal, true);
    const evidencePath = join(
      run.evidenceRoot,
      `${journal.name}-sdk-signing.json`,
    );
    expect(existsSync(evidencePath)).toBe(false);
    vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 999 },
      value: [null],
    });
    vi.spyOn(connection, "getTransaction").mockResolvedValue(null);
    vi.spyOn(connection, "getBlockHeight").mockResolvedValue(
      journal.lastValidBlockHeight + 1,
    );
    const build = vi.fn(),
      sender = vi.spyOn(connection, "sendRawTransaction"),
      latest = vi.spyOn(connection, "getLatestBlockhash");
    run.beforeBroadcast = async () => {
      throw new Error("insufficient faucet SOL");
    };
    await expect(
      sendFixtureTransaction(run, journal.name, build, f.owners),
    ).rejects.toThrow(/single endpoint/);
    expect(
      readJson<{ txid: string; messageHash: string; terms: unknown }>(
        evidencePath,
      ),
    ).toMatchObject({ txid: journal.txid, messageHash, terms: f.terms });
    expect(readJson<Journal>(journalPath(run, journal.name))).toEqual(journal);
    expect(build).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
  });
  it("requires funding before building a new executable transaction", async () => {
    const run = runFixture(),
      build = vi.fn(),
      latest = vi.spyOn(connection, "getLatestBlockhash");
    run.beforeBroadcast = async () => {
      throw new Error("insufficient faucet SOL");
    };
    await expect(
      sendFixtureTransaction(run, "unbuilt", build, []),
    ).rejects.toThrow(/insufficient/);
    expect(build).not.toHaveBeenCalled();
    expect(latest).not.toHaveBeenCalled();
    expect(existsSync(journalPath(run, "unbuilt"))).toBe(false);
  });
});

describe("strict SDK transaction-specific token receipts", () => {
  function receiptFixture() {
    const f = fixture(),
      leg = f.terms.legs[0],
      tx = buildTransaction(f.plan),
      message = tx.compileMessage();
    const index = message.accountKeys.findIndex(
      (key) => key.toBase58() === leg.sourceAccount,
    );
    const balance = {
      accountIndex: index,
      mint: leg.mint,
      owner: leg.fromOwner,
      programId: leg.tokenProgram,
      uiTokenAmount: {
        amount: "100001",
        decimals: leg.decimals,
        uiAmount: null,
      },
    };
    const receipt: TransactionResponse = {
      slot: 5,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [],
        postBalances: [],
        preTokenBalances: [structuredClone(balance)],
        postTokenBalances: [
          {
            ...structuredClone(balance),
            uiTokenAmount: { ...balance.uiTokenAmount, amount: "0" },
          },
        ],
      },
      transaction: { signatures: [], message },
    };
    return {
      receipt,
      leg,
      expected: {
        owner: leg.fromOwner,
        programId: leg.tokenProgram,
        decimals: leg.decimals,
      },
    };
  }
  it("calculates a raw delta only for one exact account identity", () => {
    const { receipt, leg, expected } = receiptFixture();
    expect(tokenDelta(receipt, leg.sourceAccount, leg.mint, expected)).toBe(
      -100001n,
    );
  });
  it.each([
    "duplicate",
    "out-of-range index",
    "wrong mint",
    "wrong owner",
    "wrong program",
    "missing program",
    "wrong decimals",
    "noncanonical raw",
    "u64 overflow",
  ])("rejects %s before marking a receipt verified", (attack) => {
    const { receipt, leg, expected } = receiptFixture(),
      meta = receipt.meta!,
      post = meta.postTokenBalances![0];
    switch (attack) {
      case "duplicate":
        meta.postTokenBalances!.push({
          ...post,
          uiTokenAmount: { ...post.uiTokenAmount, amount: "999999" },
        });
        break;
      case "out-of-range index":
        post.accountIndex = 999;
        break;
      case "wrong mint":
        post.mint = Keypair.generate().publicKey.toBase58();
        break;
      case "wrong owner":
        post.owner = Keypair.generate().publicKey.toBase58();
        break;
      case "wrong program":
        post.programId = SystemProgram.programId.toBase58();
        break;
      case "missing program":
        delete post.programId;
        break;
      case "wrong decimals":
        post.uiTokenAmount.decimals = 99;
        break;
      case "noncanonical raw":
        post.uiTokenAmount.amount = "01";
        break;
      case "u64 overflow":
        post.uiTokenAmount.amount = "18446744073709551616";
        break;
    }
    expect(() =>
      tokenDelta(receipt, leg.sourceAccount, leg.mint, expected),
    ).toThrow();
  });
});
