import { Message } from "@solana/web3.js";
import { raw } from "./amounts";
import { equalBytes, unb64 } from "./crypto";
import { transactionId, verifyTransaction, wireParts } from "./transactions";
import type { Attempt, Receipt, ReceiptDelta } from "./types";
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount: { amount: string; decimals: number };
}
export interface TransactionEvidence {
  slot: number | string;
  blockTime?: number | null;
  transaction: [string, string];
  meta: null | {
    err: unknown | null;
    fee: number | string;
    preBalances: (number | string)[];
    postBalances: (number | string)[];
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
  };
}
function exactInteger(value: number | string): bigint {
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new Error("Unsafe RPC metadata integer");
  return raw(String(value));
}
export function receiptFromMetadata(
  attempt: Attempt,
  evidence: TransactionEvidence,
  finalized = false,
): Receipt {
  if (!evidence.meta || evidence.meta.err !== null)
    throw new Error("Transaction metadata does not show a successful exchange");
  if (evidence.transaction[1] !== "base64")
    throw new Error("Receipt requires original encoded transaction");
  const wire = unb64(evidence.transaction[0]);
  const parts = verifyTransaction(wire, attempt.plan);
  if (
    !equalBytes(parts.message, unb64(attempt.messageBase64)) ||
    transactionId(wire) !== attempt.txid
  )
    throw new Error("Receipt transaction differs from frozen attempt");
  if (
    !attempt.fullWireBase64 ||
    !equalBytes(wire, unb64(attempt.fullWireBase64))
  )
    throw new Error("Receipt signatures differ from persisted signed bytes");
  const message = Message.from(wireParts(wire).message),
    keys = message.accountKeys.map((k) => k.toBase58()),
    meta = evidence.meta;
  const expected = new Map<
    string,
    {
      owner: string;
      mint: string;
      program: string;
      decimals: number;
      delta: bigint;
      destination: boolean;
    }
  >();
  for (const leg of attempt.plan.terms.legs)
    for (const [account, owner, delta, destination] of [
      [leg.sourceAccount, leg.fromOwner, -raw(leg.grossRaw), false],
      [leg.destinationATA, leg.toOwner, raw(leg.netRaw), true],
    ] as const) {
      const prev = expected.get(account);
      expected.set(account, {
        owner,
        mint: leg.mint,
        program: leg.tokenProgram,
        decimals: leg.decimals,
        delta: (prev?.delta ?? 0n) + delta,
        destination,
      });
    }
  for (const balances of [
    meta.preTokenBalances ?? [],
    meta.postTokenBalances ?? [],
  ])
    if (new Set(balances.map((b) => b.accountIndex)).size !== balances.length)
      throw new Error("Duplicate receipt metadata account index");
  const pre = new Map(
    (meta.preTokenBalances ?? []).map((b) => [b.accountIndex, b]),
  );
  const post = new Map(
    (meta.postTokenBalances ?? []).map((b) => [b.accountIndex, b]),
  );
  const deltas: ReceiptDelta[] = [];
  let rent = 0n;
  for (const [account, expectedBalance] of expected) {
    const index = keys.indexOf(account);
    if (index < 0) throw new Error("Receipt account missing");
    const before = pre.get(index),
      after = post.get(index);
    if (!after) throw new Error("Post-token metadata missing; receipt pending");
    for (const b of [before, after].filter(Boolean) as TokenBalance[])
      if (
        b.mint !== expectedBalance.mint ||
        b.owner !== expectedBalance.owner ||
        b.uiTokenAmount.decimals !== expectedBalance.decimals ||
        (b.programId && b.programId !== expectedBalance.program)
      )
        throw new Error("Receipt token identity mismatch");
    let preRaw: bigint;
    if (before) preRaw = raw(before.uiTokenAmount.amount);
    else if (
      expectedBalance.destination &&
      attempt.plan.createAtas.includes(account) &&
      exactInteger(meta.preBalances[index]) === 0n
    )
      preRaw = 0n;
    else
      throw new Error(
        "Missing pre-token metadata is not proof of an empty account",
      );
    const postRaw = raw(after.uiTokenAmount.amount);
    if (postRaw - preRaw !== expectedBalance.delta)
      throw new Error(
        "Transaction-specific net delta differs from accepted terms",
      );
    deltas.push({
      account,
      owner: expectedBalance.owner,
      mint: expectedBalance.mint,
      preRaw: preRaw.toString(),
      postRaw: postRaw.toString(),
      deltaRaw: (postRaw - preRaw).toString(),
    });
    if (!before)
      rent +=
        exactInteger(meta.postBalances[index]) -
        exactInteger(meta.preBalances[index]);
  }
  const fee = exactInteger(meta.fee);
  if (
    fee > raw(attempt.plan.terms.maxNetworkFeeLamports) ||
    rent > raw(attempt.plan.terms.maxAccountRentLamports)
  )
    throw new Error("Actual SOL costs exceed accepted limits");
  if (
    exactInteger(meta.postBalances[0]) - exactInteger(meta.preBalances[0]) !==
    -(fee + rent)
  )
    throw new Error("Fee payer SOL delta does not reconcile");
  return {
    txid: attempt.txid!,
    cluster: attempt.plan.terms.cluster,
    slot: String(evidence.slot),
    blockTime:
      evidence.blockTime === null || evidence.blockTime === undefined
        ? null
        : Number(exactInteger(evidence.blockTime)),
    status: finalized ? "FINALIZED" : "CONFIRMED",
    networkFeeLamports: fee.toString(),
    accountRentLamports: rent.toString(),
    issuerFees: attempt.plan.terms.legs.map((l) => ({
      mint: l.mint,
      feeRaw: l.expectedFeeRaw,
    })),
    deltas,
    verified: true,
  };
}
