import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LocalEvidence } from "./LocalEvidence";
import { TestDisclosure } from "./DemoGuide";
import { short } from "./TradeViews";

interface HistoryEntry {
  txid: string;
  cluster: string;
  status: string;
  slot: string;
  verified: boolean;
  createdAt?: number;
  mode?: "BASKET" | "RING";
  owners?: number;
  transfers?: number;
  demo?: boolean;
  evidenceAvailable?: boolean;
  blockTime?: number | null;
}
interface HistoryPage {
  receipts: HistoryEntry[];
  nextCursor: string | null;
}
const verifiedReceipts = (receipts: HistoryEntry[]) =>
  receipts.filter(
    (receipt) =>
      receipt.verified && ["CONFIRMED", "FINALIZED"].includes(receipt.status),
  );
export function PublicHistory() {
  const [receipts, setReceipts] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const generation = useRef(0);
  const morePending = useRef(false);
  useEffect(() => {
    generation.current++;
    let active = true;
    setLoading(true);
    setError("");
    setMoreError("");
    setAnnouncement("");
    api<HistoryPage>("/history")
      .then((result) => {
        if (active) {
          setReceipts(verifiedReceipts(result.receipts));
          setNextCursor(result.nextCursor);
        }
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [revision]);
  async function loadMore() {
    if (!nextCursor || loading || morePending.current) return;
    const currentGeneration = generation.current;
    morePending.current = true;
    setLoadingMore(true);
    setMoreError("");
    setAnnouncement("");
    try {
      const result = await api<HistoryPage>(
        `/history?cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (currentGeneration !== generation.current) return;
      if (result.nextCursor === nextCursor)
        throw new Error(
          "History did not advance. Existing receipts are preserved; try again later.",
        );
      const combined = new Map(
        receipts.map((receipt) => [
          `${receipt.cluster}:${receipt.txid}`,
          receipt,
        ]),
      );
      for (const receipt of verifiedReceipts(result.receipts))
        combined.set(`${receipt.cluster}:${receipt.txid}`, receipt);
      setReceipts([...combined.values()]);
      setNextCursor(result.nextCursor);
      setAnnouncement(
        `${combined.size - receipts.length} older receipts loaded. ${combined.size} verified receipts shown.`,
      );
    } catch (cause) {
      if (currentGeneration === generation.current)
        setMoreError(
          cause instanceof Error
            ? cause.message
            : "Older receipts could not load.",
        );
    } finally {
      morePending.current = false;
      if (currentGeneration === generation.current) setLoadingMore(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Public evidence · no wallet needed</p>
          <h1>Inspect what actually executed.</h1>
          <p className="subhead">
            Public-network receipts and local token-program checks are distinct
            evidence.
          </p>
        </div>
        <button
          className="secondary"
          disabled={loading || loadingMore}
          onClick={() => setRevision(revision + 1)}
        >
          {loading ? "Checking receipts…" : "Refresh latest receipts ↻"}
        </button>
      </div>
      <TestDisclosure />
      <section aria-labelledby="history-title">
        <div className="section-heading history-heading">
          <h2 id="history-title">Recorded public-network receipts</h2>
          <span className="pill">{receipts.length} verified shown</span>
        </div>
        {loading ? (
          <p role="status" className="card">
            Checking recorded transaction metadata…
          </p>
        ) : error ? (
          <div role="alert" className="card">
            <h3>Receipt history could not load</h3>
            <p>{error}</p>
            <button
              className="secondary"
              onClick={() => setRevision(revision + 1)}
            >
              Try again
            </button>
          </div>
        ) : receipts.length ? (
          <div className="history-grid">
            {receipts.map((receipt) => (
              <article className="card" key={receipt.txid}>
                <span className="pill">
                  {receipt.cluster} · {receipt.status.toLowerCase()}
                </span>
                <h3>
                  {receipt.mode === "RING"
                    ? "Three-owner exchange"
                    : receipt.mode === "BASKET"
                      ? "Basket exchange"
                      : "Verified atomic exchange"}
                </h3>
                {receipt.demo && (
                  <p className="demo-wallet-label">
                    Developer-controlled demonstration
                  </p>
                )}
                <p>
                  Slot {receipt.slot}
                  {receipt.owners ? ` · ${receipt.owners} owners` : ""}
                  {receipt.transfers ? ` · ${receipt.transfers} transfers` : ""}
                </p>
                {receipt.blockTime != null && (
                  <p className="muted">
                    Block time:{" "}
                    {new Date(receipt.blockTime * 1000).toUTCString()}
                  </p>
                )}
                <p>
                  <code>{short(receipt.txid)}</code>
                </p>
                <a href={`#/receipt/${receipt.txid}`}>
                  Inspect transaction-specific receipt →
                </a>
                {receipt.status === "FINALIZED" &&
                  receipt.evidenceAvailable && (
                    <p>
                      <a
                        href={`/api/receipts/${encodeURIComponent(receipt.txid)}/evidence`}
                        download
                      >
                        Download public evidence ↓
                      </a>
                    </p>
                  )}
                <p className="muted">
                  A recorded demonstration does not establish organic trading
                  demand or browser-wallet compatibility.
                </p>
              </article>
            ))}
          </div>
        ) : (
          <div className="card empty-state">
            <h3>No public-network receipt has been recorded yet.</h3>
            <p>
              There is no claim of a completed devnet or mainnet trade in this
              history. Local execution checks appear separately below.
            </p>
            <a href="#/walkthrough">Follow the no-wallet walkthrough →</a>
          </div>
        )}
        {!loading && !error && (
          <div className="history-pagination">
            {moreError && <p role="alert">{moreError}</p>}
            <p role="status" aria-live="polite">
              {loadingMore ? "Loading older verified receipts…" : announcement}
            </p>
            {nextCursor ? (
              <button
                className="secondary"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore
                  ? "Loading older receipts…"
                  : moreError
                    ? "Try loading older receipts again"
                    : "Load older receipts"}
              </button>
            ) : receipts.length > 0 ? (
              <p className="muted">
                All available verified receipts have been loaded.
              </p>
            ) : null}
          </div>
        )}
      </section>
      <div className="card history-local">
        <LocalEvidence />
      </div>
    </>
  );
}
