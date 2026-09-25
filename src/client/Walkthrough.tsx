import { useState } from "react";
import { LocalEvidence } from "./LocalEvidence";
import { BrowserEvidence } from "./BrowserEvidence";
import { TestDisclosure } from "./DemoGuide";
export function Walkthrough() {
  const [step, setStep] = useState(0),
    [basket, setBasket] = useState(false);
  const steps = [
    "Selected inventory",
    "Exact net receipts",
    "Shared approval",
    "Transaction evidence",
  ];
  const rows = basket
    ? [
        ["Alice", "Bob", "TEST-A", "10", "0.1", "9.9"],
        ["Alice", "Bob", "TEST-B", "5", "0.05", "4.95"],
        ["Bob", "Alice", "TEST-C", "20", "0.2", "19.8"],
      ]
    : [
        ["Alice", "Bob", "TEST-A", "10", "0.1", "9.9"],
        ["Bob", "Carol", "TEST-B", "20", "0.2", "19.8"],
        ["Carol", "Alice", "TEST-C", "30", "0.3", "29.7"],
      ];
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">No wallet needed</p>
          <h1>Three wants. One exchange.</h1>
          <p className="subhead">
            Explore the actual browser-executed basket and three-way match, from
            agreed terms to finalized receipts.
          </p>
        </div>
        <a href="#/market" className="button-link secondary">
          Back to live market ↗
        </a>
      </div>
      <div className="example-notice">
        <strong>Recorded browser walkthrough</strong>
        <span>
          These are the terms of the completed Alice, Bob and Carol trades.
          Explore the recorded flow, then open the real receipts in step 4.
        </span>
      </div>
      <TestDisclosure />
      <div className="segmented">
        <button
          className={!basket ? "selected" : ""}
          aria-pressed={!basket}
          onClick={() => {
            setBasket(false);
            setStep(0);
          }}
        >
          Three-way exchange
        </button>
        <button
          className={basket ? "selected" : ""}
          aria-pressed={basket}
          onClick={() => {
            setBasket(true);
            setStep(0);
          }}
        >
          Two-for-one basket
        </button>
      </div>
      <div className="walk-layout">
        <aside className="walk-steps">
          {steps.map((s, i) => (
            <button
              key={s}
              className={step === i ? "current" : ""}
              aria-current={step === i ? "step" : undefined}
              onClick={() => setStep(i)}
            >
              <span>0{i + 1}</span>
              {s}
            </button>
          ))}
        </aside>
        <div className="card walk-content">
          <p className="eyebrow">
            0{step + 1} / 04 · {steps[step]}
          </p>
          <h2>
            {
              [
                basket
                  ? "Agree on the whole package"
                  : "A match that needs all three holders",
                "Every receipt meets its minimum",
                "Every participant approves identical bytes",
                "A receipt belongs to one transaction",
              ][step]
            }
          </h2>
          {step === 0 && (
            <>
              <p>
                {basket
                  ? "Alice offers two test assets for one of Bob’s. Both sides accept the exact package together."
                  : "Alice wants TEST-C, Bob wants TEST-A, and Carol wants TEST-B. These fixed lots form a three-way cycle."}
              </p>
              <div className={`cycle-diagram ${basket ? "two-owner" : ""}`}>
                {(basket ? ["Alice", "Bob"] : ["Alice", "Bob", "Carol"]).map(
                  (name, i) => (
                    <div className="person-card" key={name}>
                      <span className="avatar">{name[0]}</span>
                      <h3>{name}</h3>
                      <p className="muted">Gives</p>
                      <strong>
                        {rows
                          .filter((r) => r[0] === name)
                          .map((r) => `${r[3]} ${r[2]}`)
                          .join(" + ")}
                      </strong>
                      <p className="muted">Receives, after fees</p>
                      <strong className="positive">
                        {rows
                          .filter((r) => r[1] === name)
                          .map((r) => `${r[5]} ${r[2]}`)
                          .join(" + ")}
                      </strong>
                      {i < (basket ? 1 : 2) && (
                        <span className="cycle-arrow">→</span>
                      )}
                    </div>
                  ),
                )}
              </div>
              <p className="diagram-route">
                {basket
                  ? "Alice sends TEST-A + TEST-B to Bob; Bob sends TEST-C to Alice."
                  : "Transfer loop: Alice → Bob → Carol → Alice. Each holder receives the whole lot from the previous holder."}
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p>
                These executed trades used a 1% issuer transfer fee. The live
                engine reads the current mint schedule, rounds in raw integer
                units and checks fee caps.
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="Executed transfer fees and net receipts"
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th>From → to</th>
                      <th>Test asset</th>
                      <th>Gross</th>
                      <th>Fee</th>
                      <th>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td>
                          {r[0]} → {r[1]}
                        </td>
                        <td>{r[2]}</td>
                        <td>{r[3]}</td>
                        <td>{r[4]}</td>
                        <td className="positive">{r[5]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="table-scroll-hint">
                Scroll the table horizontally to see every column.
              </p>
              <div className="status-note">
                Exact whole lots only. Reject the entire match if one net
                receipt falls below that holder’s minimum.
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <div className="message-illustration">
                <span>Accepted terms</span>
                <span>→</span>
                <strong>One frozen message</strong>
                <span>→</span>
                <span>{basket ? "2" : "3"} wallet signatures</span>
              </div>
              <ol className="consent-steps">
                <li>
                  <strong>Authenticate</strong> · A message signature identifies
                  the wallet for board activity.
                </li>
                <li>
                  <strong>Accept terms</strong> · An offchain agreement records
                  the exact quantities and fees.
                </li>
                <li>
                  <strong>Approve transaction</strong> · A fresh wallet
                  signature authorizes the frozen transfers.
                </li>
              </ol>
              <p>
                Each browser reconstructs every instruction from accepted terms
                before opening its wallet. Fee payer, accounts, quantities and
                checked fees must match exactly.
              </p>
              <p>
                A changed blockhash or message needs every signature again.
                Earlier signatures must survive each wallet round trip.
              </p>
              <div className="status-note">
                Longer-lived signing lets each participant review in their own
                wallet. Every signature authorizes the same accepted exchange.
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <BrowserEvidence />
              <details className="separate-local-evidence">
                <summary>
                  Inspect the separate local LiteSVM execution checks
                </summary>
                <LocalEvidence />
              </details>
              <p>
                After a broadcast timeout, reconcile the original identifier. A
                timeout never creates a fresh executable replacement.
              </p>
              <div className="status-note">
                No real PRE holdings or mainnet stock trades are represented by
                these test examples.
              </div>
            </>
          )}
          <div className="walk-controls">
            <span className="muted">
              Recorded exchange · Devnet test assets
            </span>
            {step < 3 ? (
              <button onClick={() => setStep(step + 1)}>
                Next: {steps[step + 1]} →
              </button>
            ) : (
              <a href="#/market" className="button-link">
                Explore the live market →
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
