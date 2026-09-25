import { PublicKey, Transaction } from "@solana/web3.js";
import { existsSync } from "node:fs";
import { getAccount, getMint, getTransferFeeConfig } from "@solana/spl-token";
import { join } from "node:path";
import { requireFunding } from "./devnet-faucet";
import {
  buildTransaction,
  legFor,
  mergeSignature,
  verifyTransaction,
  verifyWireSignatures,
  wireParts,
  maximumAtaRentLamports,
} from "../src/shared/transactions";
import { canonical, sha256 } from "../src/shared/crypto";
import type {
  Asset,
  FrozenPlan,
  Terms,
  TransferLeg,
} from "../src/shared/types";
import {
  assertDevnet,
  args,
  openRun,
  journalPath,
  readRpc,
  type Journal,
  connection,
  fixtureKey,
  publicEvidence,
  readJson,
  sendFixtureTransaction,
  tokenDelta,
} from "./devnet-common";

await assertDevnet();
const execution = openRun(args());
execution.beforeBroadcast = () => requireFunding(execution);
const assets = readJson<Asset[]>(join(execution.evidenceRoot, "assets.json"));
if (
  assets.length !== 3 ||
  assets.some((a) => a.cluster !== "devnet" || !a.mock || !a.tested)
)
  throw new Error("Require three successfully tested devnet mock assets");
const wallets = [0, 1, 2].map((i) => fixtureKey(execution, `wallet-${i}`));
const ownerKeys = wallets.map((w) => w.publicKey.toBase58());
async function run(
  name: string,
  mode: "BASKET" | "RING",
  legs: TransferLeg[],
  fail = false,
) {
  const owners = mode === "BASKET" ? ownerKeys.slice(0, 2) : ownerKeys;
  let terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode,
    owners,
    feePayer: owners[0],
    maxNetworkFeeLamports: "50000",
    maxAccountRentLamports: "20000000",
    legs,
    minima: legs.map((l) => ({
      owner: l.toOwner,
      mint: l.mint,
      minNetRaw: l.netRaw,
    })),
    expiresAt: Date.now() + 3600000,
  };
  if (existsSync(journalPath(execution, name))) {
    const saved = readJson<Journal>(journalPath(execution, name));
    if (!saved.sdkSigning)
      throw new Error(
        "Original SDK plan is missing; retain journal for manual reconciliation",
      );
    terms = saved.sdkSigning.plan.terms;
    legs = terms.legs;
  }
  const receipt = await sendFixtureTransaction(
    execution,
    name,
    async (blockhash, life) => {
      const epoch = await connection.getEpochInfo("confirmed");
      const refreshedAssets: Asset[] = [];
      for (const asset of assets) {
        const state = await readRpc(() =>
          getMint(
            connection,
            new PublicKey(asset.mint),
            "confirmed",
            new PublicKey(asset.tokenProgram),
          ),
        );
        const fee = getTransferFeeConfig(state);
        if (!fee || state.decimals !== asset.decimals)
          throw new Error("Mint fee configuration changed unexpectedly");
        refreshedAssets.push({
          ...asset,
          observedEpoch: String(epoch.epoch),
          observedSlot: String(epoch.absoluteSlot),
          observedAt: Date.now(),
          olderFee: {
            epoch: String(fee.olderTransferFee.epoch),
            basisPoints: fee.olderTransferFee.transferFeeBasisPoints,
            maximumFeeRaw: String(fee.olderTransferFee.maximumFee),
          },
          newerFee: {
            epoch: String(fee.newerTransferFee.epoch),
            basisPoints: fee.newerTransferFee.transferFeeBasisPoints,
            maximumFeeRaw: String(fee.newerTransferFee.maximumFee),
          },
        });
      }
      // Terms are fixed before signatures. A fee change requires a fresh explicitly named review, never silent net changes.
      for (const leg of legs)
        if (
          legFor(
            leg.fromOwner,
            leg.toOwner,
            refreshedAssets.find((a) => a.mint === leg.mint)!,
            leg.grossRaw,
          ).expectedFeeRaw !== leg.expectedFeeRaw
        )
          throw new Error(
            "Mint fees changed; original exact terms need review",
          );
      // The journal helper owns lifetime selection; plan blockhash must be identical to its argument.
      const plan: FrozenPlan = {
        terms,
        assets: refreshedAssets,
        blockhash,
        lastValidBlockHeight: String(life.lastValidBlockHeight),
        contextSlot: String(epoch.absoluteSlot),
        computeUnitLimit: 300000,
        microLamports: "0",
        createAtas: [...new Set(legs.map((l) => l.destinationATA))],
        networkFeeLamports: String(owners.length * 5000),
        accountRentLamports: [...new Set(legs.map((leg) => leg.destinationATA))]
          .reduce((total, destination) => {
            const leg = legs.find((l) => l.destinationATA === destination)!;
            return (
              total +
              BigInt(
                maximumAtaRentLamports(
                  refreshedAssets.find((a) => a.mint === leg.mint)!,
                ),
              )
            );
          }, 0n)
          .toString(),
      };
      let bytes: Uint8Array = new Uint8Array(
        buildTransaction(plan).serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        }),
      );
      const originalHash = await sha256(wireParts(bytes).message);
      const hashes = [];
      for (const wallet of wallets.slice(0, owners.length)) {
        verifyTransaction(bytes, plan, terms);
        const transaction = Transaction.from(bytes);
        transaction.partialSign(wallet);
        bytes = await mergeSignature(
          bytes,
          transaction.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
          wallet.publicKey.toBase58(),
          plan,
        );
        hashes.push(await sha256(wireParts(bytes).message));
      }
      await verifyWireSignatures(bytes, plan, true);
      if (hashes.some((h) => h !== originalHash))
        throw new Error("Signing changed message");
      return {
        transaction: Transaction.from(bytes),
        sdkSigning: { plan, messageHashesAfterEachSignature: hashes },
      };
    },
    wallets.slice(0, owners.length),
    fail,
  );
  const deltas = legs.map((l) => ({
    mint: l.mint,
    source: l.sourceAccount,
    destination: l.destinationATA,
    sourceDeltaRaw: tokenDelta(receipt, l.sourceAccount, l.mint, {
      owner: l.fromOwner,
      programId: l.tokenProgram,
      decimals: l.decimals,
    }).toString(),
    destinationDeltaRaw: tokenDelta(receipt, l.destinationATA, l.mint, {
      owner: l.toOwner,
      programId: l.tokenProgram,
      decimals: l.decimals,
    }).toString(),
    grossRaw: l.grossRaw,
    feeRaw: l.expectedFeeRaw,
    netRaw: l.netRaw,
  }));
  for (const d of deltas) {
    if (
      fail
        ? d.sourceDeltaRaw !== "0" || d.destinationDeltaRaw !== "0"
        : d.sourceDeltaRaw !== (-BigInt(d.grossRaw)).toString() ||
          d.destinationDeltaRaw !== d.netRaw
    )
      throw new Error(
        "Actual transaction token deltas do not match expected atomic outcome",
      );
  }
  const meta = receipt.meta!;
  if (fail) {
    const failure = meta.err as { InstructionError?: [number, unknown] } | null;
    const lastInstruction =
      2 + new Set(legs.map((l) => l.destinationATA)).size + legs.length - 1;
    if (failure?.InstructionError?.[0] !== lastInstruction)
      throw new Error(
        "Controlled failure did not occur at the final transfer instruction",
      );
  }
  if (
    ![meta.fee, meta.preBalances[0], meta.postBalances[0]].every(
      Number.isSafeInteger,
    )
  )
    throw new Error("Unsafe RPC SOL metadata integer");
  const actualAccountRent =
    BigInt(meta.preBalances[0]) -
    BigInt(meta.postBalances[0]) -
    BigInt(meta.fee);
  if (
    actualAccountRent < 0n ||
    actualAccountRent > BigInt(terms.maxAccountRentLamports) ||
    BigInt(meta.fee) > BigInt(terms.maxNetworkFeeLamports)
  )
    throw new Error("Transaction metadata SOL costs exceed accepted caps");
  const journal = readJson<Journal>(journalPath(execution, name));
  publicEvidence(execution, `${name}-receipt.json`, {
    runId: execution.runId,
    buildId: journal.buildId,
    commitment: "finalized",
    explorer: `https://explorer.solana.com/tx/${journal.txid}?cluster=devnet`,
    blockTime: receipt.blockTime ?? null,
    cluster: "devnet",
    assetKind: "mock tokens, not PRE",
    signingMethod: "SDK keypairs, not browser wallets",
    status: fail ? "FAILED_ONCHAIN_FINALIZED" : "FINALIZED",
    txid: receipt.transaction.signatures[0],
    messageHash: await sha256(receipt.transaction.message.serialize()),
    slot: String(receipt.slot),
    networkFeeLamports: String(receipt.meta!.fee),
    accountRentLamports: actualAccountRent.toString(),
    verified: true,
    deltas,
    atomicRollbackVerified: fail,
  });
  console.log(
    `${name}: ${fail ? "finalized failure; all token deltas zero" : "finalized; exact token deltas verified"}`,
  );
}
const basket = [
  legFor(ownerKeys[0], ownerKeys[1], assets[0], "10000000"),
  legFor(ownerKeys[0], ownerKeys[1], assets[1], "5000000"),
  legFor(ownerKeys[1], ownerKeys[0], assets[2], "20000000"),
];
await run("devnet-two-for-one", "BASKET", basket);
const ring = [
  legFor(ownerKeys[0], ownerKeys[2], assets[0], "10000000"),
  legFor(ownerKeys[1], ownerKeys[0], assets[1], "20000000"),
  legFor(ownerKeys[2], ownerKeys[1], assets[2], "15000000"),
];
await run("devnet-three-way", "RING", ring);
let failureLegs: TransferLeg[];
const failureName = "devnet-atomic-last-leg-failure";
if (existsSync(journalPath(execution, failureName))) {
  const saved = readJson<Journal>(journalPath(execution, failureName));
  if (!saved.sdkSigning)
    throw new Error(
      "Original controlled-failure plan is missing; retain journal",
    );
  failureLegs = saved.sdkSigning.plan.terms.legs;
} else {
  failureLegs = ring.map((l) => ({ ...l }));
  const last = [...failureLegs]
    .sort((a, b) => canonical(a).localeCompare(canonical(b)))
    .at(-1)!;
  const state = await readRpc(() =>
    getAccount(
      connection,
      new PublicKey(last.sourceAccount),
      "confirmed",
      new PublicKey(last.tokenProgram),
    ),
  );
  const replacement = legFor(
    last.fromOwner,
    last.toOwner,
    assets.find((a) => a.mint === last.mint)!,
    String(state.amount + 1n),
  );
  failureLegs[
    failureLegs.findIndex((l) => l.sourceAccount === last.sourceAccount)
  ] = replacement;
}
await run(failureName, "RING", failureLegs, true);
