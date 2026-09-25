import { afterEach, describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { b64, sha256, unb64 } from "../src/shared/crypto";
import {
  buildTransaction,
  hashTerms,
  maximumAtaRentLamports,
  mergeSignature,
  transactionId,
  unsignedWire,
  wireParts,
} from "../src/shared/transactions";
import {
  receiptFromMetadata,
  type TransactionEvidence,
} from "../src/shared/receipt";
import type { Attempt, FrozenPlan, Room, Terms } from "../src/shared/types";
import { fixture } from "./fixtures";
import {
  fixtureKey,
  openRun,
  readJson,
  type Journal,
} from "../scripts/devnet-common";
import { createSeedPlan, type ApiSession } from "../scripts/devnet-board-seed";
import {
  assertHostedRegistry,
  expectedRingTerms,
  runHostedRehearsal,
  type HostedContext,
} from "../scripts/devnet-hosted-rehearsal";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
async function harness() {
  const directory = mkdtempSync(join(tmpdir(), "bb-hosted-rehearsal-test-"));
  directories.push(directory);
  const run = openRun(
    new Map([
      ["--run", "hosted-test"],
      ["--execute", "true"],
    ]),
    directory,
  );
  const assets = fixture(3).assets,
    origin = "https://barterbook.test";
  const seed = createSeedPlan(run, "seed-1", origin, assets),
    seedResult = {
      listingIds: ["listing-a", "listing-b", "listing-c"],
      roomId: "room-basket",
    };
  const wallets = new Map(
    [0, 1, 2].map((i) => {
      const key = fixtureKey(run, `wallet-${i}`);
      return [key.publicKey.toBase58(), key] as const;
    }),
  );
  const rooms = new Map<string, Room>();
  const basket: Room = {
    id: "room-basket",
    terms: seed.offer.body.terms,
    termsHash: await hashTerms(seed.offer.body.terms),
    members: seed.offer.body.terms.owners.map((wallet) => ({
      wallet,
      acceptedVersion: null,
      ready: false,
    })),
    state: "PROPOSED",
    attempt: null,
    createdAt: Date.now(),
    listingIds: [],
  };
  rooms.set(basket.id, basket);
  const calls: Array<{ owner: string; path: string; body?: unknown }> = [];
  const publicEvidence = new Map<string, object>();
  const failure = {
    submitOnce: false,
    ringCreateOnce: false,
    prepareOnce: false,
    extraInstruction: false,
    holdUnknown: false,
  };
  const context: HostedContext = {
    run,
    batch: "hosted-1",
    origin,
    root: join(run.privateRoot, "hosted", "hosted-1"),
    seed,
    seedResult,
    assets,
    wallets,
    sessions: new Map(),
    pollLimit: 1,
    sleep: async () => {},
  };
  async function prepare(room: Room): Promise<Attempt> {
    const plan: FrozenPlan = {
      terms: room.terms,
      assets,
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: "900",
      contextSlot: "10",
      computeUnitLimit: 300000,
      microLamports: "0",
      createAtas: [
        ...new Set(room.terms.legs.map((leg) => leg.destinationATA)),
      ],
      networkFeeLamports: String(room.terms.owners.length * 5000),
      accountRentLamports: room.terms.legs
        .reduce(
          (sum, leg) =>
            sum +
            BigInt(
              maximumAtaRentLamports(
                assets.find((asset) => asset.mint === leg.mint)!,
              ),
            ),
          0n,
        )
        .toString(),
    };
    const wire = unsignedWire(plan),
      messageBase64 = b64(wireParts(unb64(wire)).message);
    const attempt: Attempt = {
      id: `attempt-${room.id}`,
      roomId: room.id,
      termsHash: room.termsHash,
      plan,
      messageBase64,
      messageHash: await sha256(unb64(messageBase64)),
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
    if (failure.extraInstruction) {
      const tx = buildTransaction(plan);
      tx.add(
        SystemProgram.transfer({
          fromPubkey: wallets.get(room.terms.feePayer)!.publicKey,
          toPubkey: Keypair.generate().publicKey,
          lamports: 1,
        }),
      );
      attempt.wireBase64 = b64(
        tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      );
    }
    return attempt;
  }
  function metadata(attempt: Attempt): TransactionEvidence {
    const message = Transaction.from(
        unb64(attempt.fullWireBase64!),
      ).compileMessage(),
      keys = message.accountKeys.map((key) => key.toBase58());
    const tokenAccounts = new Map<
      string,
      {
        mint: string;
        owner: string;
        programId: string;
        decimals: number;
        delta: bigint;
      }
    >();
    for (const leg of attempt.plan.terms.legs) {
      tokenAccounts.set(leg.sourceAccount, {
        mint: leg.mint,
        owner: leg.fromOwner,
        programId: leg.tokenProgram,
        decimals: leg.decimals,
        delta: -BigInt(leg.grossRaw),
      });
      tokenAccounts.set(leg.destinationATA, {
        mint: leg.mint,
        owner: leg.toOwner,
        programId: leg.tokenProgram,
        decimals: leg.decimals,
        delta: BigInt(leg.netRaw),
      });
    }
    const tokenBalances = (post: boolean) =>
      [...tokenAccounts].map(([account, balance]) => ({
        accountIndex: keys.indexOf(account),
        mint: balance.mint,
        owner: balance.owner,
        programId: balance.programId,
        uiTokenAmount: {
          decimals: balance.decimals,
          amount: (100000000n + (post ? balance.delta : 0n)).toString(),
        },
      }));
    const fee = attempt.plan.terms.owners.length * 5000;
    return {
      slot: 100,
      blockTime: 1_700_000_000,
      transaction: [attempt.fullWireBase64!, "base64"],
      meta: {
        err: null,
        fee,
        preBalances: keys.map((_, i) => (i === 0 ? 1_000_000_000 : 2_000_000)),
        postBalances: keys.map((_, i) =>
          i === 0 ? 1_000_000_000 - fee : 2_000_000,
        ),
        preTokenBalances: tokenBalances(false),
        postTokenBalances: tokenBalances(true),
      },
    };
  }
  function finalize(attempt: Attempt): void {
    const evidence = metadata(attempt);
    attempt.state = "FINALIZED";
    attempt.receipt = receiptFromMetadata(attempt, evidence, true);
    publicEvidence.set(attempt.txid!, {
      cluster: "devnet",
      termsHash: attempt.termsHash,
      messageBase64: attempt.messageBase64,
      messageHash: attempt.messageHash,
      fullWireBase64: attempt.fullWireBase64!,
      transaction: evidence,
      buildId: "hosted-test-build",
    });
  }
  const session =
    (owner: string): ApiSession =>
    async <T>(path: string, body?: unknown): Promise<T> => {
      calls.push({ owner, path, ...(body === undefined ? {} : { body }) });
      const data = body as
        | {
            version?: number;
            termsHash?: string;
            ready?: boolean;
            wireBase64?: string;
          }
        | undefined;
      const response = (value: unknown) => structuredClone(value) as T;
      if (path === "/assets/fresh") return response({ assets });
      if (path === "/rooms") return response({ rooms: [...rooms.values()] });
      if (path === "/matches/room") {
        const terms = expectedRingTerms(seed, assets);
        const room: Room = {
          id: "room-ring",
          terms,
          termsHash: await hashTerms(terms),
          members: terms.owners.map((wallet) => ({
            wallet,
            acceptedVersion: null,
            ready: false,
          })),
          state: "PROPOSED",
          attempt: null,
          createdAt: Date.now(),
          listingIds: seedResult.listingIds,
        };
        rooms.set(room.id, room);
        if (failure.ringCreateOnce) {
          failure.ringCreateOnce = false;
          throw new Error("Lost ring creation response after commit");
        }
        return response({ room });
      }
      const roomMatch = path.match(
        /^\/rooms\/([^/]+)(?:\/(accept|ready|attempts))?$/,
      );
      if (roomMatch) {
        const room = rooms.get(roomMatch[1])!;
        const member = room.members.find(
          (candidate) => candidate.wallet === owner,
        );
        if (!member)
          throw new Error("Unauthenticated/nonmember request in mock API");
        if (!roomMatch[2]) return response({ room });
        if (data?.version !== room.terms.version)
          throw new Error("Wrong terms version");
        if (roomMatch[2] === "accept") {
          if (data.termsHash !== room.termsHash)
            throw new Error("Wrong consent hash");
          member.acceptedVersion = data.version;
          return response({ room });
        }
        if (roomMatch[2] === "ready") {
          if (member.acceptedVersion !== data.version)
            throw new Error("Ready without accepted terms");
          member.ready = data.ready!;
          return response({ room });
        }
        if (
          !room.members.every(
            (candidate) =>
              candidate.ready &&
              candidate.acceptedVersion === room.terms.version,
          ) ||
          room.attempt
        )
          throw new Error(
            "Prepare without all consent or duplicate executable attempt",
          );
        room.attempt = await prepare(room);
        if (failure.prepareOnce) {
          failure.prepareOnce = false;
          throw new Error("Lost prepare response after commit");
        }
        return response({ attempt: room.attempt });
      }
      const attemptMatch = path.match(
        /^\/attempts\/([^/]+)(?:\/(signatures|submit|reconcile))?$/,
      );
      if (attemptMatch) {
        const room = [...rooms.values()].find(
            (candidate) => candidate.attempt?.id === attemptMatch[1],
          )!,
          attempt = room.attempt!;
        if (!room.terms.owners.includes(owner))
          throw new Error("Nonowner attempt request");
        if (!attemptMatch[2]) return response({ attempt });
        if (attemptMatch[2] === "signatures") {
          const merged = await mergeSignature(
              unb64(attempt.wireBase64),
              unb64(data!.wireBase64!),
              owner,
              attempt.plan,
            ),
            parts = wireParts(merged);
          attempt.wireBase64 = b64(merged);
          attempt.signatures = Object.fromEntries(
            parts.signers.flatMap((signer, i) =>
              parts.signatures[i].some(Boolean)
                ? [[signer, b64(parts.signatures[i])]]
                : [],
            ),
          );
          if (parts.signatures[0].some(Boolean))
            attempt.txid = transactionId(merged);
          if (parts.signatures.every((signature) => signature.some(Boolean))) {
            attempt.fullWireBase64 = b64(merged);
            attempt.state = "FULLY_SIGNED";
          }
          return response({ attempt });
        }
        if (attemptMatch[2] === "submit") {
          const dir = join(
            context.root,
            room.terms.mode === "BASKET" ? "basket" : "ring",
          );
          const full = readJson<Journal>(join(dir, "full-signed.json"));
          expect(full.wireBase64).toBe(attempt.fullWireBase64);
          expect(full.txid).toBe(attempt.txid);
          expect(full.lastValidBlockHeight).toBe(
            Number(attempt.plan.lastValidBlockHeight),
          );
          expect(
            readJson<{ txid: string }>(join(dir, "submit-started.json")).txid,
          ).toBe(attempt.txid);
          attempt.submissionStartedAt = Date.now();
          attempt.state = "SUBMITTED";
          if (failure.submitOnce) {
            failure.submitOnce = false;
            throw new Error("Lost submit response after acceptance");
          }
          return response({ attempt });
        }
        if (attempt.submissionStartedAt) {
          if (failure.holdUnknown) attempt.state = "STATUS_UNKNOWN";
          else finalize(attempt);
        }
        return response({ attempt });
      }
      const evidence = path.match(/^\/receipts\/([^/]+)\/evidence$/);
      if (evidence) return response(publicEvidence.get(evidence[1]));
      throw new Error(`Unexpected API path ${path}`);
    };
  for (const wallet of wallets.keys())
    context.sessions.set(wallet, session(wallet));
  return { context, rooms, calls, failure };
}

describe("hosted SDK rehearsal safety", () => {
  it("refuses disabled/nondevnet deployments or absent/unvalidated registries", () => {
    const assets = fixture(3).assets,
      good = {
        cluster: "devnet",
        settlementEnabled: true,
        rpcConfigured: true,
      };
    expect(() => assertHostedRegistry(good, assets, assets)).not.toThrow();
    expect(() =>
      assertHostedRegistry(
        { ...good, settlementEnabled: false },
        assets,
        assets,
      ),
    ).toThrow(/enabled devnet/);
    expect(() =>
      assertHostedRegistry(
        { ...good, cluster: "mainnet-beta" },
        assets,
        assets,
      ),
    ).toThrow(/enabled devnet/);
    expect(() => assertHostedRegistry(good, [], assets)).toThrow(/registry/);
    expect(() =>
      assertHostedRegistry(
        good,
        assets.map((asset) => ({ ...asset, tested: false })),
        assets,
      ),
    ).toThrow(/registry/);
  });
  it("settles both exact SDK flows through consent, partial signatures and hosted API submission with locally verified final evidence", async () => {
    const { context, calls } = await harness();
    const results = await runHostedRehearsal(context);
    expect(results.map((attempt) => attempt.state)).toEqual([
      "FINALIZED",
      "FINALIZED",
    ]);
    expect(calls.filter((call) => call.path.endsWith("/accept"))).toHaveLength(
      5,
    );
    expect(calls.filter((call) => call.path.endsWith("/ready"))).toHaveLength(
      5,
    );
    expect(
      calls.filter((call) => call.path.endsWith("/signatures")),
    ).toHaveLength(5);
    for (const attempt of results) {
      const signed = calls.filter(
        (call) => call.path === `/attempts/${attempt.id}/signatures`,
      );
      expect(signed[0].owner).toBe(attempt.plan.terms.feePayer);
      for (const request of signed)
        expect(
          b64(
            wireParts(
              unb64((request.body as { wireBase64: string }).wireBase64),
            ).message,
          ),
        ).toBe(attempt.messageBase64);
      const archive = readJson<{
        txid: string;
        signingMethod: string;
        preservedMessage: boolean;
        receipt: { verified: boolean };
        rawApiEvidence: object;
      }>(
        join(
          context.run.evidenceRoot,
          `hosted-${context.batch}-${attempt.plan.terms.mode.toLowerCase()}-receipt.json`,
        ),
      );
      expect(archive).toMatchObject({
        txid: attempt.txid,
        preservedMessage: true,
        receipt: { verified: true },
      });
      expect(archive.signingMethod).toContain("NOT browser-wallet");
      expect(archive.rawApiEvidence).toBeTruthy();
    }
  });
  it("lost submit response resumes original success without another prepare, signature or submit", async () => {
    const { context, calls, failure } = await harness();
    failure.submitOnce = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /Lost submit response/,
    );
    const path = join(context.root, "basket", "full-signed.json"),
      original = readFileSync(path, "utf8");
    context.run.resume = true;
    const results = await runHostedRehearsal(context);
    expect(results[0].txid).toBe(JSON.parse(original).txid);
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(
      calls.filter((call) => call.path === "/rooms/room-basket/attempts"),
    ).toHaveLength(1);
    expect(
      calls.filter(
        (call) => call.path === "/attempts/attempt-room-basket/signatures",
      ),
    ).toHaveLength(2);
    expect(
      calls.filter(
        (call) => call.path === "/attempts/attempt-room-basket/submit",
      ),
    ).toHaveLength(1);
  });
  it("lost prepare response adopts the original server attempt without preparing another", async () => {
    const { context, calls, failure, rooms } = await harness();
    failure.prepareOnce = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /Lost prepare response/,
    );
    const original = rooms.get("room-basket")!.attempt!;
    context.run.resume = true;
    const results = await runHostedRehearsal(context);
    expect(results[0].id).toBe(original.id);
    expect(results[0].plan.blockhash).toBe(original.plan.blockhash);
    expect(
      calls.filter((call) => call.path === "/rooms/room-basket/attempts"),
    ).toHaveLength(1);
  });
  it("lost ring creation response finds that exact room and never creates a duplicate", async () => {
    const { context, calls, failure } = await harness();
    failure.ringCreateOnce = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /Lost ring creation/,
    );
    context.run.resume = true;
    expect((await runHostedRehearsal(context))[1].state).toBe("FINALIZED");
    expect(calls.filter((call) => call.path === "/matches/room")).toHaveLength(
      1,
    );
  });
  it("an unresolved submitted attempt stays frozen across repeated resumes, without replacement or another submit", async () => {
    const { context, calls, failure } = await harness();
    failure.holdUnknown = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /still STATUS_UNKNOWN/,
    );
    const original = readFileSync(
      join(context.root, "basket", "full-signed.json"),
      "utf8",
    );
    context.run.resume = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /still STATUS_UNKNOWN/,
    );
    expect(
      readFileSync(join(context.root, "basket", "full-signed.json"), "utf8"),
    ).toBe(original);
    expect(
      calls.filter((call) => call.path.endsWith("/attempts")),
    ).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(
      1,
    );
    expect(calls.some((call) => call.path === "/matches/room")).toBe(false);
  });
  it("rejects an extra server-supplied SOL instruction before any SDK signature", async () => {
    const { context, calls, failure } = await harness();
    failure.extraInstruction = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow();
    expect(
      calls.filter((call) => call.path.endsWith("/signatures")),
    ).toHaveLength(0);
    expect(existsSync(join(context.root, "basket", "full-signed.json"))).toBe(
      false,
    );
    expect(calls.filter((call) => call.path.endsWith("/submit"))).toHaveLength(
      0,
    );
  });
  it("a stopped original attempt cannot request new signatures or a new lifetime", async () => {
    const { context, calls, failure, rooms } = await harness();
    failure.prepareOnce = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /Lost prepare response/,
    );
    rooms.get("room-basket")!.attempt!.stopRequested = true;
    context.run.resume = true;
    await expect(runHostedRehearsal(context)).rejects.toThrow(
      /stopped or failed/,
    );
    expect(
      calls.filter((call) => call.path.endsWith("/attempts")),
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.path.endsWith("/signatures")),
    ).toHaveLength(0);
  });
});
