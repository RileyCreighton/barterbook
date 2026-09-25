import { useEffect, useRef, useState } from "react";
import type { Room } from "../shared/types";
import type { NonceOperation } from "../shared/nonce";
import { api } from "./api";
import {
  connectionIsCurrent,
  signNonceOperation,
  type WalletConnection,
} from "./wallet";

export function NonceControls({
  room,
  connection,
  onChanged,
}: {
  room: Room;
  connection: WalletConnection | null;
  onChanged: () => Promise<unknown>;
}) {
  const [ready, setReady] = useState(false),
    [operation, setOperation] = useState<NonceOperation | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const generation = useRef(0);
  const payer = connection?.account.address === room.terms.feePayer;
  const attempt = room.attempt;
  const unresolved =
    !!attempt && !attempt.safeToRetry && attempt.state !== "FINALIZED";
  useEffect(() => {
    const current = ++generation.current;
    setOperation(null);
    setReady(false);
    setError("");
    setBusy(false);
    if (payer)
      void api<{ ready: boolean; operation: NonceOperation | null }>(
        `/nonce/status${attempt ? `?attemptId=${attempt.id}` : ""}`,
      )
        .then((result) => {
          if (generation.current === current) {
            setReady(result.ready);
            setOperation(result.operation);
          }
        })
        .catch((cause) => {
          if (generation.current === current) setError(cause.message);
        });
    return () => {
      generation.current++;
    };
  }, [room.id, room.termsHash, attempt?.id, connection, payer]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    const current = generation.current;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (generation.current === current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Signing account request failed.",
        );
    } finally {
      if (generation.current === current) setBusy(false);
    }
  }
  async function update(op: NonceOperation) {
    setOperation(op);
    if (op.state === "FINALIZED" && op.plan.kind === "setup") setReady(true);
    await onChanged();
  }
  async function approve(kind: "setup" | "cancel") {
    if (!connection || !connectionIsCurrent(connection) || !payer)
      throw new Error("Reconnect the fee payer first.");
    const current = generation.current;
    const result = await api<{ ready?: boolean; operation?: NonceOperation }>(
      kind === "setup"
        ? "/nonce/setup"
        : `/attempts/${attempt!.id}/cancel-onchain`,
      {},
    );
    if (generation.current !== current) return;
    if (result.ready) {
      setReady(true);
      return;
    }
    if (!result.operation) throw new Error("Signing operation unavailable.");
    const op = result.operation;
    setOperation(op);
    if (op.state !== "PREPARED") {
      await update(op);
      return;
    }
    const wireBase64 = await signNonceOperation(connection, op);
    if (generation.current !== current || !connectionIsCurrent(connection))
      throw new Error(
        "Wallet changed. Check the original signing operation before another approval.",
      );
    const saved = await api<{ operation: NonceOperation }>(
      `/nonce/operations/${op.id}/submit`,
      { wireBase64 },
    );
    if (generation.current === current) await update(saved.operation);
  }
  async function check(rebroadcast = false) {
    if (!operation) return;
    const current = generation.current;
    const result = await api<{ operation: NonceOperation }>(
      `/nonce/operations/${operation.id}/${rebroadcast ? "rebroadcast" : "reconcile"}`,
      {},
    );
    if (generation.current === current) await update(result.operation);
  }
  const pending =
    operation && ["PREPARED", "SUBMISSION_STARTED"].includes(operation.state);
  return (
    <section className="card" aria-labelledby="long-signing-title">
      <h2 id="long-signing-title">Longer-lived signing</h2>
      <p>
        Review each wallet approval at your own pace. The exchange remains
        usable until it executes or the fee payer cancels its authorization on
        chain.
      </p>
      {!payer ? (
        <p>
          The fee payer sets up and controls the signing account. Each
          participant still signs the exact exchange in their own wallet.
        </p>
      ) : (
        <>
          {!ready && (
            <>
              <p>
                One-time setup holds at most <strong>0.002 Devnet SOL</strong>{" "}
                in your signing account, plus at most 0.000025 SOL in network
                fees. Your wallet controls this account.
              </p>
              <button
                disabled={busy || !!pending}
                onClick={() => void run(() => approve("setup"))}
              >
                Set up signing in wallet
              </button>
            </>
          )}
          {ready && (
            <p className="status-note">
              Signing account ready. Everyone can review and sign the exchange
              without a blockhash countdown.
            </p>
          )}
          {ready && unresolved && (
            <>
              <p>
                Cancellation asks your wallet to invalidate this exchange's
                authorization. It costs a network fee. If the exchange lands
                first, its actual outcome takes priority. Check the original
                status afterward.
              </p>
              <button
                className="secondary"
                disabled={busy || !!pending}
                onClick={() => void run(() => approve("cancel"))}
              >
                Cancel on chain in wallet
              </button>
            </>
          )}
          {operation && (
            <>
              <p role="status">
                {operation.state === "PREPARED"
                  ? "Wallet approval is pending or was interrupted. Check its status before another approval."
                  : operation.state === "SUBMISSION_STARTED"
                    ? "Submission recorded. Check its original status."
                    : operation.state === "FINALIZED"
                      ? operation.plan.kind === "setup"
                        ? "Signing setup complete."
                        : "Cancellation finalized. Reconcile the original exchange."
                      : (operation.error ??
                        "Operation ended. You can review another request.")}
              </p>
              {pending && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(() => check())}
                >
                  Check signing account status
                </button>
              )}
              {operation.state === "PREPARED" && (
                <button
                  disabled={busy}
                  onClick={() => void run(() => approve(operation.plan.kind))}
                >
                  Review pending request in wallet
                </button>
              )}
              {operation.state === "SUBMISSION_STARTED" && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(() => check(true))}
                >
                  Resend original submission
                </button>
              )}
            </>
          )}
        </>
      )}
      {busy && (
        <p role="status">
          Working on the signing account… Review any open Solflare transaction
          prompt.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
