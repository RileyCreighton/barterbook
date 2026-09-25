import { useEffect, useState } from "react";
import { api } from "./api";
import { signFaucetTransaction, type WalletConnection } from "./wallet";
import type { FaucetClaim } from "../shared/demo-faucet";
import { BrowserEvidence } from "./BrowserEvidence";
export function JudgeGuide({
  connection,
  owner,
  onConnect,
}: {
  connection: WalletConnection | null;
  owner: string | null;
  onConnect: () => void;
}) {
  const [claim, setClaim] = useState<FaucetClaim | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setClaim(null);
    setError("");
    if (owner)
      api<{ claim: FaucetClaim | null }>("/demo/faucet/latest")
        .then((r) => {
          if (active) setClaim(r.claim);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [owner]);
  const ready = !!connection && owner === connection.account.address;
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function sign(c: FaucetClaim) {
    if (!connection || !ready) return onConnect();
    const wireBase64 = await signFaucetTransaction(
      connection,
      c.wireBase64,
      c.plan,
    );
    const r = await api<{ claim: FaucetClaim }>(`/demo/faucet/${c.id}/submit`, {
      wireBase64,
    });
    setClaim(r.claim);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Judge's guide · hands-on Devnet demo</p>
          <h1>Try the whole exchange.</h1>
          <p className="subhead">
            Bring two or three test wallets. Get tokens here. Review, sign and
            settle through the live app.
          </p>
        </div>
        <a className="button-link secondary" href="#/walkthrough">
          Watch the recorded flow →
        </a>
      </div>
      <div className="judge-layout">
        <section className="card">
          <p className="eyebrow">01 · Set up your test wallets</p>
          <h2>Your keys. Your approvals.</h2>
          <p>
            Use Phantom with Testnet Mode enabled and Solana Devnet selected.
            Open two separate browser profiles for a basket, or three for a
            cycle. Create a fresh wallet in each profile; keep each profile open
            through the exchange.
          </p>
          <p>
            Get at least <strong>0.02 Devnet SOL per wallet</strong> from the
            Solana faucet, then connect and approve the login message in each
            profile.
          </p>
          <div className="actions">
            <a
              className="button-link secondary"
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noreferrer"
            >
              Get Devnet SOL ↗
            </a>
            <button onClick={onConnect}>
              {ready ? "Manage connected wallet" : "Connect Phantom"}
            </button>
          </div>
          <p className="muted">
            Devnet SOL and TEST-A/B/C have no monetary value. Faucet SOL
            availability is controlled by Solana's faucet. The app never asks
            for recovery phrases.
          </p>
        </section>
        <section className="card">
          <p className="eyebrow">02 · Get the demo inventory</p>
          <h2>1,000 of each test token.</h2>
          <p>
            Receive TEST-A, TEST-B and TEST-C directly into your connected
            wallet. Approve one Devnet transaction to create your token accounts
            and receive inventory. Setup costs less than{" "}
            <strong>0.01 Devnet SOL</strong>, paid by your test wallet.
          </p>
          {owner && (
            <p className="wallet-address">
              Receiving wallet: <code>{owner}</code>
            </p>
          )}
          {error && (
            <p role="alert" className="global-message">
              {error} If approval or submission timed out, check the original
              request below.
            </p>
          )}
          {claim && (
            <div className="status-note" role="status">
              {claim.state === "FINALIZED"
                ? "Test tokens delivered. Open Portfolio and refresh holdings."
                : `Test-token request: ${claim.state.toLowerCase()}.`}
              {claim.txid && (
                <>
                  {" "}
                  <a
                    href={`https://explorer.solana.com/tx/${claim.txid}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction ↗
                  </a>
                </>
              )}
            </div>
          )}
          <div className="actions">
            {!ready ? (
              <button onClick={onConnect}>Connect to get test tokens</button>
            ) : !claim ||
              ["FINALIZED", "FAILED", "EXPIRED"].includes(claim.state) ? (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const r = await api<{ claim: FaucetClaim }>(
                      "/demo/faucet/prepare",
                      {},
                    );
                    setClaim(r.claim);
                    await sign(r.claim);
                  })
                }
              >
                {busy ? "Preparing…" : "Get 1,000 TEST-A, TEST-B & TEST-C"}
              </button>
            ) : claim.state === "PREPARED" ? (
              <button
                disabled={busy}
                onClick={() => void action(() => sign(claim))}
              >
                Approve original token request
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setClaim(
                      (
                        await api<{ claim: FaucetClaim }>(
                          `/demo/faucet/${claim.id}/submit`,
                          {},
                        )
                      ).claim,
                    ),
                  )
                }
              >
                Resend original request
              </button>
            )}
            {ready && claim && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () =>
                    setClaim(
                      (
                        await api<{ claim: FaucetClaim }>(
                          `/demo/faucet/${claim.id}`,
                        )
                      ).claim,
                    ),
                  )
                }
              >
                Check token request
              </button>
            )}
            <a href="#/portfolio">Open Portfolio →</a>
          </div>
          <p className="muted">
            Allow a few seconds after submission, then check the request. Up to
            eight preparations per wallet per day. If an unsigned request
            expires, check it first to enable a fresh request.
          </p>
        </section>
      </div>
      <section className="card">
        <p className="eyebrow">03 · Choose your test</p>
        <h2>Start with a basket. Then close the loop.</h2>
        <div className="judge-layout">
          <div>
            <h3>Two-wallet basket</h3>
            <p>
              In Alice's profile, make a basket offer to Bob's public address.
              Alice gives <strong>10 TEST-A + 5 TEST-B</strong>; Bob gives{" "}
              <strong>20 TEST-C</strong>. Choose Bob as fee payer. Bob receives
              9.9 A + 4.95 B; Alice receives 19.8 C.
            </p>
            <a href="#/basket">Make a basket offer →</a>
          </div>
          <div>
            <h3>Three-wallet match</h3>
            <p>Each profile publishes its own exact lot in Portfolio:</p>
            <ul>
              <li>Alice: give 10 A; want at least 29.7 C.</li>
              <li>Bob: give 20 B; want at least 9.9 A.</li>
              <li>Carol: give 30 C; want at least 19.8 B.</li>
            </ul>
            <p>
              Bob opens Matches, finds their three-way cycle and opens the
              shared room.
            </p>
            <a href="#/portfolio">Publish your lot →</a>
          </div>
        </div>
      </section>
      <section className="card">
        <p className="eyebrow">04 · Review and settle</p>
        <h2>One transaction. Every participant signs.</h2>
        <ol className="consent-steps">
          <li>
            Open the same room in every profile. Everyone reviews, accepts exact
            terms and marks ready.
          </li>
          <li>
            Bob uses <strong>Set up signing in wallet</strong> once. When the
            signing account is ready, Bob prepares one transaction.
          </li>
          <li>
            Sign in order: Bob, Alice, then Carol for a three-way match. Wait
            for each signature to save.
          </li>
          <li>
            Bob submits once. Wait for{" "}
            <strong>Receipt verified · finalized</strong>, then inspect the
            receipt and download its evidence.
          </li>
        </ol>
        <p>
          Longer-lived signing gives you time to move between profiles. Finish
          within the one-hour review period. To abandon a prepared exchange, Bob
          must cancel on chain and reconcile its original outcome; closing the
          browser does not revoke signatures.
        </p>
        <p>
          Use your own test wallets as counterparties. Listed demonstration
          wallets require their owners' approval and do not trade automatically.
        </p>
      </section>
      <BrowserEvidence />
      <p>
        <a
          href="https://github.com/RileyCreighton/barterbook/blob/main/docs/judging-guide.md"
          target="_blank"
          rel="noreferrer"
        >
          Complete testing guide and troubleshooting on GitHub ↗
        </a>
      </p>
    </>
  );
}
