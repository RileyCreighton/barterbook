import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  AccountState,
  AccountType,
  ExtensionType,
  MintLayout,
  TOKEN_2022_PROGRAM_ID,
  TransferFeeConfigLayout,
  getAccountLen,
  getMintLen,
} from "@solana/spl-token";
import { fixture } from "./fixtures";
import { b64 } from "../src/shared/crypto";
import {
  buildTransaction,
  transactionId,
  verifyTransaction,
} from "../src/shared/transactions";
import {
  reconcileDecision,
  type ChainObservation,
} from "../src/shared/recovery";
import {
  receiptFromMetadata,
  type TransactionEvidence,
} from "../src/shared/receipt";
import { assertDevnet, preparePlan } from "../src/server/chain";
import type { Attempt, Asset, Env } from "../src/shared/types";

afterEach(() => vi.unstubAllGlobals());
const genesis = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const env = (assets: Asset[]) =>
  ({
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    SOLANA_RPC_URL: "https://rpc.invalid",
    DEVNET_ASSETS_JSON: JSON.stringify(assets),
  }) as Env;
const observed = (extra: Partial<ChainObservation> = {}): ChainObservation => ({
  endpoint: "primary",
  healthy: true,
  historyTrusted: true,
  finalizedBlockHeight: "501",
  blockhashValid: false,
  status: null,
  transactionFound: false,
  transactionErr: null,
  transactionFinalized: false,
  ...extra,
});

function receiptFixture() {
  const f = fixture();
  const transaction = buildTransaction(f.plan);
  transaction.partialSign(...f.owners);
  const wire = transaction.serialize();
  const keys = transaction
    .compileMessage()
    .accountKeys.map((k) => k.toBase58());
  const attempt = {
    plan: f.plan,
    messageBase64: b64(transaction.serializeMessage()),
    fullWireBase64: b64(wire),
    txid: transactionId(wire),
  } as Attempt;
  const evidence: TransactionEvidence = {
    slot: 100,
    transaction: [b64(wire), "base64"],
    meta: {
      err: null,
      fee: 10000,
      preBalances: keys.map(() => 100000000),
      postBalances: keys.map((_, i) => (i === 0 ? 99990000 : 100000000)),
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
  for (const leg of f.terms.legs)
    for (const [account, owner, delta] of [
      [leg.sourceAccount, leg.fromOwner, -BigInt(leg.grossRaw)],
      [leg.destinationATA, leg.toOwner, BigInt(leg.netRaw)],
    ] as const) {
      const balance = {
        accountIndex: keys.indexOf(account),
        mint: leg.mint,
        owner,
        programId: leg.tokenProgram,
        uiTokenAmount: { amount: "50000000", decimals: leg.decimals },
      };
      evidence.meta!.preTokenBalances!.push(balance);
      evidence.meta!.postTokenBalances!.push({
        ...balance,
        uiTokenAmount: {
          ...balance.uiTokenAmount,
          amount: (50000000n + delta).toString(),
        },
      });
    }
  return { attempt, evidence };
}

describe("adversarial signing costs and receipt identity", () => {
  it("rejects a server plan that understates an encoded priority fee beyond the accepted total SOL cap", () => {
    const f = fixture();
    f.terms.maxNetworkFeeLamports = "1";
    f.plan.networkFeeLamports = "0";
    f.plan.computeUnitLimit = 400000;
    f.plan.microLamports = "10000";
    // The encoded priority fee alone is 4,000 lamports, irrespective of base fees.
    expect(() => {
      const wire = buildTransaction(f.plan).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      verifyTransaction(wire, f.plan, f.terms);
    }).toThrow();
  });
  it("rejects duplicate account-index entries in transaction token metadata", () => {
    const { attempt, evidence } = receiptFixture();
    evidence.meta!.preTokenBalances!.push({
      ...evidence.meta!.preTokenBalances![0],
    });
    expect(() => receiptFromMetadata(attempt, evidence)).toThrow();
  });
  it("rejects a matching-message receipt carrying different full signed bytes", () => {
    const { attempt, evidence } = receiptFixture();
    const wire = Buffer.from(evidence.transaction[0], "base64");
    wire[65] ^= 1;
    evidence.transaction[0] = wire.toString("base64");
    expect(() => receiptFromMetadata(attempt, evidence)).toThrow();
  });
  it("rejects unsafe integer RPC network fees rather than rounding", () => {
    const { attempt, evidence } = receiptFixture();
    evidence.meta!.fee = Number.MAX_SAFE_INTEGER + 2;
    expect(() => receiptFromMetadata(attempt, evidence)).toThrow(/Unsafe/);
  });
});

describe("prior-success and inconsistent-history recovery", () => {
  it("recovers original success from transaction metadata even when signature status is missing", () => {
    const attempt = {
      plan: fixture().plan,
      txid: "original",
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
    } as Attempt;
    const decision = reconcileDecision(attempt, [
      observed(),
      observed({
        endpoint: "fallback",
        transactionFound: true,
        transactionErr: null,
        transactionFinalized: true,
      }),
    ]);
    expect(decision).toMatchObject({ state: "FINALIZED", safeToRetry: false });
  });
  it("holds a formerly confirmed attempt when current histories contradict its prior success", () => {
    const attempt = {
      plan: fixture().plan,
      txid: "original",
      state: "CONFIRMED",
      safeToRetry: false,
      receipt: { verified: true },
    } as Attempt;
    expect(
      reconcileDecision(attempt, [
        observed(),
        observed({ endpoint: "fallback" }),
      ]),
    ).toMatchObject({ state: "STATUS_UNKNOWN", safeToRetry: false });
  });
  it("does not ignore a third healthy endpoint that still sees processing", () => {
    const attempt = {
      plan: fixture().plan,
      txid: "original",
      state: "STATUS_UNKNOWN",
      safeToRetry: false,
    } as Attempt;
    expect(
      reconcileDecision(attempt, [
        observed(),
        observed({ endpoint: "fallback" }),
        observed({
          endpoint: "third",
          status: { confirmation: "processed", err: null },
        }),
      ]),
    ).toMatchObject({ state: "STATUS_UNKNOWN", safeToRetry: false });
  });
});

describe("live preparation network and ATA rent safety", () => {
  it("accepts the full official devnet genesis hash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: genesis }),
      ),
    );
    await expect(assertDevnet(env([]))).resolves.toBeUndefined();
  });
  it("prices the ImmutableOwner extension added by Token-2022 ATA creation", async () => {
    const f = fixture();
    const payer = f.owners[0].publicKey;
    const mintInfos = new Map<string, unknown>();
    const sourceInfos = new Map<string, unknown>();
    const rentedSizes: number[] = [];
    function info(data: Buffer) {
      return {
        data: [b64(data), "base64"],
        owner: TOKEN_2022_PROGRAM_ID.toBase58(),
        lamports: 5000000,
        executable: false,
        rentEpoch: 0,
      };
    }
    for (const asset of f.assets) {
      const data = Buffer.alloc(getMintLen([ExtensionType.TransferFeeConfig]));
      MintLayout.encode(
        {
          mintAuthorityOption: 1,
          mintAuthority: payer,
          supply: 1000000000n,
          decimals: asset.decimals,
          isInitialized: true,
          freezeAuthorityOption: 0,
          freezeAuthority: PublicKey.default,
        },
        data,
      );
      data[165] = AccountType.Mint;
      data.writeUInt16LE(ExtensionType.TransferFeeConfig, 166);
      data.writeUInt16LE(TransferFeeConfigLayout.span, 168);
      const schedule = (epoch: bigint, bps: number) => ({
        epoch,
        maximumFee: 1000000000n,
        transferFeeBasisPoints: bps,
      });
      TransferFeeConfigLayout.encode(
        {
          transferFeeConfigAuthority: payer,
          withdrawWithheldAuthority: payer,
          withheldAmount: 0n,
          olderTransferFee: schedule(0n, 100),
          newerTransferFee: schedule(100n, 300),
        },
        data.subarray(170),
      );
      mintInfos.set(asset.mint, info(data));
    }
    for (const leg of f.terms.legs) {
      const data = Buffer.alloc(
        getAccountLen([
          ExtensionType.TransferFeeAmount,
          ExtensionType.ImmutableOwner,
        ]),
      );
      AccountLayout.encode(
        {
          mint: new PublicKey(leg.mint),
          owner: new PublicKey(leg.fromOwner),
          amount: 1000000000n,
          delegateOption: 0,
          delegate: PublicKey.default,
          state: AccountState.Initialized,
          isNativeOption: 0,
          isNative: 0n,
          delegatedAmount: 0n,
          closeAuthorityOption: 0,
          closeAuthority: PublicKey.default,
        },
        data,
      );
      data[165] = AccountType.Account;
      data.writeUInt16LE(ExtensionType.TransferFeeAmount, 166);
      data.writeUInt16LE(8, 168);
      data.writeUInt16LE(ExtensionType.ImmutableOwner, 178);
      data.writeUInt16LE(0, 180);
      sourceInfos.set(leg.sourceAccount, info(data));
    }
    const hash = Keypair.generate().publicKey.toBase58();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const { method, params } = JSON.parse(options.body as string);
        let result: unknown;
        switch (method) {
          case "getGenesisHash":
            result = genesis;
            break;
          case "getEpochInfo":
            result = { epoch: 1, absoluteSlot: 100 };
            break;
          case "getMultipleAccounts":
            result = {
              context: { slot: 100 },
              value: (params[0] as string[]).map(
                (address) =>
                  mintInfos.get(address) ?? sourceInfos.get(address) ?? null,
              ),
            };
            break;
          case "getMinimumBalanceForRentExemption":
            rentedSizes.push(params[0]);
            result = params[0] * 10000;
            break;
          case "getLatestBlockhash":
            result = {
              context: { slot: 100 },
              value: { blockhash: hash, lastValidBlockHeight: 500 },
            };
            break;
          case "simulateTransaction":
            result = {
              context: { slot: 100 },
              value: { err: null, unitsConsumed: 100000 },
            };
            break;
          case "getFeeForMessage":
            result = { context: { slot: 100 }, value: 10000 };
            break;
          case "getBalance":
            result = { context: { slot: 100 }, value: 1000000000 };
            break;
          default:
            throw new Error(`Unexpected fixture RPC ${method}`);
        }
        return Response.json({ jsonrpc: "2.0", id: 1, result });
      }),
    );
    const plan = await preparePlan(env(f.assets), f.terms);
    expect(rentedSizes).toEqual([182]); // One fresh quote for the shared size.
    expect(plan.accountRentLamports).toBe("6472800");
  });
});
