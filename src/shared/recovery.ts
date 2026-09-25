import type { Attempt, AttemptState } from "./types";
export interface ChainObservation {
  endpoint: string;
  healthy: boolean;
  historyTrusted: boolean;
  finalizedBlockHeight: string;
  blockhashValid: boolean | null;
  status: null | {
    confirmation: "processed" | "confirmed" | "finalized";
    err: unknown | null;
  };
  transactionFound: boolean;
  transactionErr: unknown | null;
  transactionFinalized: boolean;
  // Diagnostics never participate in an expiry/failure decision.
  failureStage?: string;
  failureKind?:
    | "provider_http"
    | "provider_rejected"
    | "transport"
    | "request_budget"
    | "validation_or_internal";
  failureStatus?: number;
}
export interface RecoveryDecision {
  state: AttemptState;
  safeToRetry: boolean;
  reason: string;
}
export function reconcileDecision(
  attempt: Attempt,
  observations: ChainObservation[],
): RecoveryDecision {
  const hold = (reason: string): RecoveryDecision => ({
    state: "STATUS_UNKNOWN",
    safeToRetry: false,
    reason,
  });
  if (attempt.state === "FINALIZED")
    return {
      state: "FINALIZED",
      safeToRetry: false,
      reason: "Successful finalized attempt cannot execute again",
    };
  const stillLive = observations.some(
    (o) =>
      o.healthy &&
      BigInt(o.finalizedBlockHeight) <=
        BigInt(attempt.plan.lastValidBlockHeight),
  );
  if (!attempt.txid) {
    if (
      stillLive &&
      attempt.submissionStartedAt === null &&
      !attempt.stopRequested
    )
      return {
        state: "SIGNING",
        safeToRetry: false,
        reason: "Original message remains valid for signature collection",
      };
    return hold(
      "No locally derived transaction ID yet; keep locks because an offline signature may exist",
    );
  }
  const good = observations.filter((o) => o.healthy);
  const success = good.filter(
    (o) =>
      (o.status?.err === null &&
        ["confirmed", "finalized"].includes(o.status.confirmation)) ||
      (o.transactionFound && o.transactionErr === null),
  );
  const failures = good.filter(
    (o) =>
      o.status?.err != null || (o.transactionFound && o.transactionErr != null),
  );
  if (success.length && failures.length)
    return hold("Conflicting chain evidence; preserve original attempt");
  if (success.length) {
    const finalized = success.some(
      (o) => o.status?.confirmation === "finalized" || o.transactionFinalized,
    );
    return {
      state: finalized ? "FINALIZED" : "CONFIRMED",
      safeToRetry: false,
      reason: "Original transaction already succeeded; recover its receipt",
    };
  }
  if (
    attempt.successObserved ||
    attempt.state === "CONFIRMED" ||
    attempt.receipt?.verified
  )
    return hold(
      "Previously observed success conflicts with current history; no repeat is authorized",
    );
  if (
    failures.some(
      (o) => o.status?.confirmation === "finalized" || o.transactionFinalized,
    )
  )
    return {
      state: "FAILED_ONCHAIN",
      safeToRetry: true,
      reason:
        "Finalized onchain failure; no intended token leg settled. Network fees may have been charged.",
    };
  if (failures.length)
    return {
      state: "FAILED_ONCHAIN",
      safeToRetry: false,
      reason: "Onchain failure observed; wait for finality before replacement",
    };
  if (
    stillLive &&
    attempt.submissionStartedAt === null &&
    !attempt.stopRequested &&
    good.every((o) => o.status === null && !o.transactionFound)
  )
    return {
      state: attempt.fullWireBase64 ? "FULLY_SIGNED" : "SIGNING",
      safeToRetry: false,
      reason: "Original lifetime remains open; no broadcast observed",
    };
  // Two independently configured history-capable endpoints must both establish expiry and absence.
  if (good.some((o) => o.status !== null || o.transactionFound))
    return hold(
      "A tentative landing exists; reconcile it before expiry release",
    );
  const authoritative = good.filter(
    (o) =>
      o.historyTrusted &&
      BigInt(o.finalizedBlockHeight) >
        BigInt(attempt.plan.lastValidBlockHeight) &&
      o.blockhashValid === false &&
      o.status === null &&
      !o.transactionFound,
  );
  if (new Set(authoritative.map((o) => o.endpoint)).size >= 2)
    return {
      state: "EXPIRED_UNLANDED",
      safeToRetry: true,
      reason:
        "Expired at finalized height; both trusted histories show no original landing",
    };
  return hold(
    "Original outcome unresolved. RPC errors, cache misses and UI cancellation do not permit new signatures.",
  );
}
export function mayPrepareReplacement(attempt: Attempt | null): boolean {
  return (
    !attempt ||
    (attempt.safeToRetry &&
      ["EXPIRED_UNLANDED", "FAILED_ONCHAIN"].includes(attempt.state))
  );
}
