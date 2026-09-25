import { Message } from "@solana/web3.js";
import { canonical, equalBytes, sha256, unb64 } from "../shared/crypto";
import {
  buildTransactionBytes,
  verifyWireSignatures,
  wireParts,
} from "../shared/transactions";
import type { FrozenPlan, Terms } from "../shared/types";

/** Read-only, including for expired attempts. Never opens a wallet, sends bytes,
 * or grants permission to sign/retry. The report contains no raw wire/signatures.
 */
export async function checkFrozenTransaction(
  wireBase64: string,
  proposedPlan: FrozenPlan,
  roomTerms: Terms,
) {
  const plan = structuredClone(proposedPlan);
  const terms = structuredClone(roomTerms);
  const wire = unb64(wireBase64);
  const actual = wireParts(wire);
  const expected = buildTransactionBytes(plan).message;
  const actualDecoded = Message.from(actual.message);
  const expectedDecoded = Message.from(expected);
  const keys = (m: Message) => m.accountKeys.map((key) => key.toBase58());
  const instructions = (m: Message) =>
    m.instructions.map((instruction) => ({
      program: m.accountKeys[instruction.programIdIndex]?.toBase58(),
      accounts: instruction.accounts.map((index) =>
        m.accountKeys[index]?.toBase58(),
      ),
      data: instruction.data,
    }));
  let verified = false;
  let verificationError: string | null = null;
  try {
    await verifyWireSignatures(wire, plan, false, terms);
    verified = true;
  } catch (cause) {
    verificationError =
      cause instanceof Error ? cause.message : "Verification failed";
  }
  const sameMessage = equalBytes(actual.message, expected);
  return {
    diagnosticVersion: "2026-09-25.2",
    termsNetwork: terms.cluster,
    planNetwork: plan.terms.cluster,
    verified,
    verificationError,
    termsMatch: canonical(terms) === canonical(plan.terms),
    messageMatches: sameMessage,
    frozenMessageHash: await sha256(actual.message),
    reconstructedMessageHash: await sha256(expected),
    frozenMessageBytes: actual.message.length,
    reconstructedMessageBytes: expected.length,
    firstDifferentByte: sameMessage
      ? null
      : (() => {
          const length = Math.min(actual.message.length, expected.length);
          for (let i = 0; i < length; i++)
            if (actual.message[i] !== expected[i]) return i;
          return length;
        })(),
    headerMatches:
      canonical(actualDecoded.header) === canonical(expectedDecoded.header),
    accountOrderMatches:
      canonical(keys(actualDecoded)) === canonical(keys(expectedDecoded)),
    accountSetMatches:
      canonical(keys(actualDecoded).sort()) ===
      canonical(keys(expectedDecoded).sort()),
    blockhashMatches:
      actualDecoded.recentBlockhash === expectedDecoded.recentBlockhash,
    instructionsMatch:
      canonical(instructions(actualDecoded)) ===
      canonical(instructions(expectedDecoded)),
    storedSignatureCount: actual.signatures.filter((signature) =>
      signature.some(Boolean),
    ).length,
    termsExpired: terms.expiresAt <= Date.now(),
    retryAuthorized: false,
  };
}
