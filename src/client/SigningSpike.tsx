import { useEffect, useRef, useState } from "react";
import { b64, sha256, unb64 } from "../shared/crypto";
import { verifyTransaction } from "../shared/transactions";
import type { FrozenPlan, Terms } from "../shared/types";
import {
  availableWallets,
  connectWallet,
  signFrozenTransaction,
  signWalletMessage,
  watchWallets,
  watchWalletConnection,
} from "./wallet";
import type { BrowserWallet, WalletConnection } from "./wallet";

export function SigningSpike() {
  const [wallets, setWallets] = useState<readonly BrowserWallet[]>([]);
  const [connection, setConnection] = useState<WalletConnection | null>(null);
  const [planText, setPlanText] = useState("");
  const [wire, setWire] = useState("");
  const [review, setReview] = useState<{
    plan: FrozenPlan;
    terms: Terms;
    message: string;
    hash: string;
  } | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operationPending = useRef(false);

  useEffect(() => {
    const refresh = () => setWallets(availableWallets());
    refresh();
    return watchWallets(refresh);
  }, []);
  useEffect(() => {
    if (!connection) return;
    return watchWalletConnection(connection, () => {
      setConnection(null);
      resetReview();
      setError(
        "Wallet account or devnet access changed. Connect and review again. No signature will be requested automatically.",
      );
    });
  }, [connection]);

  async function run(action: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Wallet operation failed.",
      );
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }

  function resetReview() {
    setReview(null);
    setAccepted(false);
    setResult("");
  }

  return (
    <section aria-labelledby="spike-title" className="signing-spike">
      <p className="eyebrow">Devnet only · signing compatibility test</p>
      <h1 id="spike-title">Prove the wallet round trip</h1>
      <p>
        Use only authorized disposable wallets with faucet funds. This screen
        verifies and signs a frozen transaction without broadcasting it. Test
        tokens are not PRE holdings.
      </p>
      <p role="status">
        {connection
          ? `Connected: ${connection.wallet.name} · ${connection.account.address}`
          : "No wallet connected."}
      </p>
      <div className="actions">
        {wallets.map((wallet, index) => (
          <button
            key={`${wallet.name}-${index}`}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setConnection(null);
                resetReview();
                setConnection(await connectWallet(wallet));
                setResult("");
              })
            }
          >
            Connect {wallet.name}
          </button>
        ))}
      </div>
      {!wallets.length && (
        <p>
          No compatible browser wallet found. Enable a Wallet Standard wallet
          with devnet message signing and sign-transaction support, then reload.
        </p>
      )}
      <button
        disabled={!connection || busy}
        onClick={() =>
          void run(async () => {
            if (!connection) return;
            const nonce = crypto.randomUUID();
            const message = `BarterBook devnet wallet compatibility check\nOrigin: ${location.origin}\nWallet: ${connection.account.address}\nCluster: devnet\nNonce: ${nonce}\nThis message proves wallet control only; it does not authorize a transfer.`;
            const signature = await signWalletMessage(connection, message);
            setResult(
              JSON.stringify(
                {
                  kind: "message-signing-proof",
                  message,
                  signatureBase64: signature,
                  wallet: connection.wallet.name,
                  publicKey: connection.account.address,
                },
                null,
                2,
              ),
            );
          })
        }
      >
        Test message signing
      </button>

      <label>
        Frozen plan JSON
        <textarea
          rows={8}
          spellCheck={false}
          value={planText}
          onChange={(event) => {
            setPlanText(event.target.value);
            resetReview();
          }}
        />
      </label>
      <label>
        Transaction bytes (base64)
        <textarea
          rows={4}
          spellCheck={false}
          value={wire}
          onChange={(event) => {
            setWire(event.target.value.trim());
            setResult("");
          }}
        />
      </label>
      <button
        disabled={busy || !planText || !wire}
        onClick={() =>
          void run(async () => {
            const plan = JSON.parse(planText) as FrozenPlan;
            if (plan.terms.cluster !== "devnet")
              throw new Error("Only devnet plans are supported.");
            const parts = verifyTransaction(unb64(wire), plan);
            setReview({
              plan: structuredClone(plan),
              terms: structuredClone(plan.terms),
              message: b64(parts.message),
              hash: await sha256(parts.message),
            });
            setAccepted(false);
            setResult("");
          })
        }
      >
        Decode and review exact terms
      </button>

      {review && (
        <div>
          <h2>Terms to approve</h2>
          <p>
            Version {review.terms.version} · {review.terms.mode} ·{" "}
            {review.terms.cluster}
          </p>
          <p>
            Fee payer: <code>{review.terms.feePayer}</code>
          </p>
          <p>
            Network fee cap: {review.terms.maxNetworkFeeLamports} lamports.
            Receiving-account funding cap: {review.terms.maxAccountRentLamports}{" "}
            lamports.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>From → to</th>
                  <th>Mint</th>
                  <th>Gross raw</th>
                  <th>Fee raw</th>
                  <th>Net raw</th>
                </tr>
              </thead>
              <tbody>
                {review.terms.legs.map((leg, index) => (
                  <tr key={index}>
                    <td>
                      <code>
                        {leg.fromOwner} → {leg.toOwner}
                      </code>
                    </td>
                    <td>
                      <code>{leg.mint}</code>
                    </td>
                    <td>{leg.grossRaw}</td>
                    <td>{leg.expectedFeeRaw}</td>
                    <td>{leg.netRaw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Message hash: <code>{review.hash}</code>
          </p>
          <p>
            Last valid block height: {review.plan.lastValidBlockHeight}. Signing
            does not revoke itself when this page closes.
          </p>
          <label>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
            />{" "}
            I have reviewed these exact devnet quantities, participants, fees
            and source/destination accounts in the plan.
          </label>
          <button
            disabled={busy || !connection || !accepted}
            onClick={() =>
              void run(async () => {
                if (!connection) return;
                const current = verifyTransaction(
                  unb64(wire),
                  review.plan,
                  review.terms,
                );
                if (b64(current.message) !== review.message)
                  throw new Error(
                    "The frozen message changed. Review a new plan before signing.",
                  );
                const signed = await signFrozenTransaction(
                  connection,
                  wire,
                  review.plan,
                  review.terms,
                );
                setWire(signed);
                setResult(
                  JSON.stringify(
                    {
                      kind: "partial-signature-proof",
                      wallet: connection.wallet.name,
                      publicKey: connection.account.address,
                      messageHash: review.hash,
                      signedWireBase64: signed,
                      broadcast: false,
                    },
                    null,
                    2,
                  ),
                );
              })
            }
          >
            Verify and request transaction signature
          </button>
        </div>
      )}
      {busy && (
        <p role="status">
          Checking the transaction or waiting for your wallet…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <label>
          Verified result — copy to the next authorized participant
          <textarea readOnly rows={9} value={result} />
        </label>
      )}
      <p>
        Passing this test proves only the recorded signing step. A confirmed
        devnet exchange still needs submission through the durable attempt flow
        and a transaction-specific receipt.
      </p>
    </section>
  );
}
