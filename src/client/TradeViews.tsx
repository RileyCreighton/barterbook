import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { formatAmount, netFor, parseAmount } from "../shared/amounts";
import { legFor, validateTerms } from "../shared/transactions";
import type { Asset, Receipt, Terms } from "../shared/types";
import { nonceAddress } from "../shared/nonce";
export const short = (s: string) =>
  s.length > 14 ? `${s.slice(0, 5)}…${s.slice(-5)}` : s;
export const amount = (raw: string, asset?: Asset) =>
  asset ? formatAmount(raw, asset.decimals) : `${raw} raw`;
export interface Offer {
  id: string;
  roomId: string;
  version: number;
  proposer: string;
  recipient: string;
  status: string;
  terms: Terms;
}
export function AssetMark({
  symbol,
  index = 0,
}: {
  symbol: string;
  index?: number;
}) {
  return (
    <span aria-hidden="true" className={`asset-mark tone-${index % 3}`}>
      {symbol.replace("TEST-", "").slice(0, 1)}
    </span>
  );
}
export function AssetSelect({
  assets,
  value,
  onChange,
  label,
  empty = "Choose an asset",
}: {
  assets: Asset[];
  value: string;
  onChange: (v: string) => void;
  label: string;
  empty?: string;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{empty}</option>
        {assets.map((a) => (
          <option key={a.mint} value={a.mint}>
            {a.symbol} · devnet test
          </option>
        ))}
      </select>
    </label>
  );
}
export function TermsView({
  terms,
  assets,
}: {
  terms: Terms;
  assets: Asset[];
}) {
  return (
    <>
      <div className="terms-heading">
        <span className="pill">
          {terms.mode === "RING" ? "Three-way exchange" : "Exact basket"} · v
          {terms.version}
        </span>
        <span className="muted">
          {terms.owners.length} participants · {terms.legs.length} transfers
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>From → to</th>
              <th>Asset</th>
              <th>Gross</th>
              <th>Fee</th>
              <th>Net receipt</th>
            </tr>
          </thead>
          <tbody>
            {terms.legs.map((leg, i) => {
              const a = assets.find((a) => a.mint === leg.mint);
              return (
                <tr key={i}>
                  <td>
                    <span title={leg.fromOwner}>{short(leg.fromOwner)}</span> →{" "}
                    <span title={leg.toOwner}>{short(leg.toOwner)}</span>
                  </td>
                  <td>{a?.symbol ?? short(leg.mint)}</td>
                  <td>{amount(leg.grossRaw, a)}</td>
                  <td>{amount(leg.expectedFeeRaw, a)}</td>
                  <td className="positive">{amount(leg.netRaw, a)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cost-row">
        <span>
          Fee payer{" "}
          <strong title={terms.feePayer}>{short(terms.feePayer)}</strong>
        </span>
        <span>
          Network cap{" "}
          <strong>{formatAmount(terms.maxNetworkFeeLamports, 9)} SOL</strong>
        </span>
        <span>
          Account funding cap{" "}
          <strong>{formatAmount(terms.maxAccountRentLamports, 9)} SOL</strong>
        </span>
      </div>
      <details>
        <summary>Exact raw quantities, accounts and minimum receipts</summary>
        <pre>{JSON.stringify(terms, null, 2)}</pre>
      </details>
      {terms.nonceAccount && (
        <p className="approval-help">
          <strong>Time to review every signature.</strong> This exchange uses
          longer-lived signing. The fee payer controls its signing account.
          Closing the page or ending the review period does not revoke
          signatures; cancellation requires the fee payer's on-chain approval.
        </p>
      )}
    </>
  );
}
export function ReceiptView({
  receipt,
  assets,
}: {
  receipt: Receipt & { evidenceAvailable?: boolean };
  assets: Asset[];
}) {
  return (
    <div className="card receipt">
      <p className="eyebrow">Transaction-specific evidence</p>
      <h2>
        {receipt.verified ? "Receipt verified" : "Receipt verification pending"}
      </h2>
      <p>
        {receipt.status.toLowerCase()} on {receipt.cluster} · slot{" "}
        {receipt.slot}
      </p>
      {receipt.blockTime != null && (
        <p>Block time: {new Date(receipt.blockTime * 1000).toUTCString()}</p>
      )}
      <a
        href={`https://explorer.solana.com/tx/${receipt.txid}?cluster=${receipt.cluster}`}
        target="_blank"
        rel="noreferrer"
      >
        Inspect original transaction ↗
      </a>
      {receipt.status === "FINALIZED" && receipt.evidenceAvailable && (
        <p>
          <a
            href={`/api/receipts/${encodeURIComponent(receipt.txid)}/evidence`}
            download
          >
            Download public evidence ↓
          </a>
        </p>
      )}
      <p>
        Network fee: {formatAmount(receipt.networkFeeLamports, 9)} SOL · account
        funding: {formatAmount(receipt.accountRentLamports, 9)} SOL
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Owner / account</th>
              <th>Asset</th>
              <th>Transaction delta (raw)</th>
            </tr>
          </thead>
          <tbody>
            {receipt.deltas.map((d, i) => (
              <tr key={i}>
                <td title={d.account}>
                  {short(d.owner)} / {short(d.account)}
                </td>
                <td>
                  {assets.find((a) => a.mint === d.mint)?.symbol ??
                    short(d.mint)}
                </td>
                <td>{d.deltaRaw}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        Effects come from this transaction’s metadata. Later wallet activity
        cannot alter this receipt.
      </p>
    </div>
  );
}
export function ConnectPrompt({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="card empty-state">
      <span className="outline-icon">⇄</span>
      <h2>Your wallet is your identity.</h2>
      <p>
        Connect an authorized devnet test wallet to see selected inventory,
        proposals and private trade rooms.
      </p>
      <button onClick={onConnect}>Connect wallet</button>
      <p>
        <a href="#/walkthrough">Explore without a wallet →</a>
      </p>
    </div>
  );
}
export function ListingComposer({
  assets,
  busy,
  onCreate,
}: {
  assets: Asset[];
  busy: boolean;
  onCreate: (data: unknown) => void;
}) {
  const [give, setGive] = useState(""),
    [want, setWant] = useState(""),
    [gross, setGross] = useState(""),
    [minimum, setMinimum] = useState(""),
    [error, setError] = useState("");
  const a = assets.find((a) => a.mint === give),
    b = assets.find((a) => a.mint === want);
  let preview = "";
  try {
    if (a && gross)
      preview = `${amount(netFor(parseAmount(gross, a.decimals), a), a)} ${a.symbol} reaches its recipient after the current fee.`;
  } catch {}
  return (
    <aside className="card listing-composer">
      <p className="eyebrow">Selected inventory</p>
      <h2>Publish an exact lot</h2>
      <p className="muted">
        One fixed gross quantity for a minimum net amount of a different asset.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          try {
            if (!a || !b || give === want)
              throw new Error("Choose two different validated assets.");
            onCreate({
              giveMint: give,
              wantMint: want,
              grossRaw: parseAmount(gross, a.decimals),
              minReceiveNetRaw: parseAmount(minimum, b.decimals),
              expiresAt: Date.now() + 86400000,
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : "Check your quantities.");
          }
        }}
      >
        <AssetSelect
          assets={assets}
          value={give}
          onChange={setGive}
          label="I give"
        />
        <label>
          Exact gross quantity
          <input
            inputMode="decimal"
            required
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            placeholder="0.00"
          />
        </label>
        <AssetSelect
          assets={assets}
          value={want}
          onChange={setWant}
          label="I want"
        />
        <label>
          Minimum net receipt
          <input
            inputMode="decimal"
            required
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
            placeholder="0.00"
          />
        </label>
        {preview && <p className="status-note">{preview}</p>}
        <p className="muted">
          Expires in 24 hours. Listings are unsigned and do not reserve tokens
          onchain.
        </p>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy || assets.length < 2}>
          Publish selected lot →
        </button>
      </form>
    </aside>
  );
}
interface DraftLine {
  mint: string;
  quantity: string;
  side: "give" | "receive";
}
export function BasketComposer({
  assets,
  owner,
  recipient,
  counter,
  busy,
  onCreate,
  onConnect,
}: {
  assets: Asset[];
  owner: string;
  recipient: string;
  counter: Offer | null;
  busy: boolean;
  onCreate: (terms: Terms) => void;
  onConnect: () => void;
}) {
  const [other, setOther] = useState(recipient),
    [lines, setLines] = useState<DraftLine[]>([
      { mint: "", quantity: "", side: "give" },
      { mint: "", quantity: "", side: "give" },
      { mint: "", quantity: "", side: "receive" },
    ]);
  const [payer, setPayer] = useState("you"),
    [network, setNetwork] = useState("0.0001"),
    [rent, setRent] = useState("0.03"),
    [preview, setPreview] = useState<Terms | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setOther(recipient);
    setPreview(null);
    if (counter) {
      setLines(
        counter.terms.legs.map((l) => ({
          mint: l.mint,
          quantity: formatAmount(l.grossRaw, l.decimals),
          side: l.fromOwner === owner ? "give" : "receive",
        })),
      );
      setPayer(counter.terms.feePayer === owner ? "you" : "other");
      setNetwork(formatAmount(counter.terms.maxNetworkFeeLamports, 9));
      setRent(formatAmount(counter.terms.maxAccountRentLamports, 9));
    }
  }, [recipient, counter?.id, owner]);
  function update(i: number, patch: Partial<DraftLine>) {
    setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)));
    setPreview(null);
  }
  async function calculate() {
    setError("");
    try {
      if (!owner) {
        onConnect();
        throw new Error("Connect your test wallet before creating terms.");
      }
      const target = new PublicKey(other).toBase58();
      if (
        target === owner ||
        !PublicKey.isOnCurve(new PublicKey(target).toBytes())
      )
        throw new Error("Choose a different signing participant.");
      if (new Set(lines.map((l) => l.mint)).size !== lines.length)
        throw new Error(
          "Each mint may appear once. Opposing transfers of the same mint are not supported.",
        );
      const legs = lines.map((l) => {
        const a = assets.find((a) => a.mint === l.mint);
        if (!a) throw new Error("Choose a validated asset on every line.");
        return legFor(
          l.side === "give" ? owner : target,
          l.side === "give" ? target : owner,
          a,
          parseAmount(l.quantity, a.decimals),
        );
      });
      const terms: Terms = {
        cluster: "devnet",
        mode: "BASKET",
        version: counter ? counter.version + 1 : 1,
        owners: [owner, target],
        feePayer: payer === "you" ? owner : target,
        nonceAccount: await nonceAddress(payer === "you" ? owner : target),
        maxNetworkFeeLamports: parseAmount(network, 9),
        maxAccountRentLamports: parseAmount(rent, 9),
        legs,
        minima: legs.map((l) => ({
          owner: l.toOwner,
          mint: l.mint,
          minNetRaw: l.netRaw,
        })),
        expiresAt: Date.now() + 3600000,
      };
      validateTerms(terms, assets);
      setPreview(terms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Review all quantities.");
    }
  }
  return (
    <div className="composer-layout">
      <section>
        <div className="card">
          <div className="section-heading">
            <h2>
              {counter
                ? `Counteroffer · version ${counter.version + 1}`
                : "Two-for-one basket"}
            </h2>
            <span className="pill">Up to 3 validated mints</span>
          </div>
          <label>
            Other participant’s wallet
            <input
              value={other}
              placeholder="Devnet wallet public address"
              onChange={(e) => {
                setOther(e.target.value.trim());
                setPreview(null);
              }}
            />
          </label>
          <div className="basket-columns">
            {(["give", "receive"] as const).map((side) => (
              <section key={side}>
                <p className="eyebrow">
                  {side === "give"
                    ? "You give · gross debit"
                    : "Other holder gives · gross debit"}
                </p>
                {lines.map(
                  (l, i) =>
                    l.side === side && (
                      <div className="basket-line" key={i}>
                        <AssetSelect
                          assets={assets}
                          value={l.mint}
                          onChange={(mint) => update(i, { mint })}
                          label={`${side === "give" ? "Your" : "Their"} asset ${i + 1}`}
                        />
                        <label>
                          Gross quantity
                          <input
                            inputMode="decimal"
                            value={l.quantity}
                            placeholder="0.00"
                            onChange={(e) =>
                              update(i, { quantity: e.target.value })
                            }
                          />
                        </label>
                        {lines.filter((l) => l.side === side).length > 1 && (
                          <button
                            className="link-button"
                            onClick={() => {
                              setLines(lines.filter((_, n) => n !== i));
                              setPreview(null);
                            }}
                          >
                            Remove line
                          </button>
                        )}
                      </div>
                    ),
                )}
                {lines.length < Math.min(assets.length, 3) && (
                  <button
                    className="secondary small"
                    onClick={() => {
                      setLines([...lines, { mint: "", quantity: "", side }]);
                      setPreview(null);
                    }}
                  >
                    ＋ Add asset
                  </button>
                )}
              </section>
            ))}
          </div>
          <div className="cost-inputs">
            <label>
              Fee payer
              <select
                value={payer}
                onChange={(e) => {
                  setPayer(e.target.value);
                  setPreview(null);
                }}
              >
                <option value="you">You</option>
                <option value="other">Other participant</option>
              </select>
            </label>
            <label>
              Network fee cap (SOL)
              <input
                inputMode="decimal"
                value={network}
                onChange={(e) => {
                  setNetwork(e.target.value);
                  setPreview(null);
                }}
              />
            </label>
            <label>
              Account funding cap (SOL)
              <input
                inputMode="decimal"
                value={rent}
                onChange={(e) => {
                  setRent(e.target.value);
                  setPreview(null);
                }}
              />
            </label>
          </div>
          <p className="muted">
            Terms expire in one hour. Excess decimal precision is rejected
            without rounding.
          </p>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy || assets.length < 2} onClick={calculate}>
            Calculate fees and review →
          </button>
        </div>
        {preview && (
          <div className="card basket-preview">
            <h2>Review the exact package</h2>
            <TermsView terms={preview} assets={assets} />
            <p>
              Each minimum equals the fee-adjusted net shown above. A
              counteroffer resets previous acceptances.
            </p>
            <button disabled={busy} onClick={() => onCreate(preview)}>
              {counter ? "Send counteroffer" : "Create private offer room"} →
            </button>
          </div>
        )}
      </section>
      <aside>
        <div className="card">
          <p className="eyebrow">BasketSwap</p>
          <h2>The complete package.</h2>
          <p>
            Two holders negotiate the whole exchange. Every token leg settles in
            the same transaction.
          </p>
          <ul className="plain-list">
            <li>Exact gross debits and net receipts</li>
            <li>Issuer fees apply to every transfer</li>
            <li>Browser verification before signing</li>
            <li>No silent netting of opposing assets</li>
          </ul>
        </div>
        {assets.length < 3 && (
          <div className="status-note">
            {assets.length} of 3 test mints configured. Two-for-one baskets
            require three separately validated mints.
          </div>
        )}
        <div className="card muted">
          <h3>No valuation claims</h3>
          <p>
            These are agreed quantities. Issuer marks do not establish
            executable prices or savings.
          </p>
        </div>
      </aside>
    </div>
  );
}
