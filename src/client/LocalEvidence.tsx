import execution from "../../evidence/local/litesvm-execution.json";
import executionUrl from "../../evidence/local/litesvm-execution.json?url";
import { short } from "./TradeViews";

export function LocalEvidence() {
  return (
    <section className="local-evidence" aria-labelledby="local-evidence-title">
      <p className="eyebrow">Executed evidence · local runtime only</p>
      <h3 id="local-evidence-title">
        The token programs executed these checks.
      </h3>
      <p>
        Recorded {new Date(execution.executedAt).toLocaleString()} in LiteSVM
        0.8.0. These are real in-process Token-2022 and associated-account
        program executions with signature verification. They were never
        broadcast to devnet or mainnet and do not prove browser-extension
        compatibility.
      </p>
      <div className="local-result-grid">
        {execution.results.map((result, index) => (
          <article key={index}>
            <span className="pill">
              {result.failed
                ? "Atomic rollback verified"
                : "Local execution passed"}
            </span>
            <h3>
              {result.failed
                ? "Failing final leg"
                : result.mode === "BASKET"
                  ? "Two-for-one basket"
                  : "Three-owner exchange"}
            </h3>
            <p>
              {result.owners} owners · {result.transfers} transfers ·{" "}
              {result.wireBytes} bytes
            </p>
            <p>
              {result.failed
                ? "All token changes and new accounts rolled back."
                : "Exact source debits, net credits and three new receiving accounts verified."}
            </p>
            <p>
              Execution fee:{" "}
              <strong>
                {result.networkFeeFromIsolatedDeltaLamports} lamports
              </strong>
            </p>
            <details>
              <summary>Inspect the recorded raw effects</summary>
              <p>
                Local identifier:{" "}
                <code title={result.localTransactionSignature}>
                  {short(result.localTransactionSignature)}
                </code>
              </p>
              <p>
                Message unchanged through{" "}
                {result.messageHashesAfterEachSignature.length} signatures:{" "}
                <strong>
                  {result.messageHashesAfterEachSignature.every(
                    (hash) => hash === result.messageHash,
                  )
                    ? "verified"
                    : "not verified"}
                </strong>
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Test mint</th>
                      <th>Source delta</th>
                      <th>Net credited</th>
                      <th>Withheld fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.accountDeltas.map((delta, i) => (
                      <tr key={i}>
                        <td title={delta.mint}>{short(delta.mint)}</td>
                        <td>{delta.sourceDeltaRaw}</td>
                        <td>{delta.destinationRaw ?? "0 (rolled back)"}</td>
                        <td>{delta.withheldFeeRaw ?? "0 (rolled back)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </article>
        ))}
      </div>
      <p className="muted">
        Evidence uses immediate account snapshots around each isolated
        synchronous local execution. Production receipts use transaction RPC
        metadata. There is no public explorer link for these local identifiers.
      </p>
      <a
        href={executionUrl}
        download="barterbook-local-execution-evidence.json"
      >
        Download recorded local execution evidence ↓
      </a>
    </section>
  );
}
