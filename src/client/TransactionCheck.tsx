import { useEffect, useRef, useState } from "react";
import type { Attempt, SigningStatus, Terms } from "../shared/types";
import { api } from "./api";
import { checkFrozenTransaction } from "./transaction-check";
import { walletSigningDiagnostics, type WalletConnection } from "./wallet";

export function TransactionCheck({
  attempt,
  terms,
  connection,
}: {
  attempt: Attempt;
  terms: Terms;
  connection: WalletConnection | null;
}) {
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setReport("");
    setBusy(false);
    setCopied(false);
    return () => {
      generation.current++;
    };
  }, [attempt.id, terms.version, connection]);

  async function check() {
    const current = ++generation.current;
    setBusy(true);
    setCopied(false);
    let result: object;
    try {
      const [transaction, networkStatus] = await Promise.all([
        checkFrozenTransaction(attempt.wireBase64, attempt.plan, terms).catch(
          (cause) => ({
            verified: false,
            verificationError:
              cause instanceof Error ? cause.message : "Check failed",
          }),
        ),
        api<SigningStatus>(`/attempts/${attempt.id}/signing-status`).catch(
          (cause) => ({
            error:
              cause instanceof Error ? cause.message : "Network check failed",
          }),
        ),
      ]);
      result = {
        diagnosticVersion: "2026-09-25.3",
        signingMode: terms.nonceAccount ? "durable-nonce" : "recent-blockhash",
        nonceAccount: terms.nonceAccount ?? null,
        ...transaction,
        networkStatus,
        attemptId: attempt.id,
        termsVersion: terms.version,
        ...walletSigningDiagnostics(connection),
        browser: navigator.userAgent,
        language: navigator.language,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
      };
    } catch (cause) {
      result = {
        diagnosticVersion: "2026-09-25.3",
        attemptId: attempt.id,
        termsVersion: terms.version,
        verified: false,
        verificationError:
          cause instanceof Error ? cause.message : "Check failed",
      };
    }
    if (generation.current === current) {
      setReport(JSON.stringify(result, null, 2));
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="transaction-check-title">
      <h2 id="transaction-check-title">Check the saved transaction</h2>
      <p>
        Check the saved transaction and its Devnet signing window without
        opening your wallet or moving tokens. You can check an expired attempt
        too.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void check()}
      >
        {busy ? "Checking this browser…" : "Check transaction without signing"}
      </button>
      {report && (
        <>
          <p role="status">
            Check complete. Copy this report when reporting a signing error. A
            passed check does not authorize a new attempt.
          </p>
          <label>
            Transaction check report
            <textarea readOnly rows={12} value={report} spellCheck={false} />
          </label>
          <button
            className="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(report)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "Report copied" : "Copy check report"}
          </button>
        </>
      )}
    </section>
  );
}
