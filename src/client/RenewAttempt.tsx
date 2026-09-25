import { useEffect, useRef, useState } from "react";
import { raw } from "../shared/amounts";
import { legFor, validateTerms } from "../shared/transactions";
import type { Asset, Room, Terms } from "../shared/types";
import { api } from "./api";
import { TermsView } from "./TradeViews";

export function RenewAttempt({
  room,
  assets,
  onRenewed,
}: {
  room: Room;
  assets: Asset[];
  onRenewed: (room: Room) => void;
}) {
  const attempt = room.attempt;
  const eligible = Boolean(
    attempt?.safeToRetry &&
    !attempt.successObserved &&
    ["FAILED_ONCHAIN", "EXPIRED_UNLANDED"].includes(attempt.state),
  );
  const binding = `${room.id}:${room.termsHash}:${room.terms.version}:${attempt?.id ?? ""}:${eligible}`;
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    binding: string;
    terms: Terms;
    assets: Asset[];
  } | null>(null);

  useEffect(() => {
    generation.current += 1;
    setPreview(null);
    setError("");
    setBusy(false);
  }, [binding]);

  if (!eligible || !attempt) return null;
  const currentPreview = preview?.binding === binding ? preview : null;

  async function refreshPreview() {
    const request = ++generation.current;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const fresh = await api<{ assets: Asset[] }>("/assets/fresh");
      const legs = room.terms.legs.map((leg) => {
        const asset = fresh.assets.find(
          (a) =>
            a.mint === leg.mint && a.cluster === room.terms.cluster && a.tested,
        );
        if (!asset)
          throw new Error(
            "A required asset is no longer validated. This room cannot be renewed.",
          );
        return legFor(leg.fromOwner, leg.toOwner, asset, leg.grossRaw);
      });
      for (const minimum of room.terms.minima) {
        const net = legs
          .filter((l) => l.toOwner === minimum.owner && l.mint === minimum.mint)
          .reduce((total, leg) => total + raw(leg.netRaw), 0n);
        if (net < raw(minimum.minNetRaw)) {
          const symbol =
            fresh.assets.find((a) => a.mint === minimum.mint)?.symbol ??
            "A token";
          throw new Error(
            `${symbol}: current fees would put a receipt below its existing minimum. Negotiate different terms; renewal will not lower a minimum or increase a gross lot.`,
          );
        }
      }
      const terms: Terms = {
        ...room.terms,
        version: room.terms.version + 1,
        owners: [...room.terms.owners],
        legs,
        minima: room.terms.minima.map((minimum) => ({ ...minimum })),
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
      validateTerms(terms, fresh.assets);
      if (generation.current === request)
        setPreview({ binding, terms, assets: fresh.assets });
    } catch (cause) {
      if (generation.current === request)
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not refresh the terms.",
        );
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }

  async function renew() {
    if (!currentPreview || !attempt || busy) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ room: Room }>(`/rooms/${room.id}/renew`, {
        expectedVersion: room.terms.version,
        attemptId: attempt.id,
        terms: currentPreview.terms,
      });
      if (generation.current === request) {
        setPreview(null);
        onRenewed(result.room);
      }
    } catch (cause) {
      if (generation.current === request)
        setError(
          cause instanceof Error ? cause.message : "Could not renew this room.",
        );
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }

  return (
    <section
      className="card basket-preview"
      aria-labelledby="renew-attempt-title"
    >
      <p className="eyebrow">Original attempt reconciled</p>
      <h2 id="renew-attempt-title">Review a fresh terms revision</h2>
      <p>
        Keep the same gross lots, recipient minimums, participants, fee payer
        and SOL caps. Refresh issuer fees before everyone reviews and accepts a
        new version.
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void refreshPreview()}
      >
        {busy
          ? "Checking the original room…"
          : "Refresh fees and preview renewal"}
      </button>
      {currentPreview && (
        <div className="renew-preview">
          <h3>
            Version {currentPreview.terms.version} · exact proposed transfers
          </h3>
          <TermsView
            terms={currentPreview.terms}
            assets={
              currentPreview.assets.length ? currentPreview.assets : assets
            }
          />
          <p className="muted">
            New room terms expire in one hour. Source listings retain their own
            expiry. Every acceptance and readiness choice resets; this step
            requests no wallet signature.
          </p>
          <button disabled={busy} onClick={() => void renew()}>
            Create revision for everyone to review
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
