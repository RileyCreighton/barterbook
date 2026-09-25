import { describe, it, expect } from "vitest";
import { calculateFee } from "@solana/spl-token";
import {
  activeFee,
  feeFor,
  grossForNet,
  parseAmount,
  U64_MAX,
} from "../src/shared/amounts";
import { fixture } from "./fixtures";
import { legFor, validateTerms } from "../src/shared/transactions";
describe("exact financial boundaries", () => {
  it("matches the SPL SDK at rounding, cap and u64 boundaries", () => {
    for (const bps of [0, 1, 100, 300, 10000])
      for (const cap of [0n, 1n, 100n, U64_MAX])
        for (const gross of [0n, 1n, 99n, 100n, 101n, 9999n, 10000n, U64_MAX]) {
          const s = {
            epoch: "0",
            basisPoints: bps,
            maximumFeeRaw: cap.toString(),
          };
          expect(BigInt(feeFor(gross.toString(), s))).toBe(
            calculateFee(
              { epoch: 0n, transferFeeBasisPoints: bps, maximumFee: cap },
              gross,
            ),
          );
        }
  });
  it("grosses up to the least feasible raw unit and rejects impossible receipt", () => {
    const s = { epoch: "0", basisPoints: 300, maximumFeeRaw: "100" };
    for (const desired of ["1", "99", "101", "99999999999999"]) {
      const g = BigInt(grossForNet(desired, U64_MAX.toString(), s));
      expect(g - BigInt(feeFor(g.toString(), s))).toBeGreaterThanOrEqual(
        BigInt(desired),
      );
      expect(g - 1n - BigInt(feeFor((g - 1n).toString(), s))).toBeLessThan(
        BigInt(desired),
      );
    }
    expect(() => grossForNet("2", "1", s)).toThrow();
  });
  it("never rounds decimal input or accepts unsafe/negative quantities", () => {
    expect(parseAmount("9007199254.740993", 6)).toBe("9007199254740993");
    for (const s of ["1.0000001", "-1", "1e3", "01", "Infinity"])
      expect(() => parseAmount(s, 6)).toThrow();
  });
  it("rejects stale fee terms on epoch switch", () => {
    const f = fixture();
    f.assets[0].observedEpoch = "100";
    expect(activeFee(f.assets[0]).basisPoints).toBe(300);
    expect(() => validateTerms(f.terms, f.assets)).toThrow(/fee/);
  });
  it("rejects duplicate, opposite mint flows and insufficient net minima", () => {
    const f = fixture();
    const opposing = legFor(
      f.terms.owners[1],
      f.terms.owners[0],
      f.assets[0],
      "10000",
    );
    expect(() =>
      validateTerms(
        { ...f.terms, legs: [...f.terms.legs, opposing] },
        f.assets,
      ),
    ).toThrow(/Opposing/);
    expect(() =>
      validateTerms(
        { ...f.terms, legs: [...f.terms.legs, f.terms.legs[0]] },
        f.assets,
      ),
    ).toThrow(/Duplicate/);
    f.terms.minima[0].minNetRaw = f.terms.legs[0].grossRaw;
    expect(() => validateTerms(f.terms, f.assets)).toThrow(/minimum/);
  });
});
