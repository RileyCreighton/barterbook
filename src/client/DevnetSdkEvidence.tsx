import evidence from "./devnet-sdk-summary.json";
import { formatAmount } from "../shared/amounts";
import { short } from "./TradeViews";

export function DevnetSdkEvidence() {
  return (
    <section
      className="local-evidence devnet-sdk-evidence"
      aria-labelledby="devnet-sdk-title"
    >
      <p className="eyebrow">Executed on public devnet · SDK demonstration</p>
      <h3 id="devnet-sdk-title">
        Two exchanges finalized. The failure rolled back.
      </h3>
      <p>
        These developer-run tests used disposable SDK wallets and TEST-A/B/C
        mock tokens, not real PRE. They are separate from application trade-room
        receipts and from the local LiteSVM checks.
      </p>
      <div className="local-result-grid">
        {evidence.proofs.map((proof) => (
          <article key={proof.txid}>
            <span className="pill">
              {proof.atomicRollbackVerified
                ? "Finalized failure · rollback verified"
                : "Finalized success · devnet"}
            </span>
            <h3>{proof.title}</h3>
            <p>
              {proof.owners} SDK signers · one unchanged message ·{" "}
              {proof.wireBytes} bytes
            </p>
            <p>
              {proof.atomicRollbackVerified
                ? "Every token-account delta was zero. The network fee was still charged."
                : "Transaction metadata verified every source debit and net credit."}
            </p>
            <p>
              Network fee: <strong>{proof.networkFeeLamports} lamports</strong>
            </p>
            <p>
              Slot {proof.slot} ·{" "}
              {new Date(proof.blockTime * 1000).toUTCString()}
            </p>
            <a
              href={`https://explorer.solana.com/tx/${proof.txid}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              Inspect devnet transaction ↗
            </a>
            <details>
              <summary>Net effects and public evidence</summary>
              <ul className="sdk-effects">
                {proof.effects.map((effect) => (
                  <li key={effect.mint}>
                    <strong>{effect.symbol}</strong>:{" "}
                    {formatAmount(effect.netCreditRaw, effect.decimals)} net
                    credited
                  </li>
                ))}
              </ul>
              <p>
                Transaction: <code title={proof.txid}>{short(proof.txid)}</code>
              </p>
              <p>
                Message hash:{" "}
                <code title={proof.messageHash}>
                  {short(proof.messageHash)}
                </code>
              </p>
              <div className="sdk-evidence-links">
                <a
                  href={`${evidence.rawEvidenceBase}${proof.artifact}-receipt.json`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verified receipt JSON ↗
                </a>
                <a
                  href={`${evidence.rawEvidenceBase}${proof.artifact}-transaction.json`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Finalized transaction metadata ↗
                </a>
                <a
                  href={`${evidence.rawEvidenceBase}${proof.artifact}-sdk-signing.json`}
                  target="_blank"
                  rel="noreferrer"
                >
                  SDK signing record ↗
                </a>
              </div>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
