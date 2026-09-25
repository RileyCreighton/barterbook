import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import {
  createLocalFixture,
  executeLocalExchange,
} from "../scripts/local-runtime";

const results: Awaited<ReturnType<typeof executeLocalExchange>>[] = [];
afterAll(() => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/litesvm-execution.json",
    JSON.stringify(
      {
        executedAt: new Date().toISOString(),
        environment: "LOCAL_LITESVM_ONLY",
        scope:
          "Local program execution, not public-network receipts. All keys and assets existed only in this in-process runtime.",
        allThreeRequiredChecksPassed: results.length === 3,
        results,
      },
      null,
      2,
    ) + "\n",
  );
});
describe("actual LOCAL Token-2022 runtime execution", () => {
  for (const mode of ["BASKET", "RING"] as const)
    it(`${mode}: checked-fee atomic exchange creates missing ATAs after immutable sequential signing`, async () => {
      const result = await executeLocalExchange(createLocalFixture(mode), mode);
      expect(result.failed, result.logs.join("\n")).toBe(false);
      expect(result.allSignaturesVerified).toBe(true);
      expect(new Set(result.messageHashesAfterEachSignature)).toEqual(
        new Set([result.messageHash]),
      );
      expect(result.wireBytes).toBeLessThanOrEqual(1232);
      expect(result.accountDeltas).toHaveLength(3);
      for (const leg of result.accountDeltas) {
        expect(leg.destinationWasMissing).toBe(true);
        expect(leg.destinationExistsAfter).toBe(true);
        expect(leg.sourceDeltaRaw).toBe((-BigInt(leg.grossRaw)).toString());
        expect(leg.destinationRaw).toBe(leg.netRaw);
        expect(leg.withheldFeeRaw).toBe(leg.feeRaw);
      }
      expect(BigInt(result.createdAccountFundingLamports)).toBeGreaterThan(0n);
      expect(result.networkFeeFromIsolatedDeltaLamports).toBe(
        mode === "BASKET" ? "10000" : "15000",
      );
      results.push(result);
    });
  it("a failing FINAL token leg rolls back earlier transfers AND all newly created ATAs", async () => {
    const result = await executeLocalExchange(
      createLocalFixture("RING"),
      "RING",
      true,
    );
    expect(result.failed, result.logs.join("\n")).toBe(true);
    expect(result.error).toContain(String(result.expectedLastInstructionIndex));
    expect(result.logs.join("\n").toLowerCase()).toContain(
      "insufficient funds",
    );
    for (const leg of result.accountDeltas) {
      expect(leg.sourceDeltaRaw).toBe("0");
      expect(leg.destinationWasMissing).toBe(true);
      expect(leg.destinationExistsAfter).toBe(false);
      expect(leg.destinationRaw).toBeNull();
    }
    expect(result.createdAccountFundingLamports).toBe("0");
    expect(result.payerDebitLamports).toBe("15000");
    expect(new Set(result.messageHashesAfterEachSignature)).toEqual(
      new Set([result.messageHash]),
    );
    results.push(result);
  });
});
