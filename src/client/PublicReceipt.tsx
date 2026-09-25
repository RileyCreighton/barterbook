import { useEffect, useState } from "react";
import type { Asset, Receipt } from "../shared/types";
import { api } from "./api";
import { ReceiptView } from "./TradeViews";
export function PublicReceipt({
  txid,
  assets,
}: {
  txid: string;
  assets: Asset[];
}) {
  const [receipt, setReceipt] = useState<
      (Receipt & { evidenceAvailable?: boolean }) | null
    >(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setReceipt(null);
    setError("");
    api<{ receipt: Receipt & { evidenceAvailable?: boolean } }>(
      `/receipts/${encodeURIComponent(txid)}`,
    )
      .then((data) => {
        if (active) setReceipt(data.receipt);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [txid]);
  return (
    <>
      <a href="#/walkthrough" className="back-link">
        ← Judge walkthrough
      </a>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            Public transaction evidence · no wallet needed
          </p>
          <h1>One exchange, one receipt.</h1>
          <p className="subhead">
            Verified account effects from this transaction’s metadata.
          </p>
        </div>
      </div>
      {receipt ? (
        <ReceiptView receipt={receipt} assets={assets} />
      ) : (
        <div className="card empty-state">
          <h2>
            {error ? "Receipt unavailable" : "Loading transaction receipt…"}
          </h2>
          <p>
            {error ||
              "Only completed, verified transaction evidence appears here."}
          </p>
          <p>
            A signature by itself is not proof of settlement. No receipt is
            fabricated for this link.
          </p>
        </div>
      )}
    </>
  );
}
