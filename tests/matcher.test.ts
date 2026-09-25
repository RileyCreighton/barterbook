import { it, expect } from "vitest";
import { fixture } from "./fixtures";
import { findMatches } from "../src/shared/matcher";
import type { Listing } from "../src/shared/types";
function market() {
  const f = fixture(3);
  const listings: Listing[] = f.terms.owners.map((owner, i) => ({
    id: String(i),
    owner,
    cluster: "devnet",
    giveMint: f.assets[i].mint,
    wantMint: f.assets[(i + 2) % 3].mint,
    grossRaw: "100",
    minReceiveNetRaw: "99",
    expiresAt: Date.now() + 60000,
    version: 1,
    status: "OPEN",
    createdAt: Date.now(),
    balanceRaw: "100",
  }));
  return { ...f, listings };
}
it("matches exact whole lots, minima and deduplicates rotations", () => {
  const f = market(),
    m = findMatches(f.listings, f.assets, "devnet");
  expect(m).toHaveLength(1);
  expect(
    m[0].legs.every((l) => l.grossRaw === "100" && l.netRaw === "99"),
  ).toBe(true);
});
it("rejects cycle-shaped graph whose fees violate one receipt", () => {
  const f = market();
  f.listings[1].minReceiveNetRaw = "100";
  expect(findMatches(f.listings, f.assets, "devnet")).toHaveLength(0);
});
it("excludes repeated owners, insufficient balance, locked, expired and other-network lots", () => {
  for (const field of [
    { owner: "" },
    { balanceRaw: "99" },
    { locked: true },
    { expiresAt: 0 },
    { cluster: "mainnet-beta" },
  ]) {
    const f = market();
    Object.assign(
      f.listings[1],
      field.owner === "" ? { owner: f.listings[0].owner } : field,
    );
    expect(findMatches(f.listings, f.assets, "devnet")).toHaveLength(0);
  }
});
