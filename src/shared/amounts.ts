import type { Asset, FeeSchedule } from "./types";
export const U64_MAX = (1n << 64n) - 1n;
export function raw(value: string, allowZero = true): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value))
    throw new Error("Use a canonical raw integer string");
  // A u64 has at most 20 decimal digits. Reject oversized input before BigInt
  // parsing so invalid requests cannot consume the Worker's CPU budget.
  if (value.length > 20) throw new Error("Amount outside allowed u64 range");
  const n = BigInt(value);
  if (n > U64_MAX || (!allowZero && n === 0n))
    throw new Error("Amount outside allowed u64 range");
  return n;
}
export function parseAmount(input: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18)
    throw new Error("Unsupported decimals");
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(input))
    throw new Error("Enter an unsigned decimal amount");
  const [whole, fraction = ""] = input.split(".");
  if (whole.length > 20) throw new Error("Amount outside allowed u64 range");
  if (fraction.length > decimals)
    throw new Error(
      `At most ${decimals} decimal places; amounts are never rounded`,
    );
  return raw(
    (
      BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, "0") || "0")
    ).toString(),
  ).toString();
}
export function formatAmount(value: string, decimals: number): string {
  const n = raw(value),
    scale = 10n ** BigInt(decimals);
  const fraction = (n % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${n / scale}${fraction ? "." + fraction : ""}`;
}
export function activeFee(
  asset: Asset,
  epoch = asset.observedEpoch,
): FeeSchedule {
  return raw(epoch) >= raw(asset.newerFee.epoch)
    ? asset.newerFee
    : asset.olderFee;
}
export function feeFor(gross: string, schedule: FeeSchedule): string {
  const g = raw(gross),
    cap = raw(schedule.maximumFeeRaw),
    b = schedule.basisPoints;
  if (!Number.isInteger(b) || b < 0 || b > 10000)
    throw new Error("Invalid fee basis points");
  const rounded = (g * BigInt(b) + 9999n) / 10000n;
  return (rounded < cap ? rounded : cap).toString();
}
export function netFor(
  gross: string,
  asset: Asset,
  epoch = asset.observedEpoch,
): string {
  return (
    raw(gross) -
    BigInt(asset.hasTransferFee ? feeFor(gross, activeFee(asset, epoch)) : "0")
  ).toString();
}
export function grossForNet(
  net: string,
  limit: string,
  schedule: FeeSchedule,
): string {
  const wanted = raw(net, false),
    max = raw(limit);
  const received = (g: bigint) => g - BigInt(feeFor(g.toString(), schedule));
  if (received(max) < wanted)
    throw new Error("Minimum net cannot be funded within the gross limit");
  let lo = 0n,
    hi = max;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (received(mid) >= wanted) hi = mid;
    else lo = mid + 1n;
  }
  return lo.toString();
}
