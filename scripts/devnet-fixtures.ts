import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
  getMintLen,
  getTransferFeeConfig,
} from "@solana/spl-token";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireFunding } from "./devnet-faucet";
import type { Asset } from "../src/shared/types";
import {
  assertDevnet,
  connection,
  args,
  openRun,
  participants,
  readJson,
  readRpc,
  safeName,
  fixtureKey,
  publicEvidence,
  sendFixtureTransaction,
  tokenDelta,
} from "./devnet-common";

await assertDevnet();
const options = args();
const run = openRun(options);
const roster = participants(run, options.get("--browser-participants"));
const wallets = [0, 1, 2].map((i) => fixtureKey(run, `wallet-${i}`));
const payer = wallets[0];
if (options.has("--init-only")) {
  console.log(
    `Created/reused disposable SDK wallets and public participant manifest for ${run.runId}. No faucet request or transaction sent.`,
  );
  process.exit(0);
}
run.beforeBroadcast = () => requireFunding(run);
const assets: Asset[] = [];
for (let i = 0; i < 3; i++) {
  const mint = fixtureKey(run, `mint-${i}`);
  const mintLength = getMintLen([ExtensionType.TransferFeeConfig]);
  const rent = await readRpc(() =>
    connection.getMinimumBalanceForRentExemption(mintLength),
  );
  await sendFixtureTransaction(
    run,
    `devnet-mint-${i}`,
    (blockhash) => {
      const tx = new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: blockhash,
      });
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: payer.publicKey,
          newAccountPubkey: mint.publicKey,
          lamports: rent,
          space: mintLength,
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
      );
      for (const wallet of wallets) {
        const address = getAssociatedTokenAddressSync(
          mint.publicKey,
          wallet.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            payer.publicKey,
            address,
            wallet.publicKey,
            mint.publicKey,
            TOKEN_2022_PROGRAM_ID,
          ),
          createMintToCheckedInstruction(
            mint.publicKey,
            address,
            payer.publicKey,
            1_000_000_000n,
            6,
            [],
            TOKEN_2022_PROGRAM_ID,
          ),
        );
      }
      return tx;
    },
    [payer, mint],
  );
  const source = getAssociatedTokenAddressSync(
      mint.publicKey,
      payer.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    ),
    destination = getAssociatedTokenAddressSync(
      mint.publicKey,
      wallets[1].publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
  const receipt = await sendFixtureTransaction(
    run,
    `devnet-compatibility-${i}`,
    (blockhash) =>
      new Transaction({
        feePayer: payer.publicKey,
        recentBlockhash: blockhash,
      }).add(
        createTransferCheckedWithFeeInstruction(
          source,
          mint.publicKey,
          destination,
          payer.publicKey,
          100_001n,
          6,
          1_001n,
          [],
          TOKEN_2022_PROGRAM_ID,
        ),
      ),
    [payer],
  );
  if (
    tokenDelta(receipt, source.toBase58(), mint.publicKey.toBase58(), {
      owner: payer.publicKey.toBase58(),
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: 6,
    }) !== -100_001n ||
    tokenDelta(receipt, destination.toBase58(), mint.publicKey.toBase58(), {
      owner: wallets[1].publicKey.toBase58(),
      programId: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: 6,
    }) !== 99_000n
  )
    throw new Error("Compatibility receipt did not match fee-aware transfer");
  const state = await getMint(
    connection,
    mint.publicKey,
    "confirmed",
    TOKEN_2022_PROGRAM_ID,
  );
  const fee = getTransferFeeConfig(state);
  if (!fee) throw new Error("Transfer fee config missing");
  const epoch = await connection.getEpochInfo("confirmed");
  assets.push({
    cluster: "devnet",
    mint: mint.publicKey.toBase58(),
    symbol: `TEST-${String.fromCharCode(65 + i)}`,
    name: `BarterBook devnet test asset ${String.fromCharCode(65 + i)} (not PRE)`,
    decimals: state.decimals,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    hasTransferFee: true,
    olderFee: {
      epoch: fee.olderTransferFee.epoch.toString(),
      basisPoints: fee.olderTransferFee.transferFeeBasisPoints,
      maximumFeeRaw: fee.olderTransferFee.maximumFee.toString(),
    },
    newerFee: {
      epoch: fee.newerTransferFee.epoch.toString(),
      basisPoints: fee.newerTransferFee.transferFeeBasisPoints,
      maximumFeeRaw: fee.newerTransferFee.maximumFee.toString(),
    },
    observedEpoch: String(epoch.epoch),
    observedSlot: String(epoch.absoluteSlot),
    observedAt: Date.now(),
    extensions: getExtensionTypes(state.tlvData),
    multiplier: "1",
    pendingMultiplier: "1",
    tested: true,
    mock: true,
  });
  const assetPath = join(run.evidenceRoot, `asset-${i}.json`);
  if (existsSync(assetPath)) {
    const previous = readJson<Asset>(assetPath);
    if (
      previous.mint !== assets[i].mint ||
      previous.tokenProgram !== assets[i].tokenProgram
    )
      throw new Error("Existing asset evidence differs from this mint");
    assets[i] = previous;
  } else publicEvidence(run, `asset-${i}.json`, assets[i]);
  console.log(
    `TEST-${String.fromCharCode(65 + i)} compatibility transfer finalized; raw receipt verified.`,
  );
}
publicEvidence(run, "assets.json", assets);
// Browser public addresses receive only mock inventory. Their keys and approvals stay in their extensions.
const inventoryBatch = options.has("--replenish")
  ? safeName(options.get("--batch") ?? "")
  : "initial";
const recipients = options.has("--replenish")
  ? roster
  : roster.filter((p) => p.kind === "browser");
for (const participant of recipients)
  for (let i = 0; i < assets.length; i++) {
    const mint = new PublicKey(assets[i].mint);
    const owner = new PublicKey(participant.publicKey);
    const destination = getAssociatedTokenAddressSync(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await sendFixtureTransaction(
      run,
      `inventory-${inventoryBatch}-${participant.id}-${i}`,
      (blockhash) =>
        new Transaction({
          feePayer: payer.publicKey,
          recentBlockhash: blockhash,
        }).add(
          createAssociatedTokenAccountIdempotentInstruction(
            payer.publicKey,
            destination,
            owner,
            mint,
            TOKEN_2022_PROGRAM_ID,
          ),
          createMintToCheckedInstruction(
            mint,
            destination,
            payer.publicKey,
            1_000_000_000n,
            6,
            [],
            TOKEN_2022_PROGRAM_ID,
          ),
        ),
      [payer],
    );
  }
console.log(
  "Three devnet mock assets passed actual fee-aware transfers. This is SDK execution evidence, not browser-wallet proof.",
);
