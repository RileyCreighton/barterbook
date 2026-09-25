import { useEffect, useRef, useState } from "react";
import { formatAmount } from "../shared/amounts";
import { canonical } from "../shared/crypto";
import { validateTerms } from "../shared/transactions";
import type {
  Asset,
  Holding,
  Listing,
  Match,
  Room,
  Terms,
} from "../shared/types";
import { api } from "./api";
import {
  availableWallets,
  connectWallet,
  connectionIsCurrent,
  disconnectWallet,
  signFrozenTransaction,
  signWalletMessage,
  watchWallets,
  watchWalletConnection,
} from "./wallet";
import type { BrowserWallet, WalletConnection } from "./wallet";
import { SigningSpike } from "./SigningSpike";
import { Walkthrough } from "./Walkthrough";
import { PublicReceipt } from "./PublicReceipt";
import { PublicHistory } from "./PublicHistory";
import {
  GettingStarted,
  participantName,
  RoomProgress,
  TestDisclosure,
  type DemoConfiguration,
} from "./DemoGuide";
import { RenewAttempt } from "./RenewAttempt";
import {
  amount,
  AssetMark,
  AssetSelect,
  BasketComposer,
  ConnectPrompt,
  ListingComposer,
  ReceiptView,
  short,
  TermsView,
  type Offer,
} from "./TradeViews";

type Page =
  | "market"
  | "portfolio"
  | "basket"
  | "matches"
  | "rooms"
  | "room"
  | "walkthrough"
  | "spike"
  | "receipt";
type PublicPage = "history";
interface Configuration {
  assets: Asset[];
  cluster: string;
  settlementEnabled: boolean;
  rpcConfigured: boolean;
}
const status = (s: string) => s.toLowerCase().replaceAll("_", " ");
function route() {
  const [page = "market", id = ""] = location.hash
    .replace(/^#\/?/, "")
    .split("/");
  return {
    page: ([
      "market",
      "portfolio",
      "basket",
      "matches",
      "rooms",
      "room",
      "walkthrough",
      "spike",
      "receipt",
      "history",
    ].includes(page)
      ? page
      : "market") as Page | PublicPage,
    id,
  };
}
export function App() {
  const [where, setWhere] = useState(route),
    [config, setConfig] = useState<Configuration>({
      assets: [],
      cluster: "devnet",
      settlementEnabled: false,
      rpcConfigured: false,
    });
  const [wallets, setWallets] = useState<readonly BrowserWallet[]>([]),
    [picker, setPicker] = useState(false),
    [connection, setConnection] = useState<WalletConnection | null>(null),
    [identity, setIdentity] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoConfiguration | null>(null);
  const [listings, setListings] = useState<Listing[]>([]),
    [holdings, setHoldings] = useState<Holding[]>([]),
    [offers, setOffers] = useState<Offer[]>([]),
    [rooms, setRooms] = useState<Room[]>([]),
    [matches, setMatches] = useState<Match[]>([]),
    [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [privateLoading, setPrivateLoading] = useState(false),
    [holdingsError, setHoldingsError] = useState(""),
    [giveFilter, setGiveFilter] = useState(""),
    [wantFilter, setWantFilter] = useState("");
  const [counter, setCounter] = useState<Offer | null>(null),
    [recipient, setRecipient] = useState(""),
    [sourceListing, setSourceListing] = useState<string | null>(null),
    [reviewChecked, setReviewChecked] = useState(false);
  const [accepted, setAccepted] = useState<Record<string, Terms>>(() => {
    try {
      const stored: unknown = JSON.parse(
        sessionStorage.getItem("barterbook-accepted") ?? "{}",
      );
      return stored && typeof stored === "object" && !Array.isArray(stored)
        ? (stored as Record<string, Terms>)
        : {};
    } catch {
      return {};
    }
  });
  const lastActive = useRef(Date.now()),
    lastReconcile = useRef(0),
    polling = useRef(false),
    sessionGeneration = useRef(0),
    operationPending = useRef(false),
    pendingSignOut = useRef<Promise<void>>(Promise.resolve()),
    modalRef = useRef<HTMLElement>(null),
    currentRoute = useRef(where);
  currentRoute.current = where;
  const { page, id } = where;
  const assets = config.assets
    .filter((a) => a.cluster === "devnet" && a.tested)
    .slice(0, 3);
  const owner = identity;
  const walletLabel = connection
    ? identity === connection.account.address
      ? participantName(identity, demo)
      : "Authenticate wallet"
    : identity
      ? `Reconnect ${participantName(identity, demo)}`
      : "Connect wallet";
  function go(page: Page | PublicPage, id = "") {
    location.hash = `/${page}${id ? `/${id}` : ""}`;
  }
  async function run(work: () => Promise<void>) {
    if (operationPending.current) return;
    operationPending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    lastActive.current = Date.now();
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      operationPending.current = false;
      setBusy(false);
    }
  }
  async function loadPublic() {
    const [settings, board] = await Promise.all([
      api<Configuration>("/assets"),
      api<{ listings: Listing[] }>("/listings"),
    ]);
    setConfig(settings);
    setListings(board.listings);
    setLoaded(true);
  }
  async function loadPrivate() {
    const generation = sessionGeneration.current;
    setPrivateLoading(true);
    setHoldingsError("");
    try {
      const [o, r, h] = await Promise.all([
        api<{ offers: Offer[] }>("/offers"),
        api<{ rooms: Room[] }>("/rooms"),
        api<{ holdings: Holding[]; error?: string }>("/holdings").catch(
          (cause) => ({
            holdings: [] as Holding[],
            error: cause.message as string,
          }),
        ),
      ]);
      if (generation !== sessionGeneration.current) return;
      setOffers(o.offers);
      setRooms(r.rooms);
      setHoldings(h.holdings);
      setHoldingsError(h.error ?? "");
    } finally {
      if (generation === sessionGeneration.current) setPrivateLoading(false);
    }
  }
  async function loadRoom(id: string) {
    const generation = sessionGeneration.current;
    const result = await api<{ room: Room }>(
      `/rooms/${encodeURIComponent(id)}`,
    );
    if (
      generation === sessionGeneration.current &&
      currentRoute.current.page === "room" &&
      currentRoute.current.id === id
    )
      setRoom(result.room);
    return result.room;
  }
  useEffect(() => {
    const changed = () => {
        setWhere(route());
        setError("");
        setNotice("");
        setReviewChecked(false);
        document.getElementById("main-content")?.focus();
      },
      active = () => {
        lastActive.current = Date.now();
      };
    window.addEventListener("hashchange", changed);
    window.addEventListener("pointerdown", active);
    window.addEventListener("keydown", active);
    const refresh = () => setWallets(availableWallets());
    refresh();
    const unwatch = watchWallets(refresh);
    void loadPublic().catch((e) => {
      setError(e.message);
      setLoaded(true);
    });
    const generation = sessionGeneration.current;
    void api<{ wallet: string | null }>("/auth/me")
      .then((x) => {
        if (generation === sessionGeneration.current) setIdentity(x.wallet);
      })
      .catch(() => {});
    void api<DemoConfiguration>("/demo")
      .then(setDemo)
      .catch(() => {});
    return () => {
      unwatch();
      window.removeEventListener("hashchange", changed);
      window.removeEventListener("pointerdown", active);
      window.removeEventListener("keydown", active);
    };
  }, []);
  useEffect(() => {
    if (identity) void loadPrivate().catch((e) => setError(e.message));
  }, [identity]);
  useEffect(() => {
    if (page === "room" && id && identity) {
      setRoom(null);
      void loadRoom(id).catch((e) => setError(e.message));
    }
    if (page === "matches")
      void api<{ matches: Match[] }>("/matches")
        .then((r) => setMatches(r.matches))
        .catch((e) => setError(e.message));
    if (page === "rooms" && identity)
      void loadPrivate().catch((e) => setError(e.message));
  }, [page, id, identity]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (
        page !== "room" ||
        !id ||
        !identity ||
        document.visibilityState !== "visible" ||
        Date.now() - lastActive.current > 300000 ||
        polling.current ||
        ["FINALIZED", "EXPIRED_UNLANDED"].includes(room?.attempt?.state ?? "")
      )
        return;
      polling.current = true;
      void (async () => {
        try {
          if (
            room?.attempt &&
            (room.attempt.submissionStartedAt ||
              room.attempt.state === "CONFIRMED") &&
            Date.now() - lastReconcile.current >= 7500
          ) {
            lastReconcile.current = Date.now();
            await api(`/attempts/${room.attempt.id}/reconcile`, {});
          }
          await loadRoom(id);
        } catch {
        } finally {
          polling.current = false;
        }
      })();
    }, 2500);
    return () => clearInterval(timer);
  }, [page, id, identity, room?.attempt]);
  useEffect(() => {
    if (!connection) return;
    return watchWalletConnection(connection, () => {
      clearPrivateState();
      pendingSignOut.current = endServerSession().catch(() => {
        setError(
          "Private data was cleared, but the server session could not be closed. Reconnect to retry ending it.",
        );
      });
      setNotice(
        "Wallet account or network access changed. Private data has been cleared. Reconnect, authenticate and review the terms again. Existing transaction signatures remain valid.",
      );
    });
  }, [connection]);
  useEffect(() => {
    if (!picker) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = modalRef.current;
    const controls = () => [
      ...(dialog?.querySelectorAll<HTMLElement>(
        "button:not([disabled]),a[href],input:not([disabled])",
      ) ?? []),
    ];
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPicker(false);
      if (event.key !== "Tab") return;
      const focusable = controls();
      const first = focusable[0],
        last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      previousFocus?.focus();
    };
  }, [picker]);
  function clearPrivateState() {
    sessionGeneration.current++;
    setIdentity(null);
    setConnection(null);
    setRoom(null);
    setHoldings([]);
    setOffers([]);
    setRooms([]);
    setCounter(null);
    setRecipient("");
    setSourceListing(null);
    setReviewChecked(false);
    setAccepted({});
    setPrivateLoading(false);
    setHoldingsError("");
    try {
      sessionStorage.removeItem("barterbook-accepted");
    } catch {
      /* In-memory consent remains usable when browser storage is disabled. */
    }
  }
  async function endServerSession() {
    try {
      await api("/auth/logout", {});
    } catch (cause) {
      if ((cause as { status?: number }).status !== 401) throw cause;
    }
  }
  async function login(wallet: BrowserWallet) {
    clearPrivateState();
    const generation = sessionGeneration.current;
    await pendingSignOut.current;
    await endServerSession();
    const next = await connectWallet(wallet);
    if (generation !== sessionGeneration.current)
      throw new Error("Wallet connection changed. Connect again.");
    setConnection(next);
    const c = await api<{
      id: string;
      message: string;
      origin: string;
      cluster: string;
      wallet: string;
      expiresAt: number;
    }>("/auth/challenge", { wallet: next.account.address });
    if (
      c.origin !== location.origin ||
      c.cluster !== "devnet" ||
      c.wallet !== next.account.address ||
      c.expiresAt <= Date.now()
    )
      throw new Error(
        "Challenge does not match this origin, devnet network or wallet.",
      );
    const message = `BarterBook wallet authentication\n\nOrigin: ${c.origin}\nWallet: ${c.wallet}\nNetwork: devnet\nNonce: ${c.id}\nExpires: ${new Date(c.expiresAt).toISOString()}\n\nThis signature authenticates board activity only. It does not authorize a token transfer.`;
    if (message !== c.message)
      throw new Error("Authentication challenge contains unexpected text.");
    const signatureBase64 = await signWalletMessage(next, message);
    if (generation !== sessionGeneration.current || !connectionIsCurrent(next))
      throw new Error(
        "Wallet changed during authentication. Please reconnect.",
      );
    const result = await api<{ wallet: string }>("/auth/verify", {
      id: c.id,
      wallet: next.account.address,
      signatureBase64,
    });
    if (
      generation !== sessionGeneration.current ||
      !connectionIsCurrent(next) ||
      result.wallet !== next.account.address
    ) {
      pendingSignOut.current = endServerSession();
      await pendingSignOut.current;
      throw new Error(
        "Wallet changed before authentication finished. The session was ended.",
      );
    }
    setIdentity(result.wallet);
    setPicker(false);
    setNotice("Wallet authenticated. Transfers require separate approvals.");
  }
  function requireWallet() {
    if (connection && !connectionIsCurrent(connection)) {
      clearPrivateState();
      pendingSignOut.current = endServerSession().catch(() => {
        setError(
          "The wallet changed. Private data was cleared; reconnect to check the server session.",
        );
      });
    }
    if (
      !identity ||
      !connection ||
      identity !== connection.account.address ||
      !connectionIsCurrent(connection)
    ) {
      setPicker(true);
      throw new Error(
        "Connect and authenticate your devnet test wallet first.",
      );
    }
    return connection;
  }
  const acceptKey = (r: Room) => `${r.id}:${owner}`;
  async function acceptRoom(r: Room) {
    requireWallet();
    const generation = sessionGeneration.current;
    validateTerms(r.terms, assets);
    const snapshot = structuredClone(r.terms);
    const result = r.attempt
      ? { room: r }
      : await api<{ room: Room }>(`/rooms/${r.id}/accept`, {
          version: snapshot.version,
          termsHash: r.termsHash,
        });
    if (generation !== sessionGeneration.current)
      throw new Error(
        "Wallet changed during review. Review the terms again after authenticating.",
      );
    if (
      r.attempt &&
      (r.members.find((m) => m.wallet === owner)?.acceptedVersion !==
        snapshot.version ||
        canonical(r.attempt.plan.terms) !== canonical(snapshot))
    )
      throw new Error(
        "The frozen transaction does not match your accepted room version.",
      );
    if (canonical(result.room.terms) !== canonical(snapshot))
      throw new Error(
        "Terms changed during acceptance. Review the new version.",
      );
    const next = { ...accepted, [acceptKey(r)]: snapshot };
    setAccepted(next);
    try {
      sessionStorage.setItem("barterbook-accepted", JSON.stringify(next));
    } catch {
      /* A reload will require another explicit browser review. */
    }
    setRoom(result.room);
    setNotice("Exact terms accepted in this browser.");
  }
  async function signRoom(r: Room) {
    const generation = sessionGeneration.current;
    const wallet = requireWallet(),
      attempt = r.attempt,
      terms = accepted[acceptKey(r)];
    if (!attempt || !terms)
      throw new Error("Accept exact terms in this browser before signing.");
    const fresh = await api<{ assets: Asset[] }>("/assets/fresh");
    if (generation !== sessionGeneration.current)
      throw new Error(
        "Wallet changed before signing. Reconnect and review the original room.",
      );
    validateTerms(terms, fresh.assets);
    const wireBase64 = await signFrozenTransaction(
      wallet,
      attempt.wireBase64,
      attempt.plan,
      terms,
    );
    if (generation !== sessionGeneration.current)
      throw new Error(
        "Wallet changed while signing. The original attempt still needs reconciliation; this signature has not been uploaded.",
      );
    await api(`/attempts/${attempt.id}/signatures`, { wireBase64 });
    await loadRoom(r.id);
    setNotice("Signature verified and saved for the frozen message.");
  }
  const filtered = listings.filter(
    (l) =>
      (!giveFilter || l.giveMint === giveFilter) &&
      (!wantFilter || l.wantMint === wantFilter),
  );
  const title =
    page === "portfolio"
      ? "Your inventory, your terms."
      : page === "basket"
        ? counter
          ? "Propose a new version."
          : "Build the whole exchange."
        : page === "matches"
          ? "Find the missing connection."
          : page === "rooms"
            ? "Your exchange rooms."
            : "Find your next position.";
  function newBasket() {
    setCounter(null);
    setRecipient("");
    setSourceListing(null);
    go("basket");
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <a href="#/market" className="brand">
          <span className="brand-icon">⇄</span> BarterBook
        </a>
        <nav aria-label="Primary navigation">
          {[
            ["market", "Market"],
            ["portfolio", "Portfolio"],
            ["matches", "Matches"],
            ["rooms", "Trade rooms"],
            ["history", "Evidence"],
          ].map(([p, label]) => (
            <a
              key={p}
              className={page === p ? "active" : ""}
              aria-current={page === p ? "page" : undefined}
              href={`#/${p}`}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <span className="network-badge">
            <i />
            Devnet
          </span>
          <button className="wallet-button" onClick={() => setPicker(true)}>
            {walletLabel} ↗
          </button>
        </div>
      </header>
      <div className="environment-strip">
        <span>TEST ENVIRONMENT</span> Test assets only. No real PRE holdings or
        mainnet settlement.
      </div>
      <main id="main-content" tabIndex={-1}>
        {error && (
          <div className="global-message" role="alert">
            {error}
            <button className="link-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {notice && (
          <div role="status" className="status-note">
            {notice}
          </div>
        )}
        {busy && !picker && (
          <p className="working-note" role="status">
            Working on your request… If a submission times out, reconcile its
            original status before doing anything else.
          </p>
        )}
        {page === "spike" ? (
          <SigningSpike />
        ) : page === "walkthrough" ? (
          <Walkthrough />
        ) : page === "receipt" ? (
          <PublicReceipt txid={id} assets={assets} />
        ) : page === "history" ? (
          <PublicHistory />
        ) : page === "room" ? (
          <>
            <a href="#/rooms" className="back-link">
              ← Trade rooms
            </a>
            {!identity ? (
              <ConnectPrompt onConnect={() => setPicker(true)} />
            ) : !room || room.id !== id ? (
              <p>Loading the private room…</p>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <p className="eyebrow">Shared room · devnet</p>
                    <h1>
                      {room.terms.mode === "RING"
                        ? "Three holders. One exchange."
                        : "One package. One transaction."}
                    </h1>
                    <p className="subhead">
                      Review every transfer before approving your part.
                    </p>
                  </div>
                  <span className="pill">
                    {status(room.attempt?.state ?? room.state)}
                  </span>
                </div>
                <RoomProgress room={room} />
                <p className="online-note">
                  Keep every participant online for this signing window.
                  Accepting terms records agreement; only a wallet transaction
                  signature can authorize a transfer.
                </p>
                <div className="room-layout">
                  <div>
                    <div className="card">
                      <TermsView terms={room.terms} assets={assets} />
                    </div>
                    <div className="card room-actions">
                      <h2>Review, then sign</h2>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={reviewChecked}
                          onChange={(e) => setReviewChecked(e.target.checked)}
                        />
                        I reviewed every transfer, minimum receipt, account and
                        fee cap in version {room.terms.version}.
                      </label>
                      <div className="actions">
                        <button
                          disabled={busy || !reviewChecked}
                          onClick={() => void run(() => acceptRoom(room))}
                        >
                          {room.attempt
                            ? "Confirm this browser’s review"
                            : "Accept exact terms"}
                        </button>
                        <button
                          className="secondary"
                          disabled={
                            busy ||
                            !accepted[acceptKey(room)] ||
                            canonical(accepted[acceptKey(room)]) !==
                              canonical(room.terms) ||
                            !!room.attempt
                          }
                          onClick={() =>
                            void run(async () => {
                              requireWallet();
                              const r = await api<{ room: Room }>(
                                `/rooms/${room.id}/ready`,
                                { version: room.terms.version, ready: true },
                              );
                              setRoom(r.room);
                            })
                          }
                        >
                          I’m ready
                        </button>
                        {!room.attempt && (
                          <button
                            className="secondary"
                            disabled={
                              busy ||
                              !config.settlementEnabled ||
                              !room.members.every((m) => m.ready)
                            }
                            onClick={() =>
                              void run(async () => {
                                requireWallet();
                                await api(`/rooms/${room.id}/attempts`, {
                                  version: room.terms.version,
                                  termsHash: room.termsHash,
                                });
                                await loadRoom(room.id);
                              })
                            }
                          >
                            Prepare one transaction
                          </button>
                        )}
                      </div>
                      <p className="approval-help">
                        Accepting or marking ready does not move tokens. “Verify
                        and sign in wallet” is the separate transaction
                        authorization step. Submit only after every participant
                        has signed.
                      </p>
                      {!config.settlementEnabled && (
                        <p className="muted">
                          Settlement is disabled until server RPC and devnet
                          validation gates are configured.
                        </p>
                      )}
                      {room.attempt && (
                        <div className="attempt-box">
                          <p className="eyebrow">
                            Frozen attempt {short(room.attempt.id)}
                          </p>
                          <p>
                            Message hash <code>{room.attempt.messageHash}</code>
                          </p>
                          <p>
                            Last valid block height:{" "}
                            {room.attempt.plan.lastValidBlockHeight}. Network
                            fee:{" "}
                            {formatAmount(
                              room.attempt.plan.networkFeeLamports,
                              9,
                            )}{" "}
                            SOL. Maximum account funding allowance:{" "}
                            {formatAmount(
                              room.attempt.plan.accountRentLamports,
                              9,
                            )}{" "}
                            SOL.
                          </p>
                          <div className="actions">
                            <button
                              disabled={
                                busy ||
                                room.attempt.state !== "SIGNING" ||
                                room.attempt.stopRequested ||
                                !reviewChecked ||
                                !!room.attempt.signatures[owner ?? ""] ||
                                (!room.attempt.signatures[
                                  room.terms.feePayer
                                ] &&
                                  owner !== room.terms.feePayer)
                              }
                              onClick={() => void run(() => signRoom(room))}
                            >
                              Verify and sign in wallet
                            </button>
                            <button
                              disabled={
                                busy ||
                                ![
                                  "FULLY_SIGNED",
                                  "SUBMISSION_STARTED",
                                  "SUBMITTED",
                                  "STATUS_UNKNOWN",
                                ].includes(room.attempt.state) ||
                                !room.attempt.fullWireBase64
                              }
                              onClick={() =>
                                void run(async () => {
                                  requireWallet();
                                  await api(
                                    `/attempts/${room.attempt!.id}/submit`,
                                    {},
                                  );
                                  await loadRoom(room.id);
                                })
                              }
                            >
                              {room.attempt.submissionStartedAt
                                ? "Check original submission"
                                : "Submit signed exchange"}
                            </button>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void run(async () => {
                                  await api(
                                    `/attempts/${room.attempt!.id}/reconcile`,
                                    {},
                                  );
                                  await loadRoom(room.id);
                                })
                              }
                            >
                              Reconcile original status
                            </button>
                            <button
                              className="link-button"
                              disabled={
                                busy ||
                                room.attempt.stopRequested ||
                                ["FINALIZED", "EXPIRED_UNLANDED"].includes(
                                  room.attempt.state,
                                )
                              }
                              onClick={() =>
                                void run(async () => {
                                  await api(
                                    `/attempts/${room.attempt!.id}/stop`,
                                    {},
                                  );
                                  await loadRoom(room.id);
                                })
                              }
                            >
                              Stop collecting signatures
                            </button>
                          </div>
                          {!room.attempt.signatures[room.terms.feePayer] && (
                            <p className="muted">
                              The designated fee payer signs first so the
                              original transaction identifier can be tracked.
                            </p>
                          )}
                          <p className="recovery-note">
                            Stopping or closing this page cannot revoke
                            signatures. A timeout keeps the original attempt
                            unresolved. A replacement requires authoritative
                            reconciliation and new terms acceptance.
                          </p>
                          {room.attempt.error && (
                            <p role="alert">{room.attempt.error}</p>
                          )}
                          {room.attempt.txid && (
                            <a
                              href={`https://explorer.solana.com/tx/${room.attempt.txid}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Inspect original transaction ↗
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    <RenewAttempt
                      room={room}
                      assets={assets}
                      onRenewed={(next) => {
                        setRoom(next);
                        setReviewChecked(false);
                        void loadPrivate();
                      }}
                    />
                    {room.attempt?.receipt && (
                      <>
                        <ReceiptView
                          receipt={room.attempt.receipt}
                          assets={assets}
                        />
                        <p>
                          <a href={`#/receipt/${room.attempt.receipt.txid}`}>
                            Open shareable receipt for judges ↗
                          </a>
                        </p>
                      </>
                    )}
                  </div>
                  <aside>
                    <div className="card">
                      <p className="eyebrow">Participants</p>
                      {room.members.map((m, i) => (
                        <div className="member" key={m.wallet}>
                          <span className="avatar">{i + 1}</span>
                          <div>
                            <strong title={m.wallet}>
                              {participantName(m.wallet, demo)}{" "}
                              {m.wallet === owner ? "(you)" : ""}
                            </strong>
                            <small>
                              {room.attempt?.signatures[m.wallet]
                                ? "Signature verified"
                                : m.ready
                                  ? "Ready to sign"
                                  : m.acceptedVersion === room.terms.version
                                    ? "Terms accepted"
                                    : "Reviewing terms"}
                            </small>
                          </div>
                        </div>
                      ))}
                      <label>
                        Private room link
                        <input
                          readOnly
                          value={`${location.origin}/#/room/${room.id}`}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                    </div>
                    <div className="card muted">
                      <h3>All or nothing</h3>
                      <p>
                        All token legs execute in one Solana transaction. No
                        custody wallet or custom settlement program.
                      </p>
                      <p>Failed execution may still incur a network fee.</p>
                    </div>
                  </aside>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="page-heading">
              <div>
                <p className="eyebrow">Peer-to-peer portfolio exchange</p>
                <h1>{title}</h1>
                <p className="subhead">
                  {page === "market"
                    ? "Discover selected inventory. Make an exact offer. Settle together."
                    : page === "portfolio"
                      ? "Advertise only the supported assets you choose to exchange."
                      : page === "basket"
                        ? "Agree on exact quantities and fee-adjusted receipts with one other holder."
                        : page === "matches"
                          ? "Direct pairs and three-owner cycles that satisfy every minimum."
                          : "Accepted terms, wallet signatures and original transaction recovery."}
                </p>
              </div>
              <div className="actions">
                <button className="secondary" onClick={() => go("walkthrough")}>
                  Judge walkthrough ↗
                </button>
                {page !== "basket" && (
                  <button onClick={newBasket}>＋ Make a basket offer</button>
                )}
              </div>
            </div>
            <TestDisclosure />
            {page === "market" && (
              <>
                <section className="overview-grid">
                  <div>
                    <span className="metric-label">Open listings</span>
                    <strong>{String(listings.length).padStart(2, "0")}</strong>
                    <span>Selected inventory, exact lots</span>
                  </div>
                  <div>
                    <span className="metric-label">Validated test assets</span>
                    <strong>
                      {String(assets.length).padStart(2, "0")}{" "}
                      <small>/ 03</small>
                    </strong>
                    <span>Network-specific compatibility</span>
                  </div>
                  <div>
                    <span className="metric-label">In your custody</span>
                    <strong>Always</strong>
                    <span>Your wallet approves every exchange</span>
                  </div>
                </section>
                <GettingStarted
                  demo={demo}
                  connected={Boolean(identity)}
                  onConnect={() => setPicker(true)}
                />
                <div className="market-layout">
                  <section>
                    <div className="section-heading">
                      <h2>
                        Offer board{" "}
                        <span className="count">{filtered.length}</span>
                      </h2>
                      <button
                        className="link-button"
                        disabled={busy}
                        onClick={() => void run(loadPublic)}
                      >
                        Refresh ↻
                      </button>
                    </div>
                    <div className="filter-bar">
                      <AssetSelect
                        assets={assets}
                        value={giveFilter}
                        onChange={setGiveFilter}
                        label="Offered asset"
                        empty="All offered assets"
                      />
                      <span>⇄</span>
                      <AssetSelect
                        assets={assets}
                        value={wantFilter}
                        onChange={setWantFilter}
                        label="Wanted asset"
                        empty="All wanted assets"
                      />
                    </div>
                    <div className="listing-table table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Offered · gross</th>
                            <th>Wanted · minimum net</th>
                            <th>Holder / balance check</th>
                            <th>Expires</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((l) => {
                            const a = assets.find((a) => a.mint === l.giveMint),
                              b = assets.find((a) => a.mint === l.wantMint);
                            return (
                              <tr key={l.id}>
                                <td>
                                  <div className="asset-cell">
                                    <AssetMark
                                      symbol={a?.symbol ?? "?"}
                                      index={assets.indexOf(a!)}
                                    />
                                    <div>
                                      <strong>{amount(l.grossRaw, a)}</strong>
                                      <small>
                                        {a?.symbol ?? short(l.giveMint)}
                                      </small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <strong>
                                    {amount(l.minReceiveNetRaw, b)}
                                  </strong>
                                  <small>
                                    {b?.symbol ?? short(l.wantMint)}
                                  </small>
                                </td>
                                <td title={l.owner}>
                                  {participantName(l.owner, demo)}
                                  <small>
                                    {l.balanceCheckedAt
                                      ? new Date(
                                          l.balanceCheckedAt,
                                        ).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })
                                      : "Snapshot unavailable"}
                                  </small>
                                </td>
                                <td>
                                  {new Date(l.expiresAt).toLocaleTimeString(
                                    [],
                                    { hour: "2-digit", minute: "2-digit" },
                                  )}
                                  <small>
                                    {l.locked ? "Active attempt" : "Open"}
                                  </small>
                                </td>
                                <td>
                                  <button
                                    className="secondary small"
                                    disabled={l.locked || l.owner === owner}
                                    onClick={() => {
                                      setRecipient(l.owner);
                                      setSourceListing(l.id);
                                      setCounter(null);
                                      go("basket");
                                    }}
                                  >
                                    Offer →
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!filtered.length && (
                        <div className="empty-state">
                          <span className="outline-icon">⇄</span>
                          <h3>
                            {loaded
                              ? "A fresh market, ready for your first lot."
                              : "Loading the offer board…"}
                          </h3>
                          <p>
                            {assets.length
                              ? "Connect your test wallet to advertise selected inventory, or explore the example exchange."
                              : "Configure the three validated devnet fixture mints and server RPC to open the live market. Explore the no-wallet walkthrough now."}
                          </p>
                          <button
                            className="secondary"
                            onClick={() => go("walkthrough")}
                          >
                            Explore an example →
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                  <aside>
                    <div className="discovery-card">
                      <span className="mini-cycle">
                        ↗<span>⇄</span>↙
                      </span>
                      <p className="eyebrow">Beyond a direct match</p>
                      <h2>Your match might need three.</h2>
                      <p>
                        Connect three exact lots so every holder gets what they
                        asked for.
                      </p>
                      <a href="#/walkthrough">See how it works ↗</a>
                    </div>
                    <div className="market-notes">
                      <p>
                        <span>01</span> Set your lot and minimum net.
                      </p>
                      <p>
                        <span>02</span> Review fees and every participant.
                      </p>
                      <p>
                        <span>03</span> Sign one atomic transaction.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {page === "portfolio" &&
              (!identity ? (
                <ConnectPrompt onConnect={() => setPicker(true)} />
              ) : (
                <div className="portfolio-layout">
                  <section>
                    <div className="section-heading">
                      <h2>Supported source accounts</h2>
                      <button
                        className="link-button"
                        disabled={busy || privateLoading}
                        onClick={() => void run(loadPrivate)}
                      >
                        Refresh holdings ↻
                      </button>
                    </div>
                    <p className="muted">
                      One verified source ATA per asset. Balances are snapshots,
                      not reservations.
                    </p>
                    <div className="holding-grid">
                      {holdings.map((h, i) => (
                        <div className="card holding-card" key={h.account}>
                          <AssetMark symbol={h.asset.symbol} index={i} />
                          <p>
                            {h.asset.symbol}{" "}
                            <span className="pill">Test asset</span>
                          </p>
                          <h2>{amount(h.amountRaw, h.asset)}</h2>
                          <p className="muted">
                            {h.supported
                              ? "Available from supported ATA"
                              : (h.reason ?? "Unsupported account")}
                          </p>
                          <small>
                            Checked {new Date(h.checkedAt).toLocaleTimeString()}
                          </small>
                          <details>
                            <summary>Account</summary>
                            <code>{h.account}</code>
                          </details>
                        </div>
                      ))}
                    </div>
                    {privateLoading && (
                      <p className="status-note" role="status">
                        Loading your supported test balances and private
                        activity…
                      </p>
                    )}
                    {holdingsError && (
                      <p role="alert">
                        Balances could not be checked: {holdingsError}. No
                        available balance is being inferred.
                      </p>
                    )}
                    {!holdings.length && !privateLoading && !holdingsError && (
                      <div className="card empty-state">
                        <h3>No supported holdings loaded</h3>
                        <p>
                          Use authorized disposable wallets funded only from a
                          faucet and configured, validated test mints.
                        </p>
                      </div>
                    )}
                    <h2>Your active listings</h2>
                    {listings
                      .filter((l) => l.owner === identity)
                      .map((l) => (
                        <div className="card compact-row" key={l.id}>
                          <div>
                            <strong>
                              {amount(
                                l.grossRaw,
                                assets.find((a) => a.mint === l.giveMint),
                              )}{" "}
                              {
                                assets.find((a) => a.mint === l.giveMint)
                                  ?.symbol
                              }
                            </strong>
                            <p>
                              For at least{" "}
                              {amount(
                                l.minReceiveNetRaw,
                                assets.find((a) => a.mint === l.wantMint),
                              )}{" "}
                              {
                                assets.find((a) => a.mint === l.wantMint)
                                  ?.symbol
                              }{" "}
                              net
                            </p>
                          </div>
                          <button
                            className="secondary"
                            disabled={busy || l.locked}
                            onClick={() =>
                              void run(async () => {
                                requireWallet();
                                await api(`/listings/${l.id}/withdraw`, {
                                  version: l.version,
                                });
                                await loadPublic();
                              })
                            }
                          >
                            Withdraw
                          </button>
                        </div>
                      ))}
                  </section>
                  <ListingComposer
                    assets={assets}
                    busy={busy}
                    onCreate={(data) =>
                      void run(async () => {
                        requireWallet();
                        await api("/listings", data, crypto.randomUUID());
                        await loadPublic();
                        setNotice("Your exact lot is on the offer board.");
                      })
                    }
                  />
                </div>
              ))}
            {page === "basket" && (
              <BasketComposer
                assets={assets}
                owner={owner ?? ""}
                recipient={recipient}
                counter={counter}
                busy={busy}
                onConnect={() => setPicker(true)}
                onCreate={(terms) =>
                  void run(async () => {
                    requireWallet();
                    const result = counter
                      ? await api<{ room: Room }>(
                          `/offers/${counter.id}/counter`,
                          { expectedVersion: counter.version, terms },
                        )
                      : await api<{ room: Room }>(
                          "/offers",
                          {
                            terms,
                            listingIds: sourceListing ? [sourceListing] : [],
                          },
                          crypto.randomUUID(),
                        );
                    setRoom(result.room);
                    setCounter(null);
                    await loadPrivate();
                    go("room", result.room.id);
                  })
                }
              />
            )}
            {page === "matches" && (
              <>
                <div className="section-heading">
                  <h2>Exact-lot candidates</h2>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await api<{ matches: Match[] }>("/matches");
                        setMatches(r.matches);
                      })
                    }
                  >
                    Find current matches ↻
                  </button>
                </div>
                <p className="muted">
                  Bounded search, exact whole lots, current fees and every
                  recipient’s minimum net. No partial fills or arbitrary basket
                  optimizer.
                </p>
                <div className="match-grid">
                  {matches.map((m) => (
                    <div className="card" key={m.id}>
                      <span className="pill">
                        {m.mode === "RING" ? "Three-way cycle" : "Direct pair"}
                      </span>
                      <h2>{m.listings.length} compatible holders</h2>
                      {m.legs.map((l, i) => (
                        <div className="match-leg" key={i}>
                          <span>
                            {short(l.fromOwner)} → {short(l.toOwner)}
                          </span>
                          <strong>
                            {amount(
                              l.netRaw,
                              assets.find((a) => a.mint === l.mint),
                            )}{" "}
                            {assets.find((a) => a.mint === l.mint)?.symbol} net
                          </strong>
                        </div>
                      ))}
                      <button
                        disabled={
                          busy ||
                          !owner ||
                          !m.listings.some((l) => l.owner === owner)
                        }
                        onClick={() =>
                          void run(async () => {
                            const wallet = requireWallet();
                            const r = await api<{ room: Room }>(
                              "/matches/room",
                              {
                                listingIds: m.listings.map((l) => l.id),
                                feePayer: wallet.account.address,
                                maxNetworkFeeLamports: "100000",
                                maxAccountRentLamports: "30000000",
                              },
                            );
                            setRoom(r.room);
                            go("room", r.room.id);
                          })
                        }
                      >
                        Review in shared room →
                      </button>
                      <p className="muted">
                        Review every leg before accepting. Opening a room grants
                        no spend authorization.
                      </p>
                    </div>
                  ))}
                </div>
                {!matches.length && (
                  <div className="card empty-state">
                    <h3>No compatible exact lots in this search</h3>
                    <p>
                      Publish a listing or inspect a labeled three-way example.
                    </p>
                    <button
                      className="secondary"
                      onClick={() => go("walkthrough")}
                    >
                      See an example cycle →
                    </button>
                  </div>
                )}
              </>
            )}
            {page === "rooms" &&
              (!identity ? (
                <ConnectPrompt onConnect={() => setPicker(true)} />
              ) : (
                <>
                  <div className="room-list">
                    {rooms.map((r) => (
                      <button
                        className="card room-list-card"
                        key={r.id}
                        onClick={() => {
                          setRoom(r);
                          go("room", r.id);
                        }}
                      >
                        <span className="room-glyph">
                          {r.terms.mode === "RING" ? "△" : "⇄"}
                        </span>
                        <div>
                          <h3>
                            {r.terms.mode === "RING"
                              ? "Three-way exchange"
                              : "Basket offer"}{" "}
                            · version {r.terms.version}
                          </h3>
                          <p>
                            {r.terms.legs.length} transfers ·{" "}
                            {r.terms.owners.length} participants
                          </p>
                        </div>
                        <span className="pill">
                          {status(r.attempt?.state ?? r.state)}
                        </span>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                  {privateLoading && (
                    <p className="status-note" role="status">
                      Loading your private trade rooms…
                    </p>
                  )}
                  {!rooms.length && !privateLoading && (
                    <div className="card empty-state">
                      <h3>Your next exchange starts with an offer</h3>
                      <p>
                        Compose a two-for-one basket or open a matching
                        exact-lot cycle.
                      </p>
                      <button onClick={newBasket}>Create a basket offer</button>
                    </div>
                  )}
                  <h2>Proposal activity</h2>
                  {offers.map((o) => (
                    <div className="card compact-row" key={o.id}>
                      <div>
                        <strong>
                          Version {o.version} ·{" "}
                          {o.proposer === identity ? "Sent" : "Received"}
                        </strong>
                        <p>
                          {short(o.proposer)} → {short(o.recipient)} ·{" "}
                          {status(o.status)}
                        </p>
                      </div>
                      <div className="actions">
                        <button
                          className="secondary"
                          onClick={() => go("room", o.roomId)}
                        >
                          Review room
                        </button>
                        {["OPEN", "ACCEPTED"].includes(o.status) &&
                          !rooms.find((r) => r.id === o.roomId)?.attempt && (
                            <>
                              <button
                                className="secondary"
                                onClick={() => {
                                  setCounter(o);
                                  setRecipient(
                                    o.terms.owners.find(
                                      (x) => x !== identity,
                                    ) ?? "",
                                  );
                                  go("basket");
                                }}
                              >
                                Counteroffer
                              </button>
                              <button
                                className="link-button"
                                disabled={busy}
                                onClick={() =>
                                  void run(async () => {
                                    requireWallet();
                                    await api(`/offers/${o.id}/reject`, {
                                      version: o.version,
                                    });
                                    await loadPrivate();
                                  })
                                }
                              >
                                Reject
                              </button>
                            </>
                          )}
                      </div>
                    </div>
                  ))}
                </>
              ))}
          </>
        )}
      </main>
      <footer>
        <span>
          BarterBook <b>·</b> Your inventory. Shared terms. One transaction.
        </span>
        <div>
          <a href="#/walkthrough">Judge walkthrough</a>
          <a href="#/history">Evidence & receipts</a>
          <a href="#/spike">Wallet signing test</a>
          <a href="/legal/LICENSE">Apache-2.0</a>
          <a href="/legal/NOTICE">Notices</a>
          <a href="/legal/third-party-licenses.txt">
            Third-party & LGPL licenses
          </a>
          <span>Devnet MVP</span>
        </div>
      </footer>
      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(false)}>
          <section
            className="card wallet-modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              aria-label="Close wallet chooser"
              className="modal-close secondary"
              onClick={() => setPicker(false)}
            >
              ×
            </button>
            <p className="eyebrow">Devnet test wallets</p>
            <h2 id="wallet-title">Connect your wallet</h2>
            <p>
              Use an authorized disposable wallet. Authentication signs a
              message. Transfers require separate approvals.
            </p>
            {connection && (
              <p className="status-note">
                {identity === connection.account.address
                  ? "Authenticated account"
                  : "Connected, authentication incomplete"}
                : <code>{connection.account.address}</code>
              </p>
            )}
            {wallets.map((w, i) => (
              <button
                className="wallet-option secondary"
                key={`${w.name}-${i}`}
                disabled={busy}
                onClick={() => void run(() => login(w))}
              >
                {w.name} →
              </button>
            ))}
            {!wallets.length && (
              <div className="status-note">
                No compatible browser wallet detected. Open the app in a browser
                with a Wallet Standard wallet supporting devnet message signing
                and transaction signing without broadcast.
              </div>
            )}
            {(identity || connection) && (
              <button
                className="link-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const previous = connection;
                    clearPrivateState();
                    setPicker(false);
                    const results = await Promise.allSettled([
                      endServerSession(),
                      previous ? disconnectWallet(previous) : Promise.resolve(),
                    ]);
                    if (results.some((result) => result.status === "rejected"))
                      throw new Error(
                        "Private data was cleared. A wallet or server disconnect could not finish; reconnect to check the session. Existing transaction signatures have not been revoked.",
                      );
                    setNotice(
                      "Wallet disconnected and board session ended. Any previously signed transaction remains subject to its original lifetime and reconciliation.",
                    );
                  })
                }
              >
                Disconnect and end session
              </button>
            )}
            <p className="muted">
              No wallet?{" "}
              <a href="#/walkthrough" onClick={() => setPicker(false)}>
                Explore the judge walkthrough.
              </a>
            </p>
            {busy && <p role="status">Waiting for your wallet…</p>}
            {error && <p role="alert">{error}</p>}
          </section>
        </div>
      )}
    </>
  );
}
