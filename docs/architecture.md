# Architecture and safety boundaries

BarterBook is one application: a selected-inventory board, negotiated two-owner baskets, and three-owner exact-lot discovery share a single terms model and settlement path. This document describes the implemented local prototype; it does not assert funded chain execution or production readiness.

## Components

| Component | Implementation | Responsibility |
|---|---|---|
| Browser | React, Vite, TypeScript, Wallet Standard | Review terms, authenticate with wallet, independently verify and partially sign the frozen message. |
| Shared engine | `src/shared/` | Integer amounts/fees, canonical terms, bounded matching, transaction construction/verification, recovery policy and receipt reconciliation. |
| Coordinator | Hono in `src/server/` | Authorized board mutations, durable rooms/attempts, live RPC validation, exact-byte submission and original-status reconciliation. |
| Persistence | Cloudflare D1, plain prepared SQL | Sessions, listings, immutable revisions, member consent, attempts, signature audit rows, allocation locks and events. |
| Chain access | Server-only JSON-RPC adapter | Raw mint/account reads, simulation, lifetime/fee queries, broadcasts, history and transaction metadata. |
| Hosting | One Cloudflare Worker with static assets | Same origin for app and API; Worker-first routing only for `/api/*`. |

The runtime SDK pair is pinned: `@solana/web3.js` 1.99.0 with `@solana/spl-token` 0.4.15. Legacy transactions are the only settlement format. There are no address lookup tables, durable nonces, platform-fee transfers, custom programs, delegated orders, or server signing authorities.

## Asset and amount policy

A deployment has one cluster. The current chain adapter accepts only a devnet registry of at most three records that explicitly have `mock: true` and `tested: true`. It independently checks the RPC genesis hash before settlement. Mainnet is rejected even if a deployment flag is accidentally enabled.

The registry is server-owned JSON, with exact mint, token program, decimals, expected extension set, active/next transfer-fee schedules, observed epoch/slot, and compatibility status. Every boundary refresh decodes raw account bytes. It rejects changed mint identity, decimals, untested extensions, pause state, active transfer hooks, non-unit or pending non-unit UI multipliers, incompatible account state, unexpected delegates/close authority and required incoming memos.

Token quantities, fee caps, lamport amounts and lifetimes are canonical decimal strings in JSON and D1 `TEXT`; financial calculations use `BigInt`. Display decimal parsing rejects excess precision and never rounds an accepted amount. RPC integer fields represented as JavaScript numbers must be safe integers or are rejected.

The fee schedule is selected using the current epoch. For gross raw amount `g`, basis points `b`, and maximum fee `c`:

```text
fee = min(c, (g × b + 9,999) / 10,000)  [integer division]
net = gross − fee
```

Fee-bearing Token-2022 legs use `TransferCheckedWithFee`, including when the scheduled fee is zero. Fee-free compatible assets use `TransferChecked` with their correct token program. A changed checked fee fails instead of silently changing net consent.

Every `TransferLeg` specifies sender, recipient, mint/program, source ATA, receiving ATA, decimals, gross debit, expected issuer fee and net receipt. Every distinct incoming owner/mint has an explicit accepted minimum. Initial source inventory is one verified ATA per owner/mint; balances in other token accounts are not combined into an apparently spendable source balance.

Two-owner baskets reject the same mint moving in opposite directions. Repeated directed legs must be consolidated and repriced before acceptance; they are not silently netted after consent. The generic builder caps transfers at five, while this release's three-asset registry prevents a five-distinct-asset product claim.

## Discovery and negotiations

An automatic listing offers one mint in a fixed gross quantity and wants a minimum net quantity of one different mint. Matching filters cluster, asset compatibility, status, expiry, available source inventory, owner distinctness and app allocation locks.

An edge from one listing to another exists only when the sender's offered mint is the recipient's requested mint and the actual fee-adjusted net amount satisfies that recipient's minimum. A three-owner cycle has three distinct offered mints, exactly one outgoing and one incoming whole lot per owner, and satisfies all three minima. It does not divide a lot, change an offered quantity, route a surplus elsewhere, or optimize arbitrary baskets. Candidate search is bounded to a recent set of at most 50 listings, at most 625 candidate pairs, and a bounded returned result set.

A basket proposal contains complete bilateral terms and a designated participant fee payer. Counteroffers insert a new immutable room revision and invalidate every previous acceptance/readiness value. Participants remain fixed for that room. Database guards reject a raced revision or a revision after an unresolved/successful attempt has been frozen. Source listing references retain their captured versions for preparation checks.

The fee payer accepts separate maximum network-fee and receiving-account-rent amounts. Actual network fees are queried for the frozen message; Token-2022 account funding uses extension-aware account sizes and current rent queries. Issuer token fees remain separate from those SOL costs.

## Authentication, privacy and mutations

Authentication signs a readable challenge bound to the exact origin, wallet, network, nonce and five-minute expiry. It authorizes board activity only. Native Web Crypto verifies Ed25519. A D1 trigger atomically checks and consumes the nonce when its session is inserted; a parallel replay cannot create a second session.

The session is a random opaque token, stored only as a hash and delivered in a one-hour `__Host-bb_session` cookie with Secure, HttpOnly, SameSite=Strict and root path. Every mutation checks exact `Origin`, rejects cross-site fetch context, requires JSON, and has a bounded body size. Posting/auth/settlement endpoints apply bounded rate limits. Database queries use prepared parameters.

Private rooms, offers and attempts require participant membership before their terms or signed bytes are returned. Public listings expose selected inventory. Public receipt lookup exposes only a verified transaction receipt, not room signatures or private proposal history. Responses avoid leaking provider URLs, SQL internals, secrets or request bodies.

Creation requests for listings and bilateral offers support an `Idempotency-Key`; reusing a key with different terms is rejected. Consent, readiness, withdrawal, signature collection and submission use existing record identity plus optimistic state/version checks. Source listing and room consent constraints are rechecked within the preparation transaction.

## Durable D1 boundaries

`migrations/0001_initial.sql` creates the data model. `0002_guard_hardening.sql` reapplies the current guards without deleting records. Later migrations add the public asset cache and durable provider-request slots. Tests apply every checked-in migration to real SQLite, with a D1-compatible batch shim that rolls back the whole batch on constraint failure.

| Constraint | Effect |
|---|---|
| One-use challenge/session relation | Parallel auth verification cannot reuse a nonce. |
| Immutable room revisions and current-version trigger | A stale counteroffer or acceptance cannot become the active terms. |
| Current listing references | Withdrawal, expiry or a version change before preparation prevents freezing an attempt. |
| Attempt preparation guard | All participants must have accepted the current version and be ready; terms must be unexpired and room accepted/ready. |
| Unique wallet/listing lock keys | All allocations are acquired in one batch or none are acquired. |
| One unresolved/successful attempt per room | A timeout, cancel, or competing tab cannot create another executable attempt. |
| No second attempt for the same terms hash | A safe terminal failure/expiry still requires a new revision and fresh consent. |
| Immutable attempt fields | Message bytes/hash, plan/lifetime, assigned transaction identity and full signed bytes cannot change. |
| Submission-state requirements | Broadcast-related states require durable full bytes, identifier and submission-started time. |
| Payload compare-and-swap | Parallel signatures or submits cannot overwrite newer attempt state. |
| Unsafe-unlock guard | Locks cannot be removed until finalized success or explicitly reconciled safe failure/expiry. |
| Atomic terminal allocation cleanup | Persisting final success consumes source listings and releases locks in the same transaction; persisting safe failure/expiry releases its locks. |
| Transactional room-state mirror | A slower write cannot regress the room's displayed state behind its attempt. |

These are application reservations only. They do not lock tokens onchain or prevent participants using their wallets elsewhere. Fresh account checks, exact signed simulation and atomic token-program execution remain necessary.

## Signing and submission

1. Every owner accepts the same terms hash/version and indicates readiness.
2. The coordinator rechecks mint/account state, balances, fees, network, costs and expiry; simulates the candidate; chooses bounded compute settings; obtains a fresh recent blockhash and actual last-valid block height.
3. One D1 batch freezes the attempt and acquires all wallet/listing locks. Preparation fails atomically if consent, a source listing or another allocation has changed.
4. Before asking a wallet to sign, the browser reconstructs the expected legacy message from independently accepted terms and the plan. Exact message equality checks instruction order/data, all accounts and privileges, signer set, fee payer, programs, amounts, fees, ATAs, compute settings and lifetime.
5. Only bounded compute-budget instructions, the exact idempotent receiving-ATA creations and accepted checked transfers are allowed. Extra SOL/token transfers, delegates, closes, authority changes, arbitrary memos, unknown programs, unexpected signers/accounts and altered fees are rejected.
6. Each wallet signs without broadcasting. The server independently verifies the uploaded message and signature, merges only that owner's signature slot, and preserves all existing signatures. The message never changes during merging.
7. As soon as the fee payer's signature is known, the coordinator derives the transaction identifier locally. When complete, it persists the full signed bytes. Before any broadcast it atomically writes `SUBMISSION_STARTED` with the identifier, full bytes, lifetime and marker.
8. The exact full bytes are signature-verified, simulated without blockhash replacement, and sent. RPC acceptance is not confirmation. Receipt verification uses the original transaction's metadata.

Changing a quantity, payer, fee, account, compute setting, or blockhash requires a new message and every owner's signature again. No service can move tokens using a wallet-authentication signature or a room's readiness flag.

## Recovery and cancellation

Typical states are:

```text
SIGNING → FULLY_SIGNED → SUBMISSION_STARTED → SUBMITTED
       → STATUS_UNKNOWN → CONFIRMED → FINALIZED
       → FAILED_ONCHAIN or EXPIRED_UNLANDED after reconciliation
```

Healthy polling during a still-valid signing lifetime preserves `SIGNING`/`FULLY_SIGNED`; it does not disable collection merely because the transaction has not landed. Once submission may have occurred, transport errors, preflight errors and null cache status are never treated as proof of failure.

Stopping only stops signature collection. It cannot revoke an already issued signature or release the attempt immediately, even if no signature was uploaded: a wallet may have signed offline after downloading the unsigned message. Reopening the room resumes the original stored attempt.

Reconciliation queries history-aware signature status and original transaction metadata, with finalized block height and blockhash validity. Every endpoint must pass the devnet genesis check; authoritative absence also requires its earliest retained block to cover the frozen context slot. Successful original execution takes priority over an expiry assumption. A replacement is allowed only after finalized onchain failure, or expiry beyond the recorded lifetime plus authoritative absence from two independently configured, healthy, trusted RPC hosts. Conflicting or unavailable history retains `STATUS_UNKNOWN` and locks.

**No-identifier limitation:** if the fee payer never uploads its signature, the server cannot derive the identifier of a transaction that might have been completed outside the application. Such an expired attempt stays locked rather than guessing that it never landed. The UI asks the fee payer to sign first to reduce this case. A general payer-history recovery/import workflow is not implemented; deleting records or switching blockhashes is not a safe workaround.

Once a safe failure/expiry is established, `POST /rooms/:id/renew` accepts a complete, freshly validated next terms revision for the same participants and mode. It also cleans up any reconciled residual locks left by a crash. Every participant must accept and indicate readiness again; quantities and fees are never silently changed. A previous successful room cannot be executed again. Rebroadcasting, when permitted, sends only the identical signed bytes and therefore retains the original identifier.

## Receipts

Every encoded receiving-ATA creation reserves its full possible funding cost, including ATAs that currently exist: their owners could close an empty account before execution. Browser and server independently require the accepted rent cap to cover this allowance. The shared devnet policy uses the conservative `(account bytes + 128) × 6,960` lamport bound, including required Token-2022 account extensions and ImmutableOwner. Fresh RPC rent quotes above this bound halt preparation for policy review; lower quotes retain the conservative allowance. Actual rent is reported separately from transaction metadata. See the [official account storage formula](https://solana.com/docs/core/accounts).

A successful receipt requires matching the onchain message and signed bytes to the frozen attempt, a successful `meta.err`, and exact transaction-specific pre/post token balances mapped by account index/address and mint. Source debits must equal gross and destination credits must equal checked net. A missing prior token balance counts as zero only where creation in this transaction is established.

The receipt includes actual network fee, receiving-account funding, checked issuer fees, slot, available block time, cluster, identifier and confirmation/finality. Finalized receipts require matching successful metadata fetched at finalized commitment; a finalized status cannot upgrade another provider’s confirmed metadata. The raw public transaction metadata is durably archived with the observed time and build identity. The fee payer's SOL change must reconcile to network fee plus account funding. Unrelated later wallet movements cannot alter this receipt. Missing/inconsistent metadata is shown as receipt verification pending; failed transactions never get successful exchange receipts, although they may still pay network fees.

## Endpoint groups

All paths below are under `/api`.

| Group | Routes |
|---|---|
| Status/registry | `GET /health`, `GET /assets`, authenticated `GET /holdings` |
| Authentication | `POST /auth/challenge`, `POST /auth/verify`, `GET /auth/me`, `POST /auth/logout` |
| Listings | `GET /listings`, `POST /listings`, `POST /listings/:id/withdraw` |
| Baskets | `GET /offers`, `POST /offers`, `POST /offers/:id/counter`, `POST /offers/:id/reject` |
| Discovery | `GET /matches`, `POST /matches/room` |
| Rooms | `GET /rooms`, `GET /rooms/:id`, `POST /rooms/:id/accept`, `POST /rooms/:id/ready`, `POST /rooms/:id/renew` |
| Attempts | `POST /rooms/:id/attempts`, `GET /attempts/:id`, `POST /attempts/:id/signatures`, `/submit`, `/reconcile`, `/rebroadcast`, `/stop` |
| Public evidence | `GET /demo`, cursor-paginated `GET /history`, `GET /receipts/:txid` for verified receipts, and `GET /receipts/:txid/evidence` only for finalized archived transactions |

Public evidence downloads project only chain-visible execution terms and finalized bytes; they exclude private negotiation minima/caps, sessions and live executable attempts.

Active room updates use short HTTP polling and stored DB state. Polling is bounded and pauses when the page is hidden/inactive or the room is terminal. Asset/RPC revalidation belongs at financial/signing boundaries, not every participant's room poll. A persisted public-asset cache avoids repeating mint reads on public polls. D1 provider-host request slots pace calls across Worker instances to approximately eight reads per second and one submission every 1.1 seconds; an overfull request window rejects instead of expanding an unbounded wait. Jupiter comparison quotes are omitted and do not block settlement.

## Evidence and remaining release gates

Automated local tests cover financial arithmetic, strict signing, receipt truth, auth, database races and recovery. HTTP settlement integration tests mock RPC while exercising raw Token-2022 decoding and actual SQLite constraints. Separately, LiteSVM 0.8.0 executes the bundled Token-2022 and ATA programs with signature/blockhash verification: the two-for-one basket and three-owner exchange succeed with missing receiving accounts, while a deliberately failing final leg rolls back token effects and ATA creations but retains the network fee. These isolated local program results, immutable signature-round-trip hashes and exact account effects are recorded in [local execution evidence](../evidence/local/litesvm-execution.json); they are not public-network RPC receipts. A local workerd HTTP smoke passed. The local warmed workerd profile measured approximately 4.74 ms sampled active CPU per strict verification; full hosted request CPU and Free-tier headroom remain unverified.

The faucet attempt did not establish funded public-network wallets, so no completed public devnet barter or three-owner exchange, public-network atomic rollback, real browser-extension signature round trip, or devnet/mainnet settlement receipt is claimed. PRE eligibility and mainnet compatibility remain separate gates; devnet mock assets are not real PRE holdings. See the [execution checklist](evidence-and-wallet-smoke.md), [setup guide](../README.md), and [submission draft](submission.md).

**Published checkpoint — 2026-09-25 06:58 UTC:** the single Worker is live at [the devnet demo](https://barterbook-devnet.rileycreighton.workers.dev), with all six remote D1 migrations applied. Initial [source commit `629ed20`](https://github.com/RileyCreighton/barterbook/commit/629ed20da12e68f80bc167cfbca87506110bdf15) passed [GitHub CI with 143 tests](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100). Hosted desktop/mobile no-wallet checks passed; [16 HTTP checks](../evidence/hosted/http-smoke-1790319106255.json) separately verified endpoints and SDK authentication/session controls. The registry remains empty and settlement disabled. Hosted financial-path CPU remains unmeasured because telemetry access returned 403; these HTTP checks are not browser-wallet or settlement proof.
