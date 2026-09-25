import evidence from "./browser-proof-summary.json";
export function BrowserEvidence() {
  return (
    <section
      className="browser-evidence"
      aria-label="Verified browser transactions"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            Executed in browser wallets · finalized on Solana Devnet
          </p>
          <h2>From wallet approval to onchain receipt.</h2>
        </div>
        <a href="#/try">Try it yourself →</a>
      </div>
      <p>
        Both exchanges completed through the live app with Phantom wallet
        approvals. Independent checks against two Devnet providers verified
        every signature, the approved message and all token transfers.
      </p>
      <div className="browser-proof-grid">
        {evidence.proofs.map((p) => (
          <article className="card browser-proof" key={p.txid}>
            <span className="pill success-pill">✓ Finalized</span>
            <h3>{p.title}</h3>
            <p className="proof-stat">
              {p.owners} wallets <span>·</span> 1 transaction
            </p>
            <p>{p.summary}</p>
            <p className="muted">
              Network fee {p.feeSOL} Devnet SOL · September 25, 2026
            </p>
            <div className="actions">
              <a className="button-link" href={`#/receipt/${p.txid}`}>
                View verified receipt →
              </a>
              <a
                href={`https://explorer.solana.com/tx/${p.txid}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                Explorer ↗
              </a>
            </div>
            <details>
              <summary>Download transaction evidence</summary>
              <p>
                Finalized slot {p.slot}. Browser-wallet use is reported by the
                participants; signatures and settlement are independently
                verified on chain.
              </p>
              <p>
                <a href={`/api/receipts/${p.txid}/evidence`} download>
                  Original transaction and receipt JSON ↓
                </a>
              </p>
              <a
                href={`https://github.com/RileyCreighton/barterbook/blob/main/evidence/hosted/${p.artifact}-finalized-verification.json`}
                target="_blank"
                rel="noreferrer"
              >
                Independent verification record ↗
              </a>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
