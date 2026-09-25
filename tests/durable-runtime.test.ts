import { expect, it } from "vitest";
import { FailedTransactionMetadata } from "litesvm";
import {
  NonceAccount,
  PublicKey,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  createLocalFixture,
  localLegs,
  localTokenAccount,
} from "../scripts/local-runtime";
import {
  buildTransaction,
  maximumAtaRentLamports,
  verifyWireSignatures,
} from "../src/shared/transactions";
import {
  nonceAddress,
  buildNonceOperation,
  verifyNonceOperation,
  decodeNonceAccount,
  type NonceOperationPlan,
} from "../src/shared/nonce";
import type { FrozenPlan, Terms } from "../src/shared/types";
import { b64 } from "../src/shared/crypto";
import {
  reconcileDecision,
  type ChainObservation,
} from "../src/shared/recovery";
import type { Attempt } from "../src/shared/types";

async function prepared(mode: "BASKET" | "RING") {
  const f = createLocalFixture(mode),
    payer = f.owners[0],
    wallet = payer.publicKey.toBase58();
  const address = await nonceAddress(wallet);
  const setup: NonceOperationPlan = {
    kind: "setup",
    wallet,
    nonceAccount: address,
    blockhash: f.svm.latestBlockhash(),
    contextSlot: "0",
    lastValidBlockHeight: "150",
    rentLamports: String(f.svm.minimumBalanceForRentExemption(80n)),
    networkFeeLamports: "5000",
  };
  const setupTx = await buildNonceOperation(setup);
  setupTx.sign(payer);
  await verifyNonceOperation(setupTx.serialize(), setup, true);
  const setupResult = f.svm.sendTransaction(setupTx);
  expect(
    setupResult instanceof FailedTransactionMetadata,
    setupResult.toString(),
  ).toBe(false);
  const readNonce = () =>
    NonceAccount.fromAccountData(
      Buffer.from(f.svm.getAccount(new PublicKey(address))!.data),
    ).nonce;
  const nonce = readNonce();
  const legs = localLegs(f, mode);
  const rent = f.assets
    .reduce((sum, a) => sum + BigInt(maximumAtaRentLamports(a)), 0n)
    .toString();
  const terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode,
    owners: f.owners.map((k) => k.publicKey.toBase58()),
    feePayer: wallet,
    nonceAccount: address,
    maxNetworkFeeLamports: "50000",
    maxAccountRentLamports: rent,
    legs,
    minima: legs.map((l) => ({
      owner: l.toOwner,
      mint: l.mint,
      minNetRaw: l.netRaw,
    })),
    expiresAt: Date.now() + 3600000,
  };
  const plan: FrozenPlan = {
    terms,
    assets: f.assets,
    blockhash: nonce,
    lastValidBlockHeight: "0",
    contextSlot: "0",
    computeUnitLimit: 300000,
    microLamports: "0",
    createAtas: legs.map((l) => l.destinationATA),
    networkFeeLamports: String(f.owners.length * 5000),
    accountRentLamports: rent,
  };
  const trade = buildTransaction(plan);
  for (const signer of f.owners) {
    // The network advances between approvals. No existing signature is replaced.
    f.svm.expireBlockhash();
    f.svm.warpToSlot(f.svm.getClock().slot + 1000n);
    trade.partialSign(signer);
  }
  await verifyWireSignatures(trade.serialize(), plan, true);
  const cancelPlan: NonceOperationPlan = {
    ...setup,
    kind: "cancel",
    blockhash: nonce,
    lastValidBlockHeight: "0",
    rentLamports: "0",
    attemptId: "local-original",
  };
  const cancel = await buildNonceOperation(cancelPlan);
  cancel.sign(payer);
  return { ...f, plan, trade, cancel, cancelPlan, readNonce, nonce };
}

for (const mode of ["BASKET", "RING"] as const)
  it(`LOCAL ${mode} executes after blockhash changes between every participant and rejects replay`, async () => {
    const f = await prepared(mode);
    const before = f.plan.terms.legs.map(
      (l) => localTokenAccount(f.svm, l.sourceAccount).amount,
    );
    const result = f.svm.sendTransaction(f.trade);
    expect(result instanceof FailedTransactionMetadata, result.toString()).toBe(
      false,
    );
    f.plan.terms.legs.forEach((leg, i) => {
      expect(localTokenAccount(f.svm, leg.sourceAccount).amount).toBe(
        before[i] - BigInt(leg.grossRaw),
      );
      expect(localTokenAccount(f.svm, leg.destinationATA).amount).toBe(
        BigInt(leg.netRaw),
      );
    });
    expect(f.readNonce()).not.toBe(f.nonce);
    expect(f.svm.sendTransaction(f.trade)).toBeInstanceOf(
      FailedTransactionMetadata,
    );
    const nextNonce = f.readNonce();
    f.svm.expireBlockhash();
    expect(f.svm.sendTransaction(f.cancel)).toBeInstanceOf(
      FailedTransactionMetadata,
    );
    expect(f.readNonce()).toBe(nextNonce);
  });

it("LOCAL cancellation invalidates the fully signed original exchange without moving its tokens", async () => {
  const f = await prepared("RING");
  const before = f.plan.terms.legs.map(
    (l) => localTokenAccount(f.svm, l.sourceAccount).amount,
  );
  await verifyNonceOperation(f.cancel.serialize(), f.cancelPlan, true);
  expect(f.svm.sendTransaction(f.cancel)).not.toBeInstanceOf(
    FailedTransactionMetadata,
  );
  f.svm.expireBlockhash();
  expect(f.svm.sendTransaction(f.trade)).toBeInstanceOf(
    FailedTransactionMetadata,
  );
  expect(
    f.plan.terms.legs.map(
      (l) => localTokenAccount(f.svm, l.sourceAccount).amount,
    ),
  ).toEqual(before);
});

it("rejects an extra transfer in a signing-account operation", async () => {
  const f = await prepared("BASKET");
  const changed = Transaction.from(f.cancel.serialize());
  changed.add(
    SystemProgram.transfer({
      fromPubkey: f.owners[0].publicKey,
      toPubkey: f.owners[1].publicKey,
      lamports: 1,
    }),
  );
  changed.sign(f.owners[0]);
  await expect(
    verifyNonceOperation(changed.serialize(), f.cancelPlan, true),
  ).rejects.toThrow(/unapproved/);
});

it("LOCAL failed token execution rolls back tokens and recovery holds when the pinned simulator leaves its nonce live", async () => {
  const f = await prepared("RING"),
    source = f.trade.instructions.at(-1)!.keys[0].pubkey;
  const account = f.svm.getAccount(source)!;
  const data = new Uint8Array(account.data);
  data.fill(0, 64, 72);
  f.svm.setAccount(source, { ...account, data });
  const before = f.plan.terms.legs.map(
    (l) => localTokenAccount(f.svm, l.sourceAccount).amount,
  );
  const payerBefore = f.svm.getBalance(f.owners[0].publicKey)!;
  const result = f.svm.sendTransaction(f.trade);
  expect(result).toBeInstanceOf(FailedTransactionMetadata);
  expect(
    f.plan.terms.legs.map(
      (l) => localTokenAccount(f.svm, l.sourceAccount).amount,
    ),
  ).toEqual(before);
  // LiteSVM 0.8.0 rolls back the nonce on instruction failure. This is a
  // simulator limitation, NOT a claim about Solana's documented nonce commit.
  expect(f.readNonce()).toBe(f.nonce);
  const observations: ChainObservation[] = ["primary", "fallback"].map(
    (endpoint) => ({
      endpoint,
      healthy: true,
      historyTrusted: true,
      finalizedBlockHeight: "999999",
      blockhashValid: true,
      nonceInvalidated: false,
      status: {
        confirmation: "finalized",
        err: { InstructionError: [8, "InsufficientFunds"] },
      },
      transactionFound: true,
      transactionErr: { InstructionError: [8, "InsufficientFunds"] },
      transactionFinalized: true,
    }),
  );
  const attempt = {
    plan: f.plan,
    txid: "local-original",
    state: "SUBMISSION_STARTED",
  } as Attempt;
  expect(reconcileDecision(attempt, observations)).toMatchObject({
    state: "FAILED_ONCHAIN",
    safeToRetry: false,
  });
  expect(payerBefore - f.svm.getBalance(f.owners[0].publicKey)!).toBe(15000n);
  expect(f.svm.sendTransaction(f.trade)).toBeInstanceOf(
    FailedTransactionMetadata,
  );
});

it("rejects uninitialized, old-version and incorrectly owned nonce data", () => {
  const data = Buffer.alloc(80);
  const info = {
    owner: SystemProgram.programId.toBase58(),
    data: [b64(data), "base64"] as [string, string],
  };
  expect(() => decodeNonceAccount(info)).toThrow(/initialized/);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(1, 4);
  expect(() =>
    decodeNonceAccount({
      ...info,
      owner: PublicKey.default.toBase58() + "x",
      data: [b64(data), "base64"],
    }),
  ).toThrow();
});
