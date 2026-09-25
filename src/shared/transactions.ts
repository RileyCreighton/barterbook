import {
  ComputeBudgetProgram,
  Message,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getAccountLen,
  getAccountTypeOfMintType,
  isMintExtension,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { activeFee, feeFor, raw } from "./amounts";
import {
  b64,
  canonical,
  equalBytes,
  sha256,
  unb64,
  verifyEd25519,
} from "./crypto";
import type { Asset, FrozenPlan, Terms, TransferLeg } from "./types";
const pk = (s: string) => {
  if (typeof s !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s))
    throw new Error("Invalid public address");
  return new PublicKey(s);
};
const ataCache = new Map<string, string>();
export function ataAccountSize(asset: Asset): number {
  return getAccountLen(
    asset.tokenProgram === TOKEN_2022_PROGRAM_ID.toBase58()
      ? [
          ...new Set([
            ...asset.extensions
              .filter(isMintExtension)
              .map(getAccountTypeOfMintType)
              .filter((e) => e !== ExtensionType.Uninitialized),
            ExtensionType.ImmutableOwner,
          ]),
        ]
      : [],
  );
}
/** Conservative pinned rent policy; fresh RPC quotes above this bound disable
 * preparation. Every encoded idempotent creation can charge rent if its existing
 * account closes before execution, so the browser checks the full allowance.
 * Policy source: https://solana.com/docs/core/accounts (checked 2026-09-25).
 */
export function maximumAtaRentLamports(asset: Asset): string {
  return ((BigInt(ataAccountSize(asset)) + 128n) * 6960n).toString();
}
export function ata(owner: string, mint: string, program: string): string {
  const key = owner + ":" + mint + ":" + program,
    cached = ataCache.get(key);
  if (cached) return cached;
  const address = getAssociatedTokenAddressSync(
    pk(mint),
    pk(owner),
    false,
    pk(program),
  ).toBase58();
  if (ataCache.size >= 512) ataCache.clear();
  ataCache.set(key, address);
  return address;
}
export function legFor(
  fromOwner: string,
  toOwner: string,
  asset: Asset,
  grossRaw: string,
): TransferLeg {
  const expectedFeeRaw = asset.hasTransferFee
    ? feeFor(grossRaw, activeFee(asset))
    : "0";
  return {
    fromOwner,
    toOwner,
    mint: asset.mint,
    tokenProgram: asset.tokenProgram,
    sourceAccount: ata(fromOwner, asset.mint, asset.tokenProgram),
    destinationATA: ata(toOwner, asset.mint, asset.tokenProgram),
    grossRaw,
    expectedFeeRaw,
    netRaw: (raw(grossRaw) - raw(expectedFeeRaw)).toString(),
    decimals: asset.decimals,
  };
}
export function validateTerms(terms: Terms, assets: Asset[]): void {
  if (
    !["devnet", "mainnet-beta"].includes(terms.cluster) ||
    !Number.isInteger(terms.version) ||
    terms.version < 1 ||
    !Number.isSafeInteger(terms.expiresAt)
  )
    throw new Error("Invalid terms version, cluster or expiry");
  if (
    !["BASKET", "RING"].includes(terms.mode) ||
    terms.owners.length !== (terms.mode === "RING" ? 3 : 2) ||
    new Set(terms.owners).size !== terms.owners.length
  )
    throw new Error("Require two basket owners or three distinct ring owners");
  terms.owners.forEach(pk);
  if (!terms.owners.includes(terms.feePayer))
    throw new Error("Fee payer must be a sending participant");
  raw(terms.maxNetworkFeeLamports);
  raw(terms.maxAccountRentLamports);
  if (
    terms.legs.length < 2 ||
    terms.legs.length > 5 ||
    (terms.mode === "RING" && terms.legs.length !== 3)
  )
    throw new Error("Invalid transfer count");
  if (
    new Set(assets.filter((a) => a.tested).map((a) => a.mint)).size <
    new Set(terms.legs.map((l) => l.mint)).size
  )
    throw new Error("Every distinct mint must be tested");
  const seen = new Set<string>();
  const incoming = new Map<string, bigint>();
  for (const leg of terms.legs) {
    const a = assets.find(
      (a) => a.mint === leg.mint && a.cluster === terms.cluster && a.tested,
    );
    if (!a || a.multiplier !== "1" || a.pendingMultiplier !== "1")
      throw new Error("Untested asset or scaled multiplier");
    if (
      ![TOKEN_PROGRAM_ID.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58()].includes(
        a.tokenProgram,
      ) ||
      (a.hasTransferFee && a.tokenProgram !== TOKEN_2022_PROGRAM_ID.toBase58())
    )
      throw new Error("Wrong token program");
    if (
      !terms.owners.includes(leg.fromOwner) ||
      !terms.owners.includes(leg.toOwner) ||
      leg.fromOwner === leg.toOwner
    )
      throw new Error("Invalid transfer owners");
    raw(leg.grossRaw, false);
    raw(leg.netRaw, false);
    raw(leg.expectedFeeRaw);
    if (
      canonical(leg) !==
      canonical(legFor(leg.fromOwner, leg.toOwner, a, leg.grossRaw))
    )
      throw new Error(
        "Transfer account, quantity, decimals or fee differs from current terms",
      );
    const key = `${leg.fromOwner}:${leg.toOwner}:${leg.mint}`;
    if (seen.has(key))
      throw new Error(
        "Duplicate transfer: consolidate and reprice before accepting",
      );
    seen.add(key);
    if (
      terms.mode === "BASKET" &&
      terms.legs.some((l) => l.mint === leg.mint && l.fromOwner === leg.toOwner)
    )
      throw new Error("Opposing bilateral mint transfers are not supported");
    const dest = `${leg.toOwner}:${leg.mint}`;
    incoming.set(dest, (incoming.get(dest) ?? 0n) + raw(leg.netRaw));
  }
  for (const owner of terms.owners) {
    if (
      !terms.legs.some((l) => l.fromOwner === owner) ||
      !terms.legs.some((l) => l.toOwner === owner)
    )
      throw new Error("Every owner must give and receive");
    if (
      terms.mode === "RING" &&
      (terms.legs.filter((l) => l.fromOwner === owner).length !== 1 ||
        terms.legs.filter((l) => l.toOwner === owner).length !== 1)
    )
      throw new Error("Ring requires whole single outgoing and incoming lots");
  }
  if (
    terms.mode === "RING" &&
    new Set(terms.legs.map((l) => l.mint)).size !== 3
  )
    throw new Error("Ring requires three distinct mints");
  const minima = new Set<string>();
  for (const min of terms.minima) {
    const key = `${min.owner}:${min.mint}`;
    if (
      minima.has(key) ||
      !incoming.has(key) ||
      (incoming.get(key) ?? 0n) < raw(min.minNetRaw, false)
    )
      throw new Error("Recipient minimum net is not satisfied");
    minima.add(key);
  }
  if (minima.size !== incoming.size)
    throw new Error("Every receipt needs an accepted minimum");
}
export async function hashTerms(terms: Terms): Promise<string> {
  return sha256(canonical(terms));
}
export function buildTransaction(plan: FrozenPlan): Transaction {
  validateTerms(plan.terms, plan.assets);
  if (
    !Number.isInteger(plan.computeUnitLimit) ||
    plan.computeUnitLimit < 10000 ||
    plan.computeUnitLimit > 400000 ||
    raw(plan.microLamports) > 10000n
  )
    throw new Error("Compute budget exceeds permitted bounds");
  raw(plan.lastValidBlockHeight);
  raw(plan.contextSlot);
  pk(plan.blockhash);
  const minimumFee =
    BigInt(plan.terms.owners.length) * 5000n +
    (BigInt(plan.computeUnitLimit) * raw(plan.microLamports) + 999999n) /
      1000000n;
  if (raw(plan.networkFeeLamports) < minimumFee)
    throw new Error(
      "Network estimate does not cover encoded priority fee and signature fee",
    );
  if (
    raw(plan.networkFeeLamports) > raw(plan.terms.maxNetworkFeeLamports) ||
    raw(plan.accountRentLamports) > raw(plan.terms.maxAccountRentLamports)
  )
    throw new Error("SOL cost exceeds accepted cap");
  const legs = [...plan.terms.legs].sort((a, b) =>
    canonical(a).localeCompare(canonical(b)),
  );
  const destinations = [...new Set(legs.map((l) => l.destinationATA))].sort();
  if (canonical([...plan.createAtas].sort()) !== canonical(destinations))
    throw new Error("Only the exact receiving ATAs may be created");
  const maximumRent = destinations.reduce((sum, destination) => {
    const leg = legs.find((l) => l.destinationATA === destination)!;
    const asset = plan.assets.find((a) => a.mint === leg.mint)!;
    return sum + raw(maximumAtaRentLamports(asset));
  }, 0n);
  if (raw(plan.accountRentLamports) < maximumRent)
    throw new Error(
      "Account allowance does not cover every encoded ATA creation",
    );
  const tx = new Transaction({
    feePayer: pk(plan.terms.feePayer),
    recentBlockhash: plan.blockhash,
  });
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: plan.computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: raw(plan.microLamports),
    }),
  );
  for (const dest of destinations) {
    const leg = legs.find((l) => l.destinationATA === dest)!;
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(
        pk(plan.terms.feePayer),
        pk(dest),
        pk(leg.toOwner),
        pk(leg.mint),
        pk(leg.tokenProgram),
      ),
    );
  }
  for (const l of legs) {
    const asset = plan.assets.find((a) => a.mint === l.mint)!;
    tx.add(
      asset.hasTransferFee
        ? createTransferCheckedWithFeeInstruction(
            pk(l.sourceAccount),
            pk(l.mint),
            pk(l.destinationATA),
            pk(l.fromOwner),
            raw(l.grossRaw),
            l.decimals,
            raw(l.expectedFeeRaw),
            [],
            pk(l.tokenProgram),
          )
        : createTransferCheckedInstruction(
            pk(l.sourceAccount),
            pk(l.mint),
            pk(l.destinationATA),
            pk(l.fromOwner),
            raw(l.grossRaw),
            l.decimals,
            [],
            pk(l.tokenProgram),
          ),
    );
  }
  const wire = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  if (wire.length > 1232)
    throw new Error("Transaction exceeds legacy packet size");
  return tx;
}
export function wireParts(wire: Uint8Array): {
  message: Uint8Array;
  signatures: Uint8Array[];
  signers: string[];
} {
  // Launch permits only 2–3 signatures, whose shortvec is exactly one byte.
  const count = wire[0];
  if (
    wire.length > 1232 ||
    count < 2 ||
    count > 3 ||
    wire.length <= 1 + count * 64
  )
    throw new Error("Invalid legacy wire shape");
  const message = wire.slice(1 + count * 64);
  if (message[0] & 128) throw new Error("Only legacy transactions supported");
  const decoded = Message.from(message);
  if (decoded.header.numRequiredSignatures !== count)
    throw new Error("Wrong signer count");
  return {
    message,
    signatures: Array.from({ length: count }, (_, i) =>
      wire.slice(1 + i * 64, 1 + (i + 1) * 64),
    ),
    signers: decoded.accountKeys.slice(0, count).map((k) => k.toBase58()),
  };
}
export function verifyTransaction(
  wire: Uint8Array,
  plan: FrozenPlan,
  acceptedTerms: Terms = plan.terms,
): ReturnType<typeof wireParts> {
  if (canonical(acceptedTerms) !== canonical(plan.terms))
    throw new Error("Message is not bound to locally accepted terms");
  const parts = wireParts(wire);
  const expected = buildTransaction({
    ...plan,
    terms: acceptedTerms,
  }).serializeMessage();
  // Exact reconstruction from independent accepted terms checks ALL instruction data,
  // ordered accounts, privileges, signers, compute settings, fee payer and lifetime.
  if (!equalBytes(parts.message, expected))
    throw new Error(
      "Transaction contains altered or unapproved instructions/accounts/message",
    );
  if (
    canonical([...parts.signers].sort()) !==
    canonical([...acceptedTerms.owners].sort())
  )
    throw new Error("Unexpected signer");
  return parts;
}
export async function verifyWireSignatures(
  wire: Uint8Array,
  plan: FrozenPlan,
  requireAll = false,
): Promise<void> {
  const p = verifyTransaction(wire, plan);
  for (let i = 0; i < p.signers.length; i++) {
    if (!p.signatures[i].some(Boolean)) {
      if (requireAll) throw new Error("Missing signature");
      continue;
    }
    if (!(await verifyEd25519(p.signers[i], p.signatures[i], p.message)))
      throw new Error("Invalid transaction signature");
  }
}
export async function mergeSignature(
  existingWire: Uint8Array,
  uploadedWire: Uint8Array,
  wallet: string,
  plan: FrozenPlan,
): Promise<Uint8Array> {
  const old = wireParts(existingWire),
    incoming = verifyTransaction(uploadedWire, plan);
  if (!equalBytes(old.message, incoming.message))
    throw new Error("Existing message differs from frozen plan");
  const slot = old.signers.indexOf(wallet);
  if (slot < 0) throw new Error("Not a required signer");
  for (let i = 0; i < incoming.signers.length; i++)
    if (
      incoming.signatures[i].some(Boolean) &&
      !(await verifyEd25519(
        incoming.signers[i],
        incoming.signatures[i],
        incoming.message,
      ))
    )
      throw new Error("Invalid transaction signature");
  if (!incoming.signatures[slot].some(Boolean))
    throw new Error("Wallet did not sign");
  for (let i = 0; i < old.signers.length; i++)
    if (
      old.signatures[i].some(Boolean) &&
      incoming.signatures[i].some(Boolean) &&
      !equalBytes(old.signatures[i], incoming.signatures[i])
    )
      throw new Error("Existing signature changed");
  const merged = new Uint8Array(existingWire);
  merged.set(incoming.signatures[slot], 1 + slot * 64);
  return merged;
}
export function transactionId(wire: Uint8Array): string {
  const p = wireParts(wire);
  if (!p.signatures[0].some(Boolean))
    throw new Error("Fee payer has not signed");
  return bs58.encode(p.signatures[0]);
}
export function unsignedWire(plan: FrozenPlan): string {
  return b64(
    buildTransaction(plan).serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  );
}
export function deserializeWalletTransaction(wireBase64: string): Transaction {
  return Transaction.from(Buffer.from(unb64(wireBase64)));
}
