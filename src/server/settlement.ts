import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  b64,
  canonical,
  equalBytes,
  sha256,
  unb64,
  verifyEd25519,
} from "../shared/crypto";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";
import {
  hashTerms,
  mergeSignature,
  transactionId,
  unsignedWire,
  verifyWireSignatures,
  verifyTransaction,
  wireParts,
  validateTerms,
} from "../shared/transactions";
import {
  mayPrepareReplacement,
  reconcileDecision,
  type ChainObservation,
} from "../shared/recovery";
import {
  receiptFromMetadata,
  type TransactionEvidence,
} from "../shared/receipt";
import type { Attempt, Env } from "../shared/types";
import {
  requireAuth,
  requireMutationOrigin,
  jsonObject,
  checkRateLimit,
  type AppContext,
} from "./auth";
import {
  acquireAttemptLocks,
  getMemberAttempt,
  requireRoomMember,
  saveAttempt,
  releaseAttemptLocks,
} from "./db";
import {
  assertDevnet,
  getAssets,
  integer,
  preparePlan,
  rpcFor,
  Rpc,
} from "./chain";
interface DiscoveredTransaction {
  txid: string;
  wireBase64: string;
  signatures: Record<string, string>;
  transaction: TransactionEvidence;
}
type RecoveryCall = <T = any>(method: string, params?: unknown[]) => Promise<T>;
/** No new signatures or broadcasts: inspect at most one page and two candidate
 * transactions per provider. Any incomplete index or metadata keeps locks held.
 * https://solana.com/docs/rpc/http/getsignaturesforaddress
 */
async function scanFeePayerHistory(
  call: RecoveryCall,
  attempt: Attempt,
  original: ReturnType<typeof wireParts>,
  onSuccess: () => void,
): Promise<DiscoveredTransaction[]> {
  const floor = BigInt(attempt.plan.contextSlot);
  // Bind the history's minimum slot to an expired finalized bank in ONE RPC.
  // A separate getSlot could lag an earlier getBlockHeight response.
  const bank = await call("getEpochInfo", [{ commitment: "finalized" }]);
  const root = integer(bank.absoluteSlot),
    height = integer(bank.blockHeight);
  if (
    !Number.isSafeInteger(Number(floor)) ||
    !Number.isSafeInteger(Number(root)) ||
    !Number.isSafeInteger(Number(height))
  )
    throw new Error("Address history slot cannot be represented safely");
  if (BigInt(height) <= BigInt(attempt.plan.lastValidBlockHeight))
    throw new Error("Address history bank has not finalized original expiry");
  if (BigInt(root) < floor)
    throw new Error("Finalized history root is behind attempt");
  // RPC context can be later than the blockhash's originating bank. It is only
  // a safe history cutoff after proving this exact block produced the hash.
  const anchor = await call("getBlock", [
    Number(floor),
    {
      commitment: "finalized",
      transactionDetails: "none",
      rewards: false,
      maxSupportedTransactionVersion: 0,
    },
  ]);
  if (!anchor || anchor.blockhash !== attempt.plan.blockhash)
    throw new Error("Original blockhash origin could not be anchored");
  const options = {
    commitment: "finalized",
    minContextSlot: Number(root),
    limit: 50,
  };
  const page = await call("getSignaturesForAddress", [
    attempt.plan.terms.feePayer,
    options,
  ]);
  if (!Array.isArray(page) || page.length > 50)
    throw new Error("Invalid address history page");
  const seen = new Set<string>();
  let previous = BigInt(root);
  const candidates: Array<{ signature: string; slot: string; err: unknown }> =
    [];
  let crossedFloor = false;
  for (const row of page) {
    if (
      !row ||
      typeof row.signature !== "string" ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature) ||
      bs58.decode(row.signature).length !== 64 ||
      seen.has(row.signature) ||
      row.confirmationStatus !== "finalized" ||
      row.err === undefined
    )
      throw new Error("Invalid or duplicate finalized address history entry");
    const slot = integer(row.slot);
    if (BigInt(slot) > previous)
      throw new Error("Address history ordering or root changed");
    previous = BigInt(slot);
    seen.add(row.signature);
    if (BigInt(slot) < floor) crossedFloor = true;
    else candidates.push({ signature: row.signature, slot, err: row.err });
  }
  if (candidates.length > 2)
    throw new Error("Address history candidate budget exceeded");
  if (!crossedFloor && page.length > 0) {
    if (page.length === 50)
      throw new Error("Address history page is incomplete");
    const tail = await call("getSignaturesForAddress", [
      attempt.plan.terms.feePayer,
      {
        ...options,
        limit: 1,
        before: page.at(-1).signature,
      },
    ]);
    if (!Array.isArray(tail) || tail.length !== 0)
      throw new Error("Address history exhaustion was not established");
  }
  const matches: DiscoveredTransaction[] = [];
  for (const candidate of candidates) {
    const transaction = await call<TransactionEvidence | null>(
      "getTransaction",
      [
        candidate.signature,
        {
          encoding: "base64",
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        },
      ],
    );
    if (
      !transaction?.meta ||
      transaction.transaction?.[1] !== "base64" ||
      integer(transaction.slot) !== candidate.slot
    )
      throw new Error(
        "Finalized address history transaction metadata missing or inconsistent",
      );
    const wire = unb64(transaction.transaction[0]);
    // Every packet-sized transaction has a one-byte signature count. Unlike
    // wireParts, this also permits unrelated one-signer or versioned messages.
    const count = wire[0],
      offset = 1 + count * 64;
    if (
      wire.length > 1232 ||
      count < 1 ||
      count > 19 ||
      wire.length <= offset ||
      bs58.encode(wire.subarray(1, 65)) !== candidate.signature
    )
      throw new Error("Address history transaction identity mismatch");
    const decoded = VersionedTransaction.deserialize(wire);
    if (
      decoded.message.header.numRequiredSignatures !== count ||
      !equalBytes(decoded.message.serialize(), wire.subarray(offset))
    )
      throw new Error("Address history transaction message is malformed");
    const sameMessage = equalBytes(wire.subarray(offset), original.message);
    // A later mismatch/error cannot erase credible exact-message success.
    if (sameMessage && transaction.meta.err === null) onSuccess();
    if (canonical(candidate.err) !== canonical(transaction.meta.err))
      throw new Error("Address history transaction outcome conflicts");
    if (!sameMessage) {
      // Bind an unrelated message cryptographically to the candidate's identity
      // before excluding it; signature bytes alone could accompany bad metadata.
      if (
        !(await verifyEd25519(
          decoded.message.staticAccountKeys[0].toBase58(),
          decoded.signatures[0],
          wire.subarray(offset),
        ))
      )
        throw new Error(
          "Unrelated address history transaction identity is invalid",
        );
      continue;
    }
    const parts = await verifyWireSignatures(wire, attempt.plan, true);
    for (let i = 0; i < original.signatures.length; i++)
      if (
        original.signatures[i].some(Boolean) &&
        !equalBytes(original.signatures[i], parts.signatures[i])
      )
        throw new Error(
          "Discovered transaction changed a stored partial signature",
        );
    if (
      attempt.fullWireBase64 &&
      !equalBytes(wire, unb64(attempt.fullWireBase64))
    )
      throw new Error(
        "Discovered transaction changed stored fully signed bytes",
      );
    matches.push({
      txid: transactionId(wire),
      wireBase64: transaction.transaction[0],
      transaction,
      signatures: Object.fromEntries(
        parts.signers.map((signer, i) => [signer, b64(parts.signatures[i])]),
      ),
    });
  }
  return matches;
}
export async function observe(
  env: Env,
  attempt: Attempt,
): Promise<{
  observations: ChainObservation[];
  evidence: TransactionEvidence | null;
  finalizedFailureEvidence: TransactionEvidence | null;
  finalizedSuccessEvidence: TransactionEvidence | null;
  observedSuccess: boolean;
  discovered: DiscoveredTransaction | null;
  discoveryConflict: boolean;
}> {
  let evidence: TransactionEvidence | null = null;
  let finalizedFailureEvidence: TransactionEvidence | null = null;
  let finalizedSuccessEvidence: TransactionEvidence | null = null;
  let observedSuccess = false;
  let discovered: DiscoveredTransaction | null = null;
  let discoveryConflict = false;
  let original: ReturnType<typeof wireParts> | null = null;
  const endpoints = [
    {
      url: env.SOLANA_RPC_URL,
      trust: env.RPC_HISTORY_TRUSTED === "true",
      addressTrust: env.RPC_ADDRESS_HISTORY_TRUSTED === "true",
    },
    {
      url: env.SOLANA_RPC_FALLBACK_URL,
      trust: env.FALLBACK_HISTORY_TRUSTED === "true",
      addressTrust: env.FALLBACK_ADDRESS_HISTORY_TRUSTED === "true",
    },
  ].filter((e) => e.url);
  const observations: ChainObservation[] = [];
  for (const entry of endpoints) {
    // Same provider host is not an independent absence check, even with another key.
    const endpoint = new URL(entry.url!).host;
    const rpc = new Rpc(entry.url!, env.DB);
    let stage = "getHealth";
    const call = <T = any>(method: string, params: unknown[] = []) => {
      stage = method;
      return rpc.call<T>(method, params);
    };
    try {
      const health = await call("getHealth");
      if (health !== "ok") throw new Error("RPC unhealthy");
      if (
        (await call("getGenesisHash")) !==
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
      )
        throw new Error("Recovery endpoint is not devnet");
      const firstAvailable = integer(await call("getFirstAvailableBlock"));
      const coversLifetime =
        BigInt(firstAvailable) <= BigInt(attempt.plan.contextSlot);
      // Bind expiry height and the minimum evidence slot to one finalized bank.
      // Separately sampled height/slot responses can disagree behind a load balancer.
      const bank = await call("getEpochInfo", [{ commitment: "finalized" }]);
      const height = integer(bank.blockHeight),
        root = integer(bank.absoluteSlot);
      if (
        !Number.isSafeInteger(Number(height)) ||
        !Number.isSafeInteger(Number(root))
      )
        throw new Error("Recovery bank cannot be represented safely");
      const valid = await call("isBlockhashValid", [
        attempt.plan.blockhash,
        { commitment: "finalized", minContextSlot: Number(root) },
      ]);
      const requireFreshBlockhashEvidence = () => {
        if (
          typeof valid?.value !== "boolean" ||
          BigInt(integer(valid.context?.slot)) < BigInt(root)
        )
          throw new Error(
            "Blockhash validity context is behind the recovery bank",
          );
      };
      let status: any = null,
        transaction: TransactionEvidence | null = null,
        transactionFinalized = false,
        addressHistoryComplete = false;
      if (attempt.txid) {
        const s = await call("getSignatureStatuses", [
          [attempt.txid],
          { searchTransactionHistory: true },
        ]);
        if (
          !Array.isArray(s.value) ||
          s.value.length !== 1 ||
          s.value[0] === undefined
        )
          throw new Error("Invalid signature status response");
        status = s.value[0];
        // Preserve a credible success status even if the following metadata RPC
        // times out; that later transport error cannot erase prior success.
        if (
          status?.err === null &&
          ["confirmed", "finalized"].includes(status.confirmationStatus)
        )
          observedSuccess = true;
        transaction = await call<TransactionEvidence | null>("getTransaction", [
          attempt.txid,
          {
            encoding: "base64",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        transactionFinalized = !!transaction;
        if (!transaction)
          transaction = await call<TransactionEvidence | null>(
            "getTransaction",
            [
              attempt.txid,
              {
                encoding: "base64",
                commitment: "confirmed",
                maxSupportedTransactionVersion: 0,
              },
            ],
          );
        // Positive metadata remains usable even if a separate status cache lags.
        // Only absence needs both contexts fenced at the expired finalized bank.
        if (status === null && !transaction?.meta) {
          requireFreshBlockhashEvidence();
          if (BigInt(integer(s.context?.slot)) < BigInt(root))
            throw new Error(
              "Signature absence context is behind the recovery bank",
            );
        }
      } else if (
        entry.trust &&
        entry.addressTrust &&
        coversLifetime &&
        BigInt(height) > BigInt(attempt.plan.lastValidBlockHeight) &&
        valid.value === false
      ) {
        requireFreshBlockhashEvidence();
        original ??= verifyTransaction(unb64(attempt.wireBase64), attempt.plan);
        if (!equalBytes(original.message, unb64(attempt.messageBase64)))
          throw new Error("Stored unsigned message identity differs");
        const matches = await scanFeePayerHistory(
          call,
          attempt,
          original,
          () => {
            observedSuccess = true;
          },
        );
        addressHistoryComplete = true;
        for (const match of matches) {
          if (
            discovered &&
            (discovered.txid !== match.txid ||
              discovered.wireBase64 !== match.wireBase64 ||
              canonical(discovered.transaction.meta?.err) !==
                canonical(match.transaction.meta?.err))
          )
            discoveryConflict = true;
          discovered ??= match;
        }
        if (matches.length) {
          const match =
            matches.find((m) => m.transaction.meta?.err === null) ?? matches[0];
          transaction = match.transaction;
          transactionFinalized = true;
          status = {
            confirmationStatus: "finalized",
            err: transaction.meta!.err,
          };
        }
      }
      if (transaction?.meta && !evidence) evidence = transaction;
      if (transaction?.meta?.err === null) observedSuccess = true;
      if (
        transactionFinalized &&
        transaction?.meta?.err === null &&
        !finalizedSuccessEvidence
      )
        finalizedSuccessEvidence = transaction;
      if (
        transactionFinalized &&
        transaction?.meta &&
        transaction.meta.err !== null &&
        !finalizedFailureEvidence
      )
        finalizedFailureEvidence = transaction;
      if (status?.confirmationStatus === "finalized" && !transaction?.meta)
        throw new Error("Finalized status needs transaction history metadata");
      observations.push({
        endpoint,
        healthy: true,
        historyTrusted: entry.trust && coversLifetime,
        finalizedBlockHeight: height,
        blockhashValid: valid.value,
        status: status
          ? {
              confirmation: status.confirmationStatus ?? "processed",
              err: status.err,
            }
          : null,
        transactionFound: !!transaction?.meta,
        transactionErr: transaction?.meta?.err ?? null,
        transactionFinalized,
        ...(addressHistoryComplete ? { addressHistoryComplete: true } : {}),
      });
    } catch (error) {
      // Keep only our own error categories/status, never provider bodies, URLs,
      // credentials or D1 exception text. Unavailability still holds all locks.
      const message = error instanceof Error ? error.message : "";
      const http = /^RPC \w+ unavailable \((\d{3})\)$/.exec(message);
      const failureKind: ChainObservation["failureKind"] = http
        ? "provider_http"
        : /^RPC \w+ rejected \(-?\d+\);/.test(message)
          ? "provider_rejected"
          : /^RPC \w+ transport unavailable;/.test(message)
            ? "transport"
            : message ===
                "RPC request budget is busy; retry original status shortly"
              ? "request_budget"
              : "validation_or_internal";
      observations.push({
        endpoint,
        healthy: false,
        historyTrusted: false,
        finalizedBlockHeight: "0",
        blockhashValid: null,
        status: null,
        transactionFound: false,
        transactionErr: null,
        transactionFinalized: false,
        failureStage: stage,
        failureKind,
        ...(http ? { failureStatus: Number(http[1]) } : {}),
      });
    }
  }
  return {
    observations,
    evidence,
    finalizedFailureEvidence,
    finalizedSuccessEvidence,
    observedSuccess,
    discovered,
    discoveryConflict,
  };
}
export async function reconcileAttempt(
  env: Env,
  old: Attempt,
): Promise<Attempt> {
  if (old.state === "FINALIZED" && old.receipt?.verified) return old;
  const {
    observations,
    evidence,
    finalizedFailureEvidence,
    finalizedSuccessEvidence,
    observedSuccess,
    discovered,
    discoveryConflict,
  } = await observe(env, old);
  const messageHistoryComplete =
    observations.length >= 2 &&
    observations.every((o) => o.healthy && o.addressHistoryComplete) &&
    new Set(observations.map((o) => o.endpoint)).size >= 2;
  // Incomplete discovery must not promote an identity and bypass the mandatory
  // message-history scan on the next reconciliation (especially for failures).
  const identified: Attempt =
    discovered && !discoveryConflict && messageHistoryComplete
      ? {
          ...old,
          txid: discovered.txid,
          wireBase64: discovered.wireBase64,
          fullWireBase64: discovered.wireBase64,
          signatures: discovered.signatures,
        }
      : old;
  const decision = reconcileDecision(identified, observations);
  if (
    discoveryConflict ||
    (!old.txid && discovered && !messageHistoryComplete)
  ) {
    decision.state = "STATUS_UNKNOWN";
    decision.safeToRetry = false;
    decision.reason =
      "Original message history is conflicting or incomplete; retain the original attempt";
  }
  if (observedSuccess && !["CONFIRMED", "FINALIZED"].includes(decision.state)) {
    decision.state = "STATUS_UNKNOWN";
    decision.safeToRetry = false;
    decision.reason =
      "Success was observed but its metadata or finality is unresolved; no replacement is authorized";
  }
  const next: Attempt = {
    ...identified,
    state: decision.state,
    safeToRetry: decision.safeToRetry,
    successObserved:
      old.successObserved ||
      observedSuccess ||
      ["CONFIRMED", "FINALIZED"].includes(old.state) ||
      ["CONFIRMED", "FINALIZED"].includes(decision.state) ||
      observations.some(
        (observation) =>
          observation.healthy &&
          ((observation.status?.err === null &&
            ["confirmed", "finalized"].includes(
              observation.status.confirmation,
            )) ||
            (observation.transactionFound &&
              observation.transactionErr === null)),
      ),
    lastCheckedAt: Date.now(),
    lastRecoveryObservations: observations,
    error: decision.reason,
  };
  if (["CONFIRMED", "FINALIZED"].includes(next.state)) {
    // A finalized status from one provider must not upgrade another provider's
    // merely confirmed metadata. Archive the evidence at the claimed commitment.
    const successEvidence =
      next.state === "FINALIZED" ? finalizedSuccessEvidence : evidence;
    // External broadcast may precede the coordinator's submit endpoint. The fully
    // signed wire was persisted at collection, or we recover exact bytes from chain.
    if (!next.fullWireBase64) {
      try {
        if (!successEvidence || successEvidence.transaction[1] !== "base64")
          throw new Error(
            "Original signed transaction metadata is unavailable",
          );
        const recovered = unb64(successEvidence.transaction[0]);
        const parts = await verifyWireSignatures(recovered, next.plan, true);
        if (
          transactionId(recovered) !== next.txid ||
          !equalBytes(parts.message, unb64(next.messageBase64))
        )
          throw new Error("Recovered transaction identity mismatch");
        next.fullWireBase64 = successEvidence.transaction[0];
        next.wireBase64 = successEvidence.transaction[0];
      } catch {
        next.state = "STATUS_UNKNOWN";
        next.safeToRetry = false;
        next.error =
          "Success was observed, but the original fully signed transaction could not be verified. Retain its identity and allocations until metadata recovery succeeds.";
      }
    }
    if (["CONFIRMED", "FINALIZED"].includes(next.state)) {
      next.submissionStartedAt ??= Date.now();
      if (successEvidence) {
        try {
          next.receipt = receiptFromMetadata(
            next,
            successEvidence,
            next.state === "FINALIZED",
          );
          next.publicEvidence = {
            observedAt: Date.now(),
            buildId:
              env.BUILD_ID && /^[a-f0-9]{7,64}$/.test(env.BUILD_ID)
                ? env.BUILD_ID
                : null,
            transaction: successEvidence,
          };
          next.error = null;
        } catch (e) {
          next.state = "STATUS_UNKNOWN";
          next.safeToRetry = false;
          next.error = `Success was observed, but its transaction-specific receipt does not reconcile; allocations remain held: ${(e as Error).message}`;
        }
      } else {
        next.state = "STATUS_UNKNOWN";
        next.safeToRetry = false;
        next.error =
          "Success was observed; matching transaction metadata is pending. Allocations remain held.";
      }
    }
  }
  if (next.state === "FAILED_ONCHAIN") {
    try {
      // A finalized status label alone is not sufficient to release allocations.
      // Require the actual finalized failed transaction to match every frozen byte.
      const failureEvidence = next.safeToRetry
        ? finalizedFailureEvidence
        : evidence;
      if (
        !failureEvidence?.meta ||
        failureEvidence.meta.err === null ||
        failureEvidence.transaction[1] !== "base64"
      )
        throw new Error("Matching failed transaction metadata is unavailable");
      const wire = unb64(failureEvidence.transaction[0]);
      const parts = await verifyWireSignatures(wire, next.plan, true);
      if (
        transactionId(wire) !== next.txid ||
        !equalBytes(parts.message, unb64(next.messageBase64)) ||
        (next.fullWireBase64 && !equalBytes(wire, unb64(next.fullWireBase64)))
      )
        throw new Error("Failed transaction identity mismatch");
      next.error = `${next.safeToRetry ? "Finalized" : "Observed"} onchain failure. No barter legs settled. Transaction metadata reports ${integer(failureEvidence.meta.fee)} lamports in network fees.`;
    } catch {
      next.state = "STATUS_UNKNOWN";
      next.safeToRetry = false;
      next.error =
        "Failed transaction evidence could not be verified against the original signed message. Keep its identity and allocations until reconciliation succeeds.";
    }
  }
  await saveAttempt(env.DB, next, old.state, old);
  if (next.state === "FINALIZED") {
    const room = await env.DB.prepare(
      "SELECT listing_ids_json FROM rooms WHERE id=?",
    )
      .bind(next.roomId)
      .first<{ listing_ids_json: string }>();
    const statements = (
      JSON.parse(room?.listing_ids_json ?? "[]") as string[]
    ).map((id) =>
      env.DB.prepare("UPDATE listings SET status='FILLED' WHERE id=?").bind(id),
    );
    statements.push(
      env.DB.prepare("DELETE FROM active_locks WHERE attempt_id=?").bind(
        next.id,
      ),
    );
    await env.DB.batch(statements);
  } else if (next.safeToRetry) await releaseAttemptLocks(env.DB, next.id);
  return next;
}
export function createSettlementRouter(): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use("*", requireMutationOrigin);
  async function owned(c: Context<AppContext>, id: string): Promise<Attempt> {
    const attempt = await getMemberAttempt(c.env.DB, id, c.get("wallet"));
    if (!attempt)
      throw new HTTPException(404, { message: "Attempt not found" });
    return attempt;
  }
  app.post("/rooms/:id/attempts", requireAuth, async (c) => {
    const body = await jsonObject(c),
      room = await requireRoomMember(
        c.env.DB,
        c.req.param("id"),
        c.get("wallet"),
      );
    if (
      body.version !== room.terms.version ||
      body.termsHash !== room.termsHash
    )
      throw new HTTPException(409, {
        message: "Terms changed; review and approve this version",
      });
    if (room.attempt) {
      if (!mayPrepareReplacement(room.attempt))
        return c.json({ attempt: room.attempt });
      throw new HTTPException(409, {
        message:
          "Reconciled old attempt. Create a new terms revision and collect fresh consent before preparing again",
      });
    }
    if (
      !room.members.every(
        (m) => m.acceptedVersion === room.terms.version && m.ready,
      )
    )
      throw new HTTPException(409, {
        message: "Every participant must accept this version and be ready",
      });
    await checkRateLimit(c.env.DB, `prepare:${c.get("wallet")}`, 6, 60000);
    const plan = await preparePlan(c.env, room.terms);
    const wireBase64 = unsignedWire(plan),
      parts = wireParts(unb64(wireBase64));
    const attempt: Attempt = {
      id: crypto.randomUUID(),
      roomId: room.id,
      termsHash: await hashTerms(room.terms),
      plan,
      messageBase64: b64(parts.message),
      messageHash: await sha256(parts.message),
      wireBase64,
      fullWireBase64: null,
      txid: null,
      state: "SIGNING",
      signatures: {},
      createdAt: Date.now(),
      submissionStartedAt: null,
      lastCheckedAt: null,
      stopRequested: false,
      safeToRetry: false,
      receipt: null,
      error: null,
    };
    await acquireAttemptLocks(c.env.DB, room, attempt);
    return c.json({ attempt }, 201);
  });
  app.get("/attempts/:id", requireAuth, async (c) =>
    c.json({ attempt: await owned(c, c.req.param("id")) }),
  );
  app.post("/attempts/:id/signatures", requireAuth, async (c) => {
    const body = await jsonObject(c),
      old = await owned(c, c.req.param("id")),
      wallet = c.get("wallet");
    if (typeof body.wireBase64 !== "string")
      throw new HTTPException(400, {
        message: "A signed transaction is required",
      });
    if (old.state !== "SIGNING" || old.stopRequested) {
      if (
        old.signatures[wallet] &&
        [
          "FULLY_SIGNED",
          "SUBMISSION_STARTED",
          "SUBMITTED",
          "CONFIRMED",
          "FINALIZED",
        ].includes(old.state)
      )
        return c.json({ attempt: old });
      throw new HTTPException(409, {
        message:
          "Attempt is not collecting signatures; reconcile original status",
      });
    }
    await assertDevnet(c.env);
    const rpc = rpcFor(c.env);
    if (
      BigInt(
        integer(
          await rpc.call("getBlockHeight", [{ commitment: "confirmed" }]),
        ),
      ) > BigInt(old.plan.lastValidBlockHeight)
    )
      throw new HTTPException(409, {
        message:
          "Signing lifetime passed. Reconcile original status before another attempt",
      });
    validateTerms(old.plan.terms, await getAssets(c.env));
    const merged = await mergeSignature(
      unb64(old.wireBase64),
      unb64(body.wireBase64),
      wallet,
      old.plan,
    );
    const parts = wireParts(merged);
    const signatures: Record<string, string> = {};
    parts.signers.forEach((s, i) => {
      if (parts.signatures[i].some(Boolean))
        signatures[s] = b64(parts.signatures[i]);
    });
    const full = parts.signatures.every((s) => s.some(Boolean));
    const next: Attempt = {
      ...old,
      signatures,
      wireBase64: b64(merged),
      state: full ? "FULLY_SIGNED" : "SIGNING",
      txid: parts.signatures[0].some(Boolean) ? transactionId(merged) : null,
      fullWireBase64: full ? b64(merged) : null,
    };
    await saveAttempt(c.env.DB, next, old.state, old);
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO signatures(attempt_id,signer,signature_base64,verified_at) VALUES(?,?,?,?)",
    )
      .bind(next.id, wallet, signatures[wallet], Date.now())
      .run();
    return c.json({ attempt: next });
  });
  app.post("/attempts/:id/submit", requireAuth, async (c) => {
    const old = await owned(c, c.req.param("id"));
    if (["FINALIZED", "CONFIRMED"].includes(old.state))
      return c.json({ attempt: await reconcileAttempt(c.env, old) });
    if (old.submissionStartedAt !== null)
      return c.json({ attempt: await reconcileAttempt(c.env, old) });
    if (
      old.state !== "FULLY_SIGNED" ||
      !old.fullWireBase64 ||
      !old.txid ||
      old.stopRequested
    )
      throw new HTTPException(409, {
        message:
          "All participants must sign; a stopped attempt must be reconciled",
      });
    await assertDevnet(c.env);
    await verifyWireSignatures(unb64(old.fullWireBase64), old.plan, true);
    const rpc = rpcFor(c.env);
    // The complete bytes and ID already exist. Commit SUBMISSION_STARTED before ANY
    // send. Even a preflight rejection after this marker cannot authorize a rebuild.
    const started: Attempt = {
      ...old,
      state: "SUBMISSION_STARTED",
      submissionStartedAt: Date.now(),
      error: null,
    };
    await saveAttempt(c.env.DB, started, old.state, old);
    let next: Attempt;
    try {
      validateTerms(old.plan.terms, await getAssets(c.env));
      const sim = await rpc.call("simulateTransaction", [
        old.fullWireBase64,
        {
          encoding: "base64",
          sigVerify: true,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
          minContextSlot: Number(old.plan.contextSlot),
        },
      ]);
      if (sim.value.err)
        throw new Error(
          "Signed simulation rejected; retain original identity and reconcile; no replacement authorized",
        );
      const returned = await rpc.call<string>("sendTransaction", [
        old.fullWireBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
          minContextSlot: Number(old.plan.contextSlot),
        },
      ]);
      if (returned !== old.txid)
        throw new Error("RPC returned an unexpected transaction identifier");
      next = { ...started, state: "SUBMITTED" };
    } catch (e) {
      next = {
        ...started,
        state: "STATUS_UNKNOWN",
        error: (e as Error).message,
      };
    }
    await saveAttempt(c.env.DB, next, started.state, started);
    return c.json({ attempt: next });
  });
  app.post("/attempts/:id/reconcile", requireAuth, async (c) => {
    const old = await owned(c, c.req.param("id"));
    if (old.lastCheckedAt && Date.now() - old.lastCheckedAt < 2500)
      return c.json({ attempt: old });
    await checkRateLimit(c.env.DB, `reconcile:${old.id}`, 20, 60000);
    return c.json({ attempt: await reconcileAttempt(c.env, old) });
  });
  app.post("/attempts/:id/rebroadcast", requireAuth, async (c) => {
    const old = await owned(c, c.req.param("id"));
    const reconciled = await reconcileAttempt(c.env, old);
    if (
      ["FINALIZED", "CONFIRMED", "FAILED_ONCHAIN", "EXPIRED_UNLANDED"].includes(
        reconciled.state,
      ) ||
      !reconciled.fullWireBase64 ||
      reconciled.submissionStartedAt === null ||
      reconciled.stopRequested
    )
      return c.json({ attempt: reconciled });
    const rpc = rpcFor(c.env);
    if (
      BigInt(
        integer(
          await rpc.call("getBlockHeight", [{ commitment: "confirmed" }]),
        ),
      ) > BigInt(reconciled.plan.lastValidBlockHeight)
    )
      return c.json({ attempt: reconciled });
    await checkRateLimit(c.env.DB, `rebroadcast:${old.id}`, 2, 60000);
    await verifyWireSignatures(
      unb64(reconciled.fullWireBase64),
      reconciled.plan,
      true,
    );
    try {
      await rpc.call("sendTransaction", [
        reconciled.fullWireBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 0,
        },
      ]);
    } catch {
      /* Original bytes and outcome remain durable. */
    }
    return c.json({ attempt: reconciled });
  });
  app.post("/attempts/:id/stop", requireAuth, async (c) => {
    const old = await owned(c, c.req.param("id"));
    if (old.stopRequested) return c.json({ attempt: old });
    const next = {
      ...old,
      stopRequested: true,
      error:
        "Stopped collecting signatures. This does not revoke any issued signature. Locks remain until original outcome is reconciled.",
    };
    await saveAttempt(c.env.DB, next, old.state, old);
    return c.json({ attempt: next });
  });
  return app;
}
