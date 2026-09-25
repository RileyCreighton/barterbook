import { describe, it, expect, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
  Transaction,
  PublicKey,
} from "@solana/web3.js";
import {
  createApproveInstruction,
  createCloseAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buildTransaction,
  buildTransactionBytes,
  mergeSignature,
  verifyTransaction,
  verifyWireSignatures,
  wireParts,
  transactionId,
} from "../src/shared/transactions";
import { equalBytes } from "../src/shared/crypto";
import { fixture } from "./fixtures";
import type { FrozenPlan } from "../src/shared/types";
const wire = (tx: Transaction) =>
  tx.serialize({ requireAllSignatures: false, verifySignatures: false });
describe("immutable signing spike (SDK only)", () => {
  for (const n of [2, 3])
    it(`${n} owners sign identical bytes across serialize/merge round trips`, async () => {
      const f = fixture(n);
      let bytes: Uint8Array = new Uint8Array(wire(buildTransaction(f.plan)));
      const original = wireParts(bytes).message;
      for (const owner of f.owners) {
        const restored = Transaction.from(bytes);
        restored.partialSign(owner);
        bytes = await mergeSignature(
          bytes,
          wire(restored),
          owner.publicKey.toBase58(),
          f.plan,
        );
        expect(equalBytes(wireParts(bytes).message, original)).toBe(true);
      }
      await verifyWireSignatures(bytes, f.plan, true);
      expect(bytes.length).toBeLessThanOrEqual(1232);
      expect(transactionId(bytes).length).toBeGreaterThan(80);
    });
  it("rejects instruction, signer, account, fee and lifetime tampering", () => {
    const f = fixture();
    const alterations = [
      (t: Transaction) => {
        t.recentBlockhash = Keypair.generate().publicKey.toBase58();
      },
      (t: Transaction) => {
        t.feePayer = Keypair.generate().publicKey;
      },
      (t: Transaction) => {
        t.add(
          SystemProgram.transfer({
            fromPubkey: f.owners[0].publicKey,
            toPubkey: f.owners[1].publicKey,
            lamports: 1,
          }),
        );
      },
      (t: Transaction) => {
        t.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 10000,
        });
      },
      (t: Transaction) => {
        t.instructions.at(-1)!.keys[2].pubkey = Keypair.generate().publicKey;
      },
      (t: Transaction) => {
        t.instructions.at(-1)!.data[2] ^= 1;
      },
      (t: Transaction) => {
        t.instructions.at(-1)!.programId = SystemProgram.programId;
      },
      (t: Transaction) => {
        t.add(
          createApproveInstruction(
            new PublicKey(f.terms.legs[0].sourceAccount),
            f.owners[1].publicKey,
            f.owners[0].publicKey,
            1n,
            [],
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      },
      (t: Transaction) => {
        t.add(
          createCloseAccountInstruction(
            new PublicKey(f.terms.legs[0].sourceAccount),
            f.owners[0].publicKey,
            f.owners[0].publicKey,
            [],
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      },
    ];
    for (const alter of alterations) {
      const t = buildTransaction(f.plan);
      alter(t);
      expect(() => verifyTransaction(wire(t), f.plan)).toThrow();
    }
  });
  it("rejects invalid/missing signatures and an unaccepted terms version", async () => {
    const f = fixture();
    const bytes = wire(buildTransaction(f.plan));
    await expect(verifyWireSignatures(bytes, f.plan, true)).rejects.toThrow(
      /Missing/,
    );
    const corrupt = new Uint8Array(bytes);
    corrupt[1] = 1;
    await expect(verifyWireSignatures(corrupt, f.plan)).rejects.toThrow(
      /Invalid/,
    );
    expect(() =>
      verifyTransaction(bytes, f.plan, { ...f.terms, version: 2 }),
    ).toThrow(/accepted/);
  });
});

describe("per-call transaction compilation reuse", () => {
  it("builds matching wire/message bytes and strictly verifies with one SDK compilation per call", () => {
    const f = fixture(3);
    const compile = vi.spyOn(Transaction.prototype, "compileMessage");
    try {
      const built = buildTransactionBytes(f.plan);
      expect(compile).toHaveBeenCalledTimes(1);
      expect(built.message).toEqual(wireParts(built.wire).message);
      compile.mockClear();
      expect(verifyTransaction(built.wire, f.plan).message).toEqual(
        built.message,
      );
      expect(compile).toHaveBeenCalledTimes(1);
    } finally {
      compile.mockRestore();
    }
  });
  it("revalidates every reused mutable plan after fee, asset, receipt or lifetime changes", () => {
    const f = fixture(3);
    const original = structuredClone(f.plan),
      originalWire = buildTransactionBytes(f.plan).wire;
    const mutations: Array<(plan: FrozenPlan) => void> = [
      (plan) => {
        plan.networkFeeLamports = "0";
      },
      (plan) => {
        plan.accountRentLamports = "0";
      },
      (plan) => {
        plan.assets[0].tested = false;
      },
      (plan) => {
        plan.assets[0].hasTransferFee = false;
      },
      (plan) => {
        plan.terms.minima[0].minNetRaw = "18446744073709551615";
      },
      (plan) => {
        plan.blockhash = Keypair.generate().publicKey.toBase58();
      },
      (plan) => {
        plan.lastValidBlockHeight = "-1";
      },
      (plan) => {
        plan.createAtas.pop();
      },
    ];
    for (const mutate of mutations) {
      Object.assign(f.plan, structuredClone(original));
      expect(() => verifyTransaction(originalWire, f.plan)).not.toThrow();
      mutate(f.plan);
      expect(() => verifyTransaction(originalWire, f.plan)).toThrow();
    }
  });
  it("caller mutations of returned bytes and SDK transactions cannot poison later builds", () => {
    const f = fixture();
    const first = buildTransactionBytes(f.plan),
      expectedWire = new Uint8Array(first.wire),
      expectedMessage = new Uint8Array(first.message);
    first.wire.fill(7);
    expect(first.message).toEqual(expectedMessage);
    first.message.fill(9);
    const transaction = buildTransaction(f.plan);
    transaction.instructions[0].data.fill(0);
    transaction.instructions.at(-1)!.programId = SystemProgram.programId;
    expect(buildTransactionBytes(f.plan)).toEqual({
      wire: expectedWire,
      message: expectedMessage,
    });
    expect(() => verifyTransaction(expectedWire, f.plan)).not.toThrow();
  });
  it("combined signature verification returns independent strictly bound parts", async () => {
    const f = fixture(3),
      tx = buildTransaction(f.plan);
    tx.partialSign(...f.owners);
    const signed = tx.serialize();
    const parts = await verifyWireSignatures(signed, f.plan, true, f.terms);
    expect(parts).toEqual(wireParts(signed));
    parts.message.fill(1);
    parts.signatures[0].fill(2);
    expect(await verifyWireSignatures(signed, f.plan, true, f.terms)).toEqual(
      wireParts(signed),
    );
    await expect(
      verifyWireSignatures(signed, f.plan, true, { ...f.terms, version: 2 }),
    ).rejects.toThrow(/accepted terms/);
  });
});
