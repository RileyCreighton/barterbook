import { Transaction } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { fixture } from "../tests/fixtures";
import {
  buildTransaction,
  mergeSignature,
  verifyWireSignatures,
  wireParts,
} from "../src/shared/transactions";
import { b64, sha256 } from "../src/shared/crypto";
const results = [];
for (const count of [2, 3]) {
  const f = fixture(count);
  let bytes: Uint8Array = new Uint8Array(
    buildTransaction(f.plan).serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  );
  const hash = await sha256(wireParts(bytes).message);
  for (const owner of f.owners) {
    const tx = Transaction.from(bytes);
    tx.partialSign(owner);
    bytes = await mergeSignature(
      bytes,
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      owner.publicKey.toBase58(),
      f.plan,
    );
  }
  await verifyWireSignatures(bytes, f.plan, true);
  results.push({
    owners: count,
    transfers: 3,
    bytes: bytes.length,
    immutable: hash === (await sha256(wireParts(bytes).message)),
    allSignaturesValid: true,
    messageHash: hash,
  });
  writeFileSync(
    `evidence/spike-${count}-owner-plan.json`,
    JSON.stringify(
      {
        plan: f.plan,
        wireBase64: b64(
          buildTransaction(f.plan).serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        ),
      },
      null,
      2,
    ),
  );
}
const evidence = {
  executedAt: new Date().toISOString(),
  scope:
    "Local SDK round trip only. Random ephemeral keys; no assets, browser-wallet proof or chain execution.",
  results,
};
writeFileSync(
  "evidence/signing-spike.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(evidence);
