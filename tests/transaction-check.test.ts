import { expect, it } from "vitest";
import { Keypair, Transaction } from "@solana/web3.js";
import { checkFrozenTransaction } from "../src/client/transaction-check";
import { b64, unb64 } from "../src/shared/crypto";
import { buildTransaction, unsignedWire } from "../src/shared/transactions";
import { fixture } from "./fixtures";

for (const count of [2, 3])
  it(`checks an expired ${count}-owner message without permitting a retry or exposing signatures`, async () => {
    const f = fixture(count);
    f.terms.expiresAt = Date.now() - 1000;
    const tx = buildTransaction(f.plan);
    tx.partialSign(f.owners[0]);
    const wire = b64(tx.serialize({ requireAllSignatures: false }));
    const before = structuredClone(f.plan);
    const result = await checkFrozenTransaction(wire, f.plan, f.terms);
    expect(result).toMatchObject({
      verified: true,
      messageMatches: true,
      termsMatch: true,
      accountOrderMatches: true,
      blockhashMatches: true,
      instructionsMatch: true,
      storedSignatureCount: 1,
      termsExpired: true,
      retryAuthorized: false,
      planNetwork: "devnet",
    });
    expect(JSON.stringify(result)).not.toContain(wire);
    expect(JSON.stringify(result)).not.toContain(
      b64(tx.signatures[0].signature!),
    );
    expect(f.plan).toEqual(before);
  });

it("identifies a changed blockhash while preserving the strict rejection", async () => {
  const f = fixture();
  const changed = buildTransaction(f.plan);
  changed.recentBlockhash = Keypair.generate().publicKey.toBase58();
  const result = await checkFrozenTransaction(
    b64(changed.serialize({ requireAllSignatures: false })),
    f.plan,
    f.terms,
  );
  expect(result).toMatchObject({
    verified: false,
    messageMatches: false,
    blockhashMatches: false,
    instructionsMatch: true,
    accountOrderMatches: true,
  });
  expect(result.verificationError).toMatch(/altered or unapproved/);
  expect(result.firstDifferentByte).toBeTypeOf("number");
});

it("distinguishes accepted terms from the frozen plan", async () => {
  const f = fixture();
  const terms = structuredClone(f.terms);
  terms.version++;
  const result = await checkFrozenTransaction(
    unsignedWire(f.plan),
    f.plan,
    terms,
  );
  expect(result).toMatchObject({
    verified: false,
    termsMatch: false,
    messageMatches: true,
  });
});

it("reports an invalid stored signature without exposing it", async () => {
  const f = fixture();
  const wire = unb64(unsignedWire(f.plan));
  wire[1] = 42;
  const result = await checkFrozenTransaction(b64(wire), f.plan, f.terms);
  expect(result).toMatchObject({
    verified: false,
    messageMatches: true,
    storedSignatureCount: 1,
  });
  expect(result.verificationError).toMatch(/signature/i);
});

it("identifies changed instructions", async () => {
  const f = fixture();
  const tx = Transaction.from(unb64(unsignedWire(f.plan)));
  tx.instructions.pop();
  const result = await checkFrozenTransaction(
    b64(tx.serialize({ requireAllSignatures: false })),
    f.plan,
    f.terms,
  );
  expect(result).toMatchObject({
    verified: false,
    instructionsMatch: false,
    messageMatches: false,
  });
});
