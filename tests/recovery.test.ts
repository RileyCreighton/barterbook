import { it, expect } from "vitest";
import { fixture } from "./fixtures";
import type { Attempt } from "../src/shared/types";
import {
  reconcileDecision,
  mayPrepareReplacement,
  type ChainObservation,
} from "../src/shared/recovery";
const attempt = () =>
  ({
    id: "original",
    plan: fixture().plan,
    txid: "original-signature",
    state: "SUBMISSION_STARTED",
    safeToRetry: false,
  }) as Attempt;
const obs = (extra: Partial<ChainObservation> = {}): ChainObservation => ({
  endpoint: "primary",
  healthy: true,
  historyTrusted: true,
  finalizedBlockHeight: "501",
  blockhashValid: false,
  status: null,
  transactionFound: false,
  transactionErr: null,
  transactionFinalized: false,
  ...extra,
});
it("recovers success after send timeout/reload, even after expiry", () => {
  const a = attempt();
  const d = reconcileDecision(a, [
    obs({ status: { confirmation: "finalized", err: null } }),
  ]);
  expect(d.state).toBe("FINALIZED");
  expect(mayPrepareReplacement({ ...a, ...d })).toBe(false);
});
it("timeout, cancel and single cache/history miss cannot unlock", () => {
  const a = attempt();
  a.stopRequested = true;
  for (const views of [
    [],
    [obs()],
    [obs({ healthy: false })],
    [obs(), obs({ endpoint: "fallback", historyTrusted: false })],
  ]) {
    expect(reconcileDecision(a, views).safeToRetry).toBe(false);
  }
  expect(mayPrepareReplacement(a)).toBe(false);
});
it("requires both authoritative histories after finalized expiry", () => {
  const a = attempt();
  expect(
    reconcileDecision(a, [obs(), obs({ endpoint: "fallback" })]).safeToRetry,
  ).toBe(true);
  expect(
    reconcileDecision(a, [
      obs(),
      obs({ endpoint: "fallback", finalizedBlockHeight: "500" }),
    ]).safeToRetry,
  ).toBe(false);
});
it("finalized chain failure, not preflight failure, permits renewed consent", () => {
  const a = attempt();
  expect(
    reconcileDecision(a, [
      obs({
        status: {
          confirmation: "confirmed",
          err: { InstructionError: [1, "InsufficientFunds"] },
        },
      }),
    ]).safeToRetry,
  ).toBe(false);
  expect(
    reconcileDecision(a, [
      obs({
        status: {
          confirmation: "finalized",
          err: { InstructionError: [1, "InsufficientFunds"] },
        },
      }),
    ]).safeToRetry,
  ).toBe(true);
});
it("conflicting evidence and missing ID stay unresolved", () => {
  const a = attempt();
  expect(
    reconcileDecision(a, [
      obs({ status: { confirmation: "finalized", err: null } }),
      obs({
        endpoint: "fallback",
        status: { confirmation: "finalized", err: { error: 1 } },
      }),
    ]).state,
  ).toBe("STATUS_UNKNOWN");
  a.txid = null;
  expect(
    reconcileDecision(a, [obs(), obs({ endpoint: "fallback" })]).safeToRetry,
  ).toBe(false);
});
it("can resume the same unsigned message after transient history outage before lifetime ends", () => {
  const a = attempt();
  a.txid = null;
  a.submissionStartedAt = null;
  a.state = "STATUS_UNKNOWN";
  a.stopRequested = false;
  const d = reconcileDecision(a, [
    obs({ finalizedBlockHeight: "499", blockhashValid: false }),
  ]);
  expect(d.state).toBe("SIGNING");
  expect(d.safeToRetry).toBe(false);
});
it("never forgets observed success after multiple uncertain reconciliation passes", () => {
  const a = attempt();
  a.successObserved = true;
  a.state = "STATUS_UNKNOWN";
  const d = reconcileDecision(a, [obs(), obs({ endpoint: "fallback" })]);
  expect(d.state).toBe("STATUS_UNKNOWN");
  expect(d.safeToRetry).toBe(false);
});
