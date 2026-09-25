import type { Asset, Room } from "../shared/types";
import { short } from "./TradeViews";

export interface DemoConfiguration {
  participants: { address: string; label: string }[];
  assets?: Asset[];
  faucetUrl?: string;
  siteUrl?: string;
}
export function participantName(
  address: string,
  demo: DemoConfiguration | null,
) {
  return (
    demo?.participants.find((p) => p.address === address)?.label ??
    short(address)
  );
}
export function TestDisclosure() {
  return (
    <div className="test-disclosure">
      <strong>Live Devnet demo</strong>
      <span>
        Trade test tokens through your own wallets. Explore the completed basket
        and three-way match, or get test inventory to run your own.
      </span>
    </div>
  );
}
export function GettingStarted({
  demo,
  connected,
  onConnect,
}: {
  demo: DemoConfiguration | null;
  connected: boolean;
  onConnect: () => void;
}) {
  const faucet = demo?.faucetUrl;
  const safeFaucet =
    faucet &&
    (() => {
      try {
        return new URL(faucet).protocol === "https:";
      } catch {
        return false;
      }
    })();
  return (
    <section className="getting-started" aria-labelledby="start-title">
      <div className="section-heading">
        <h2 id="start-title">Your first test exchange</h2>
        <a href="#/walkthrough">Explore without a wallet →</a>
      </div>
      <ol className="journey-steps">
        <li>
          <span>01</span>
          <div>
            <strong>Connect & authenticate</strong>
            <p>
              A signed message proves wallet control. It cannot transfer tokens.
            </p>
            <button className="link-button" onClick={onConnect}>
              {connected ? "Manage test wallet" : "Connect test wallet"} →
            </button>
          </div>
        </li>
        <li>
          <span>02</span>
          <div>
            <strong>Get test assets</strong>
            <p>
              Get Devnet SOL from the Solana faucet, then claim 1,000 of each
              test token in the demo guide.
            </p>
            <a href="#/try">Get TEST-A/B/C →</a>
            {safeFaucet && (
              <a href={faucet} target="_blank" rel="noreferrer">
                Get network-fee SOL ↗
              </a>
            )}
          </div>
        </li>
        <li>
          <span>03</span>
          <div>
            <strong>Offer & review</strong>
            <p>
              Propose the whole basket, review exact net receipts, then accept
              its terms.
            </p>
            <a href="#/basket">Compose a basket →</a>
          </div>
        </li>
        <li>
          <span>04</span>
          <div>
            <strong>Approve & settle</strong>
            <p>
              Every owner signs the same transaction. Follow the original result
              to its receipt.
            </p>
            <a href="#/rooms">Open your trade rooms →</a>
          </div>
        </li>
      </ol>
      <p className="online-note">
        All counterparties must be online to review and approve within the
        signing window. A listing is not an unattended or delegated order.
      </p>
      {Boolean(demo?.participants.length) && (
        <details className="demo-participants">
          <summary>Configured demonstration participants</summary>
          <p>
            These labels identify only public addresses configured by the demo
            operator. No wallet keys are supplied by the app.
          </p>
          <ul>
            {demo!.participants.map((p) => (
              <li key={p.address}>
                <strong>{p.label}</strong>
                <code>{p.address}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
export function RoomProgress({ room }: { room: Room }) {
  const accepted = room.members.every(
    (member) => member.acceptedVersion === room.terms.version,
  );
  const signed =
    room.attempt &&
    room.members.every((member) =>
      Boolean(room.attempt!.signatures[member.wallet]),
    );
  const settled = ["CONFIRMED", "FINALIZED"].includes(
    room.attempt?.state ?? "",
  );
  const hasReceipt = Boolean(room.attempt?.receipt?.verified);
  const reconciling = Boolean(room.attempt?.submissionStartedAt) || settled;
  const current = hasReceipt
    ? 4
    : reconciling
      ? 3
      : signed
        ? 2
        : accepted
          ? 1
          : 0;
  const labels = [
    "Review & accept",
    "Wallet approval",
    "Submit once",
    "Reconcile",
    "Verified receipt",
  ];
  return (
    <ol className="room-progress" aria-label="Exchange progress">
      {labels.map((label, index) => (
        <li
          key={label}
          className={
            index < current ? "done" : index === current ? "current" : ""
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span>{index < current ? "✓" : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
