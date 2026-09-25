# BarterBook

### Your inventory. Shared terms. One atomic exchange.

BarterBook brings selected-inventory offers, exact token baskets and three-person matching into one wallet-driven Solana app. Agree on the whole package, see what each holder receives after token fees, and settle every leg in one transaction.

**[Live demo](https://barterbook-devnet.rileycreighton.workers.dev/#/try)** · **[Recorded walkthrough](https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough)** · **[Browser transaction proof](docs/browser-execution-evidence.md)** · **[Testing guide](docs/judging-guide.md)**

## Executed in browser wallets

Both core flows have finalized through the live app on Solana Devnet. Independent checks from two providers confirm the approved message, all signatures and exact token transfers.

| Flow | Participants | Result | Receipt |
|---|---|---|---|
| Two-for-one basket | Alice + Bob | Alice receives 19.8 C; Bob receives 9.9 A + 4.95 B | [Finalized basket](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/25qQJqb2jgTvY5VVhFsa2fizsxGaZ3pWoVjiREQ9NZkqDxKpy56E1w3ZCHV2RZuNrfh9NeLZgGgsGCix8MpU4XSS) |
| Three-way match | Alice + Bob + Carol | Alice receives 29.7 C; Bob receives 9.9 A; Carol receives 19.8 B | [Finalized three-way](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/2Cu3fwsynLDHVQzB67DUZGBqcxarquCZKtCEyVoAjneSHtoVeFKWeBdnYxieUgFnXxxGCbjirDC6Zoo6yVvHpy8Z) |

Network fees were **0.00001** and **0.000015 Devnet SOL** respectively. Both used longer-lived signing and existing receiving accounts. [Read the complete evidence, raw transactions and verification records](docs/browser-execution-evidence.md).

## Try it yourself

No wallet is needed to explore the walkthrough and receipts. For your own live exchange:

1. Open two or three separate browser profiles with fresh **Phantom wallets on Devnet**.
2. Get at least **0.02 Devnet SOL per wallet** from the [Solana faucet](https://faucet.solana.com/).
3. Open **[Try the demo](https://barterbook-devnet.rileycreighton.workers.dev/#/try)** in each profile. Connect, authenticate and claim **1,000 TEST-A, TEST-B and TEST-C** through the self-service token faucet.
4. Follow the [basket or three-person test recipe](docs/judging-guide.md). Everyone reviews and signs in their own wallet; no developer counterparty or local installation is required.

TEST-A/B/C are valueless mock tokens, not stock ownership or PRE holdings. The hosted demo uses a bounded three-mint registry and Devnet only. The wallet pays its own account rent and network fees; no purchase is needed.

## What makes the exchange work

- **Selected inventory:** publish only the supported tokens and exact lot you want to exchange.
- **Whole-package baskets:** negotiate multiple token legs with one counterparty; each new revision requires renewed consent.
- **Three-person matching:** discover cycles whose incoming net quantities satisfy every holder's minimum.
- **Fee-aware receipts:** distinguish gross debit, checked issuer transfer fee and actual net credit using raw integer arithmetic.
- **One atomic transaction:** existing Solana token programs execute all approved legs together. There is no custom settlement program, pool, escrow or standing spending permission.
- **Time to review:** a wallet-owned durable signing account supports sequential approvals across browser profiles.
- **Original-transaction recovery:** immutable messages, preserved signatures and signed bytes, durable submission records and independent history checks prevent a timeout from silently creating a replacement trade.

## Architecture

React + Vite + TypeScript serve the browser interface. A Cloudflare Worker runs the Hono API and static site, D1 persists offers, rooms and transaction journals, and independent server-side Devnet RPC providers verify network and settlement. Wallet Standard connects Phantom. Every participant's browser reconstructs the accepted transaction before signing, and the server independently verifies signatures and settlement metadata.

The optional demo faucet has a **separate mint-only authority** for the three mock tokens. It cannot spend participant tokens or SOL, and its key is a Worker secret. Faucet transactions are strictly reconstructed on both sides and journaled before broadcast. The exchange engine has no wallet spending key.

[Transaction protocol](docs/architecture.md) · [Longer-lived signing](docs/durable-signing.md) · [Evidence ledger](docs/evidence-and-wallet-smoke.md)

## Development

Use Node **26.8.2** (tests use `node:sqlite`). Dependencies are pinned in `package-lock.json`.

```sh
npm ci --ignore-scripts
cp .env.example .dev.vars
npm run db:migrate
npm run build
npm test
```

Run `npm run dev:api` and `npm run dev` in separate terminals, then open `http://localhost:5173`. Local defaults disable settlement and leave the asset registry empty. Never put RPC credentials or wallet keys in frontend variables, source, screenshots or Git.

- [Deployment and server configuration](docs/deployment.md)
- [GitHub release and CI](docs/github-release.md)
- [Devnet fixtures and operator tools](scripts/DEVNET.md)
- [Judge testing and troubleshooting](docs/judging-guide.md)

## Validation and scope

**301 tests passed.** [GitHub CI](https://github.com/RileyCreighton/barterbook/actions/runs/36181898767) covers the deployed judging build, including the production build, local migrations and secret scan. [Desktop/mobile checks](evidence/local/judging-browser-checks.json) and the [live faucet test](evidence/hosted/judge-faucet-live-check.json) passed.

The test suite covers integer fees, strict transaction reconstruction, partial signatures, account changes, room concurrency, interrupted submission, nonce cancellation, recovery and public-receipt privacy. LiteSVM tests exercise actual token programs, including atomic rollback. Public Devnet evidence includes browser baskets and a three-person match, hosted SDK trades and a deliberate failing final leg.

The current browser path is Phantom. [Solflare's Devnet nonce simulation limitation](docs/solflare-durable-nonce-compatibility.md) remains documented. This is a Devnet prototype, not an audited mainnet service. Historical Worker CPU measurements exceed the published Free-plan budget on some financial routes; see [delivery status](docs/delivery-status.md). Test results, real-chain proofs and known operational limits are recorded separately.

## Submission materials

[Submission description and verified requirements](docs/submission.md) · [Three-minute video outline](docs/pitch-outline.md) · [Release notes](docs/release-notes.md)

## License and attribution

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), [third-party licenses](docs/third-party-licenses.txt) and the included LGPL dependency source under `docs/vendor/`. Development used AI coding assistance. Barter, bilateral package exchange and cyclic matching predate this project; BarterBook combines them into this implemented flow.
