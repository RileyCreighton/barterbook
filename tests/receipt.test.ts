import { it, expect } from "vitest";
import { fixture } from "./fixtures";
import { buildTransaction, transactionId } from "../src/shared/transactions";
import { b64 } from "../src/shared/crypto";
import {
  receiptFromMetadata,
  type TransactionEvidence,
} from "../src/shared/receipt";
import type { Attempt } from "../src/shared/types";
function evidence() {
  const f = fixture();
  const tx = buildTransaction(f.plan);
  tx.partialSign(...f.owners);
  const bytes = tx.serialize();
  const message = tx.compileMessage();
  const keys = message.accountKeys.map((k) => k.toBase58());
  const a = {
    id: "a",
    plan: f.plan,
    messageBase64: b64(tx.serializeMessage()),
    fullWireBase64: b64(bytes),
    txid: transactionId(bytes),
  } as Attempt;
  const e: TransactionEvidence = {
    slot: 123,
    transaction: [b64(bytes), "base64"],
    meta: {
      err: null,
      fee: 10000,
      preBalances: keys.map(() => 100000000),
      postBalances: keys.map((_, i) => (i === 0 ? 99990000 : 100000000)),
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
  for (const l of f.terms.legs)
    for (const [account, owner, delta] of [
      [l.sourceAccount, l.fromOwner, -BigInt(l.grossRaw)],
      [l.destinationATA, l.toOwner, BigInt(l.netRaw)],
    ] as const) {
      const index = keys.indexOf(account);
      const b = {
        accountIndex: index,
        mint: l.mint,
        owner,
        programId: l.tokenProgram,
        uiTokenAmount: { amount: "50000000", decimals: l.decimals },
      };
      e.meta!.preTokenBalances!.push(b);
      e.meta!.postTokenBalances!.push({
        ...b,
        uiTokenAmount: {
          ...b.uiTokenAmount,
          amount: (50000000n + delta).toString(),
        },
      });
    }
  return { a, e };
}
it("reconciles this transaction, independent of later wallet balances", () => {
  const { a, e } = evidence();
  const r = receiptFromMetadata(a, e);
  expect(r.deltas).toHaveLength(6);
  expect(r.networkFeeLamports).toBe("10000");
  expect(r.verified).toBe(true);
  expect(r.blockTime).toBeNull();
  e.blockTime = 1790312400;
  expect(receiptFromMetadata(a, e).blockTime).toBe(1790312400);
  e.blockTime = 1.5;
  expect(() => receiptFromMetadata(a, e)).toThrow(
    "Unsafe RPC metadata integer",
  );
});
it("rejects failed transaction, changed receipt, missing pre metadata and wrong net", () => {
  for (const corrupt of [
    (e: TransactionEvidence) => {
      e.meta!.err = "failed";
    },
    (e: TransactionEvidence) => {
      e.meta!.preTokenBalances = [];
    },
    (e: TransactionEvidence) => {
      e.meta!.postTokenBalances![0].uiTokenAmount.amount = "1";
    },
  ]) {
    const { a, e } = evidence();
    corrupt(e);
    expect(() => receiptFromMetadata(a, e)).toThrow();
  }
});
