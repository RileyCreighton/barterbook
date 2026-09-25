/** Purely LOCAL execution harness. No RPC, existing wallet, public asset or network broadcast. */
import {
  FailedTransactionMetadata,
  LiteSVM,
  type TransactionMetadata,
} from "litesvm";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  getAccountLen,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMintLen,
  getTransferFeeAmount,
  getTransferFeeConfig,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import bs58 from "bs58";
import { canonical, sha256 } from "../src/shared/crypto";
import {
  buildTransaction,
  legFor,
  mergeSignature,
  verifyTransaction,
  verifyWireSignatures,
  wireParts,
} from "../src/shared/transactions";
import type {
  Asset,
  FrozenPlan,
  Terms,
  TransferLeg,
} from "../src/shared/types";

export interface LocalFixture {
  svm: LiteSVM;
  owners: Keypair[];
  assets: Asset[];
  sourceOwners: Keypair[];
  compatibilityTransfers: number;
}
const pk = (value: string) => new PublicKey(value);
function requireSuccess(
  result: TransactionMetadata | FailedTransactionMetadata,
  context: string,
): TransactionMetadata {
  if (result instanceof FailedTransactionMetadata)
    throw new Error(
      `${context}: ${result.toString()}\n${result.meta().prettyLogs()}`,
    );
  return result;
}
function submit(
  svm: LiteSVM,
  transaction: Transaction,
  signers: Keypair[],
  context: string,
): TransactionMetadata {
  transaction.recentBlockhash = svm.latestBlockhash();
  transaction.feePayer = signers[0].publicKey;
  transaction.partialSign(...signers);
  return requireSuccess(svm.sendTransaction(transaction), context);
}
function accountInfo(svm: LiteSVM, address: string) {
  const info = svm.getAccount(pk(address));
  return info ? { ...info, data: Buffer.from(info.data) } : null;
}
export function localTokenAccount(svm: LiteSVM, address: string) {
  return unpackAccount(
    pk(address),
    accountInfo(svm, address),
    TOKEN_2022_PROGRAM_ID,
  );
}

export function createLocalFixture(mode: "BASKET" | "RING"): LocalFixture {
  const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
  const owners = Array.from({ length: mode === "BASKET" ? 2 : 3 }, () =>
    Keypair.generate(),
  );
  const payer = owners[0];
  requireSuccess(
    svm.airdrop(payer.publicKey, 5_000_000_000n)!,
    "LOCAL funding",
  );
  const sourceOwners =
    mode === "BASKET" ? [owners[0], owners[0], owners[1]] : owners;
  const assets: Asset[] = [];
  for (let i = 0; i < 3; i++) {
    const mint = Keypair.generate();
    const sourceOwner = sourceOwners[i];
    const source = getAssociatedTokenAddressSync(
      mint.publicKey,
      sourceOwner.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const mintSize = getMintLen([ExtensionType.TransferFeeConfig]);
    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(mintSize))),
        space: mintSize,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferFeeConfigInstruction(
        mint.publicKey,
        payer.publicKey,
        payer.publicKey,
        100,
        1_000_000n,
        TOKEN_2022_PROGRAM_ID,
      ),
      createInitializeMintInstruction(
        mint.publicKey,
        6,
        payer.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        source,
        sourceOwner.publicKey,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToCheckedInstruction(
        mint.publicKey,
        source,
        payer.publicKey,
        1_000_000_000n,
        6,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    submit(svm, tx, [payer, mint], `Create LOCAL test mint ${i}`);
    // A distinct throwaway receiver keeps every actual trade destination uncreated.
    const compatibilityOwner = Keypair.generate().publicKey;
    const compatibilityAta = getAssociatedTokenAddressSync(
      mint.publicKey,
      compatibilityOwner,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const compatibility = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(
        payer.publicKey,
        compatibilityAta,
        compatibilityOwner,
        mint.publicKey,
        TOKEN_2022_PROGRAM_ID,
      ),
      createTransferCheckedWithFeeInstruction(
        source,
        mint.publicKey,
        compatibilityAta,
        sourceOwner.publicKey,
        100_001n,
        6,
        1_001n,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    submit(
      svm,
      compatibility,
      sourceOwner === payer ? [payer] : [payer, sourceOwner],
      `LOCAL compatibility transfer ${i}`,
    );
    if (
      localTokenAccount(svm, compatibilityAta.toBase58()).amount !== 99_000n ||
      getTransferFeeAmount(localTokenAccount(svm, compatibilityAta.toBase58()))
        ?.withheldAmount !== 1_001n
    )
      throw new Error("LOCAL compatibility transfer gross/fee/net mismatch");
    const state = unpackMint(
        mint.publicKey,
        accountInfo(svm, mint.publicKey.toBase58()),
        TOKEN_2022_PROGRAM_ID,
      ),
      fee = getTransferFeeConfig(state)!;
    const schedule = (s: typeof fee.olderTransferFee) => ({
      epoch: String(s.epoch),
      basisPoints: s.transferFeeBasisPoints,
      maximumFeeRaw: String(s.maximumFee),
    });
    assets.push({
      cluster: "devnet",
      mint: mint.publicKey.toBase58(),
      symbol: `LOCAL-${String.fromCharCode(65 + i)}`,
      name: `LOCAL in-process test asset ${i}; never published to devnet`,
      decimals: state.decimals,
      tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      hasTransferFee: true,
      olderFee: schedule(fee.olderTransferFee),
      newerFee: schedule(fee.newerTransferFee),
      observedEpoch: String(svm.getClock().epoch),
      observedSlot: String(svm.getClock().slot),
      observedAt: Date.now(),
      extensions: getExtensionTypes(state.tlvData),
      multiplier: "1",
      pendingMultiplier: "1",
      tested: true,
      mock: true,
    });
  }
  return { svm, owners, assets, sourceOwners, compatibilityTransfers: 3 };
}

export function localLegs(
  fixture: LocalFixture,
  mode: "BASKET" | "RING",
): TransferLeg[] {
  const owners = fixture.owners.map((o) => o.publicKey.toBase58());
  return mode === "BASKET"
    ? [
        legFor(owners[0], owners[1], fixture.assets[0], "10000001"),
        legFor(owners[0], owners[1], fixture.assets[1], "5000001"),
        legFor(owners[1], owners[0], fixture.assets[2], "20000001"),
      ]
    : fixture.assets.map((asset, i) =>
        legFor(owners[i], owners[(i + 1) % 3], asset, `${i + 1}0000001`),
      );
}

export async function executeLocalExchange(
  fixture: LocalFixture,
  mode: "BASKET" | "RING",
  failFinalLeg = false,
) {
  const { svm, owners, assets } = fixture;
  const legs = localLegs(fixture, mode);
  if (failFinalLeg) {
    const last = [...legs]
      .sort((a, b) => canonical(a).localeCompare(canonical(b)))
      .at(-1)!;
    const overflowing = legFor(
      last.fromOwner,
      last.toOwner,
      assets.find((a) => a.mint === last.mint)!,
      (localTokenAccount(svm, last.sourceAccount).amount + 1n).toString(),
    );
    legs[legs.findIndex((l) => l.sourceAccount === last.sourceAccount)] =
      overflowing;
  }
  const ownerKeys = owners.map((o) => o.publicKey.toBase58());
  const receivingSize = getAccountLen([
    ExtensionType.TransferFeeAmount,
    ExtensionType.ImmutableOwner,
  ]);
  const accountRent =
    svm.minimumBalanceForRentExemption(BigInt(receivingSize)) *
    BigInt(legs.length);
  const terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode,
    owners: ownerKeys,
    feePayer: ownerKeys[0],
    maxNetworkFeeLamports: "50000",
    maxAccountRentLamports: accountRent.toString(),
    legs,
    minima: legs.map((l) => ({
      owner: l.toOwner,
      mint: l.mint,
      minNetRaw: l.netRaw,
    })),
    expiresAt: Date.now() + 3600000,
  };
  // Shared types currently identify configured public networks only. The devnet
  // tag exercises that policy; the transport and all evidence here remain LOCAL.
  const plan: FrozenPlan = {
    terms,
    assets,
    blockhash: svm.latestBlockhash(),
    lastValidBlockHeight: "150",
    contextSlot: String(svm.getClock().slot),
    computeUnitLimit: 300000,
    microLamports: "0",
    createAtas: legs.map((l) => l.destinationATA),
    networkFeeLamports: String(owners.length * 5000),
    accountRentLamports: accountRent.toString(),
  };
  let bytes: Uint8Array = new Uint8Array(
    buildTransaction(plan).serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }),
  );
  const messageHash = await sha256(wireParts(bytes).message);
  const messageHashesAfterEachSignature: string[] = [];
  for (const owner of owners) {
    verifyTransaction(bytes, plan, terms);
    const transaction = Transaction.from(bytes);
    transaction.partialSign(owner);
    bytes = await mergeSignature(
      bytes,
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
      owner.publicKey.toBase58(),
      plan,
    );
    messageHashesAfterEachSignature.push(
      await sha256(wireParts(bytes).message),
    );
  }
  await verifyWireSignatures(bytes, plan, true);
  const missingBefore = legs.map(
    (l) => svm.getAccount(pk(l.destinationATA)) === null,
  );
  const sourceBefore = legs.map(
    (l) => localTokenAccount(svm, l.sourceAccount).amount,
  );
  const payerBefore = svm.getBalance(owners[0].publicKey)!;
  const result = svm.sendTransaction(Transaction.from(bytes));
  const failed = result instanceof FailedTransactionMetadata;
  const metadata = failed ? result.meta() : result;
  const sourceAfter = legs.map(
    (l) => localTokenAccount(svm, l.sourceAccount).amount,
  );
  const destinations = legs.map((l) =>
    svm.getAccount(pk(l.destinationATA)) === null
      ? null
      : localTokenAccount(svm, l.destinationATA),
  );
  const payerDebit = payerBefore - svm.getBalance(owners[0].publicKey)!;
  const actualAccountFunding = legs.reduce(
    (sum, l) =>
      sum + BigInt(svm.getAccount(pk(l.destinationATA))?.lamports ?? 0),
    0n,
  );
  return {
    environment: "LOCAL_LITESVM_ONLY",
    runtime: "litesvm@0.8.0",
    networkBroadcast: false,
    publicExplorerUrl: null,
    scope:
      "Actual in-process execution of bundled Solana Token-2022 and ATA programs with signature/blockhash verification. Not devnet/mainnet execution, browser-wallet proof, or an RPC receipt.",
    mode,
    owners: owners.length,
    transfers: legs.length,
    compatibilityTransfers: fixture.compatibilityTransfers,
    localTransactionSignature: bs58.encode(metadata.signature()),
    messageHash,
    messageHashesAfterEachSignature,
    wireBytes: bytes.length,
    allSignaturesVerified: true,
    signatureVerificationEnabled: true,
    failed,
    error: failed ? result.err().toString() : null,
    computeUnitsConsumed: metadata.computeUnitsConsumed().toString(),
    logs: metadata.logs(),
    metadataSource:
      "Native LiteSVM execution result plus immediate before/after account snapshots around this single synchronous transaction. No unrelated transactions intervene.",
    payerDebitLamports: payerDebit.toString(),
    createdAccountFundingLamports: actualAccountFunding.toString(),
    networkFeeFromIsolatedDeltaLamports: (
      payerDebit - actualAccountFunding
    ).toString(),
    expectedLastInstructionIndex: 2 + legs.length + legs.length - 1,
    accountDeltas: legs.map((leg, i) => ({
      mint: leg.mint,
      source: leg.sourceAccount,
      destination: leg.destinationATA,
      grossRaw: leg.grossRaw,
      feeRaw: leg.expectedFeeRaw,
      netRaw: leg.netRaw,
      sourceDeltaRaw: (sourceAfter[i] - sourceBefore[i]).toString(),
      destinationWasMissing: missingBefore[i],
      destinationExistsAfter: destinations[i] !== null,
      destinationRaw: destinations[i]?.amount.toString() ?? null,
      withheldFeeRaw: destinations[i]
        ? (getTransferFeeAmount(destinations[i]!)?.withheldAmount.toString() ??
          null)
        : null,
    })),
  };
}
