import { PublicKey, Transaction } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { equalBytes, verifyEd25519 } from "./crypto";
import { wireParts } from "./transactions";
export const FAUCET_AUTHORITY = "HNQ83apbgdiZ9sLTCfborwhM2cVGWTP4hqRQ89ZzQgXw";
export const DEMO_MINTS = [
  "kyEZzbcEZhJTmHesLTZFaKnmkisvLirFrgfKZrtJbQx",
  "EZ2xuTV73HqM5AE8SrDjzQeHtae6cDV6TU6tzLBtEVxD",
  "3y3QsQtR3pK9fe3ZxCcwTdc5AHN87panLaFzR3GfzZvz",
];
export interface FaucetPlan {
  wallet: string;
  blockhash: string;
  lastValidBlockHeight: number;
  cluster: "devnet";
}
export interface FaucetClaim {
  id: string;
  plan: FaucetPlan;
  wireBase64: string;
  state: string;
  txid: string | null;
}
export function buildFaucetTransaction(
  plan: FaucetPlan,
  authority = FAUCET_AUTHORITY,
) {
  if (
    plan.cluster !== "devnet" ||
    !Number.isSafeInteger(plan.lastValidBlockHeight) ||
    plan.lastValidBlockHeight <= 0
  )
    throw new Error("Invalid Devnet faucet plan");
  const wallet = new PublicKey(plan.wallet);
  if (!PublicKey.isOnCurve(wallet.toBytes()) || plan.wallet === authority)
    throw new Error("Choose your own test wallet");
  const tx = new Transaction({
    feePayer: wallet,
    recentBlockhash: plan.blockhash,
  });
  for (const address of DEMO_MINTS) {
    const mint = new PublicKey(address),
      ata = getAssociatedTokenAddressSync(
        mint,
        wallet,
        false,
        TOKEN_2022_PROGRAM_ID,
      );
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        wallet,
        ata,
        wallet,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToCheckedInstruction(
        mint,
        ata,
        new PublicKey(authority),
        1_000_000_000n,
        6,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
  }
  return tx;
}
export async function verifyFaucetWire(
  wire: Uint8Array,
  plan: FaucetPlan,
  signed: boolean,
  authority = FAUCET_AUTHORITY,
) {
  const expected = buildFaucetTransaction(plan, authority).serializeMessage(),
    parts = wireParts(wire);
  if (
    !equalBytes(parts.message, expected) ||
    parts.signers.length !== 2 ||
    parts.signers[0] !== plan.wallet ||
    !parts.signers.includes(authority)
  )
    throw new Error(
      "Test-token request contains altered instructions or accounts",
    );
  for (let i = 0; i < parts.signers.length; i++) {
    if (
      !signed &&
      parts.signers[i] === plan.wallet &&
      !parts.signatures[i].some(Boolean)
    )
      continue;
    if (
      !(await verifyEd25519(
        parts.signers[i],
        parts.signatures[i],
        parts.message,
      ))
    )
      throw new Error("Invalid test-token request signature");
  }
  return parts;
}
