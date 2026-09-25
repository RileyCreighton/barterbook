import { Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { legFor, maximumAtaRentLamports } from "../src/shared/transactions";
import type { Asset, FrozenPlan, Terms } from "../src/shared/types";
export function fixture(ownersCount = 2) {
  const owners = Array.from({ length: ownersCount }, () => Keypair.generate());
  const assets: Asset[] = Array.from({ length: 3 }, (_, i) => ({
    cluster: "devnet",
    mint: Keypair.generate().publicKey.toBase58(),
    symbol: ["TEST-A", "TEST-B", "TEST-C"][i],
    name: "Devnet test fixture",
    decimals: 6,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    hasTransferFee: true,
    olderFee: { epoch: "0", basisPoints: 100, maximumFeeRaw: "1000000000" },
    newerFee: { epoch: "100", basisPoints: 300, maximumFeeRaw: "1000000000" },
    observedEpoch: "1",
    observedSlot: "1",
    observedAt: Date.now(),
    extensions: [1],
    multiplier: "1",
    pendingMultiplier: "1",
    tested: true,
    mock: true,
  }));
  const keys = owners.map((k) => k.publicKey.toBase58());
  const legs =
    ownersCount === 2
      ? [
          legFor(keys[0], keys[1], assets[0], "10000000"),
          legFor(keys[0], keys[1], assets[1], "5000000"),
          legFor(keys[1], keys[0], assets[2], "20000000"),
        ]
      : assets.map((a, i) =>
          legFor(keys[i], keys[(i + 1) % 3], a, `${i + 1}0000000`),
        );
  const terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode: ownersCount === 2 ? "BASKET" : "RING",
    owners: keys,
    feePayer: keys[0],
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
  const plan: FrozenPlan = {
    terms,
    assets,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: "500",
    contextSlot: "1",
    computeUnitLimit: 300000,
    microLamports: "0",
    createAtas: legs.map((l) => l.destinationATA),
    networkFeeLamports: (ownersCount * 5000).toString(),
    accountRentLamports: assets
      .reduce((sum, asset) => sum + BigInt(maximumAtaRentLamports(asset)), 0n)
      .toString(),
  };
  return { owners, assets, terms, plan };
}
