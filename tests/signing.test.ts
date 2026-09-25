import { describe, it, expect } from "vitest";
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
  mergeSignature,
  verifyTransaction,
  verifyWireSignatures,
  wireParts,
  transactionId,
} from "../src/shared/transactions";
import { equalBytes } from "../src/shared/crypto";
import { fixture } from "./fixtures";
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
