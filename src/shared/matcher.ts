import type { Asset, Cluster, Listing, Match } from "./types";
import { raw, netFor } from "./amounts";
import { legFor } from "./transactions";
export function findMatches(
  listings: Listing[],
  assets: Asset[],
  cluster: Cluster,
  now = Date.now(),
  anchorId?: string,
): Match[] {
  const pool = listings
    .filter(
      (l) =>
        l.cluster === cluster &&
        l.status === "OPEN" &&
        l.expiresAt > now &&
        !l.locked &&
        l.giveMint !== l.wantMint &&
        assets.some(
          (a) => a.cluster === cluster && a.mint === l.giveMint && a.tested,
        ) &&
        assets.some(
          (a) => a.cluster === cluster && a.mint === l.wantMint && a.tested,
        ) &&
        raw(l.grossRaw, false) > 0n &&
        raw(l.minReceiveNetRaw, false) > 0n &&
        (l.balanceRaw === undefined || raw(l.balanceRaw) >= raw(l.grossRaw)),
    )
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, 50);
  const byMint = new Map(assets.map((a) => [a.mint, a]));
  const edge = (a: Listing, b: Listing) =>
    a.owner !== b.owner &&
    a.giveMint === b.wantMint &&
    raw(netFor(a.grossRaw, byMint.get(a.giveMint)!)) >= raw(b.minReceiveNetRaw);
  const output: Match[] = [];
  const seen = new Set<string>();
  let budget = 625;
  const emit = (cycle: Listing[]) => {
    const id = cycle
      .map((l) => l.id + ":" + l.version)
      .sort()
      .join("|");
    if (seen.has(id)) return;
    seen.add(id);
    const legs = cycle.map((l, i) =>
      legFor(
        l.owner,
        cycle[(i + 1) % cycle.length].owner,
        byMint.get(l.giveMint)!,
        l.grossRaw,
      ),
    );
    output.push({
      id,
      mode: cycle.length === 2 ? "BASKET" : "RING",
      listings: cycle,
      legs,
      minima: cycle.map((l) => ({
        owner: l.owner,
        mint: l.wantMint,
        minNetRaw: l.minReceiveNetRaw,
      })),
    });
  };
  const roots = anchorId ? pool.filter((l) => l.id === anchorId) : pool;
  for (const a of roots)
    for (const b of pool) {
      if (output.length >= 5) return output;
      if (edge(a, b) && edge(b, a)) emit([a, b]);
    }
  for (const a of roots) {
    const next = pool.filter((b) => edge(a, b)).slice(0, 25);
    for (const b of next)
      for (const c of pool.filter((c) => edge(b, c)).slice(0, 25)) {
        if (--budget < 0 || output.length >= 5) return output;
        if (
          a.owner === c.owner ||
          new Set([a.giveMint, b.giveMint, c.giveMint]).size !== 3
        )
          continue;
        if (edge(c, a)) emit([a, b, c]);
      }
  }
  return output;
}
