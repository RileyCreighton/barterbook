import {
  Message,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { Buffer } from "buffer";
import { b64, equalBytes, unb64, verifyEd25519 } from "./crypto";
import { raw } from "./amounts";

export const NONCE_SEED = "barterbook-devnet-nonce-v1";
export const MAX_NONCE_RENT = 2_000_000;
export const MAX_NONCE_OPERATION_FEE = 25_000;

/** One nonce per fee payer. Existing wallet allocation locks serialize its use. */
export async function nonceAddress(wallet: string): Promise<string> {
  return (
    await PublicKey.createWithSeed(
      new PublicKey(wallet),
      NONCE_SEED,
      SystemProgram.programId,
    )
  ).toBase58();
}

export interface NonceOperationPlan {
  kind: "setup" | "cancel";
  wallet: string;
  nonceAccount: string;
  blockhash: string;
  contextSlot: string;
  lastValidBlockHeight: string;
  rentLamports: string;
  networkFeeLamports: string;
  attemptId?: string;
}
export interface NonceOperation {
  id: string;
  plan: NonceOperationPlan;
  wireBase64: string;
  signedWireBase64: string | null;
  txid: string | null;
  state: "PREPARED" | "SUBMISSION_STARTED" | "FINALIZED" | "FAILED" | "EXPIRED";
  createdAt: number;
  error: string | null;
}

export function decodeNonceAccount(
  info: { owner: string; data: [string, string]; executable?: boolean } | null,
) {
  if (!info) return null;
  const bytes = unb64(info.data[0]);
  if (
    info.owner !== SystemProgram.programId.toBase58() ||
    info.executable ||
    info.data[1] !== "base64" ||
    bytes.length !== NONCE_ACCOUNT_LENGTH ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      0,
      true,
    ) !== 1 ||
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
      4,
      true,
    ) !== 1
  )
    throw new Error(
      "The signing account is not an initialized durable nonce account.",
    );
  const decoded = NonceAccount.fromAccountData(Buffer.from(bytes));
  return {
    authority: decoded.authorizedPubkey.toBase58(),
    value: decoded.nonce,
    lamportsPerSignature: decoded.feeCalculator.lamportsPerSignature,
  };
}

export async function buildNonceOperation(
  plan: NonceOperationPlan,
): Promise<Transaction> {
  const wallet = new PublicKey(plan.wallet),
    nonce = new PublicKey(plan.nonceAccount);
  if (plan.nonceAccount !== (await nonceAddress(plan.wallet)))
    throw new Error("Signing account does not belong to this fee payer.");
  const rent = Number(raw(plan.rentLamports)),
    fee = Number(raw(plan.networkFeeLamports));
  raw(plan.contextSlot);
  raw(plan.lastValidBlockHeight);
  if (
    !Number.isSafeInteger(rent) ||
    rent < 0 ||
    rent > MAX_NONCE_RENT ||
    !Number.isSafeInteger(fee) ||
    fee < 5000 ||
    fee > MAX_NONCE_OPERATION_FEE
  )
    throw new Error("Signing setup exceeds its permitted SOL cost.");
  const tx = new Transaction({
    feePayer: wallet,
    recentBlockhash: plan.blockhash,
  });
  if (plan.kind === "setup") {
    if (!rent || plan.attemptId)
      throw new Error("Invalid signing setup request.");
    tx.add(
      SystemProgram.createNonceAccount({
        fromPubkey: wallet,
        noncePubkey: nonce,
        authorizedPubkey: wallet,
        basePubkey: wallet,
        seed: NONCE_SEED,
        lamports: rent,
      }),
    );
  } else if (plan.kind === "cancel") {
    if (rent || !plan.attemptId || plan.lastValidBlockHeight !== "0")
      throw new Error("Invalid cancellation request.");
    // The original nonce is the cancellation transaction's own lifetime. This
    // cancellation can never advance a later trade's nonce if the barter wins.
    tx.add(
      SystemProgram.nonceAdvance({
        authorizedPubkey: wallet,
        noncePubkey: nonce,
      }),
    );
  } else throw new Error("Unknown signing account operation.");
  return tx;
}

export async function nonceOperationWire(plan: NonceOperationPlan) {
  return b64(
    (await buildNonceOperation(plan)).serialize({
      requireAllSignatures: false,
    }),
  );
}

/** Separate single-signer verifier; barter wireParts still requires 2–3 owners. */
export async function verifyNonceOperation(
  wire: Uint8Array,
  plan: NonceOperationPlan,
  signed: boolean,
) {
  if (wire[0] !== 1 || wire.length <= 65 || wire.length > 1232)
    throw new Error("Invalid signing account transaction.");
  const message = new Uint8Array(wire.subarray(65));
  const expected = (await buildNonceOperation(plan)).serializeMessage();
  if (!equalBytes(message, expected))
    throw new Error(
      "Signing account transaction contains unapproved instructions or accounts.",
    );
  const decoded = Message.from(message);
  const signature = new Uint8Array(wire.subarray(1, 65));
  if (
    decoded.header.numRequiredSignatures !== 1 ||
    decoded.accountKeys[0].toBase58() !== plan.wallet ||
    (signed && !signature.some(Boolean)) ||
    (signature.some(Boolean) &&
      !(await verifyEd25519(plan.wallet, signature, message)))
  )
    throw new Error("Invalid signing account signature.");
  return { message, signatures: [signature], signers: [plan.wallet] };
}
