# BarterBook

BarterBook combines a selected-inventory offer board, exact two-owner token baskets, and bounded three-owner exact-lot matching. Participants authorize one atomic Solana transaction using existing token programs. The application has no onchain program, custody wallet, trading key, pool, or standing token delegation.

**Live Devnet-configured prototype:** [open the no-wallet guide](https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough), [source](https://github.com/RileyCreighton/barterbook), [passing CI](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100).

The hosted website, API and D1 authentication/persistence checks pass. **Live settlement is disabled:** restoring Cloudflare management access, registering the newly validated mints, real browser transaction approvals and hosted financial-path CPU measurements remain pending. Developer-run SDK tests have now finalized a real Devnet basket, three-owner exchange and controlled failed transaction with zero token settlement. [Their receipts](evidence/devnet/20260925-sdk-proof-01/) are separate from local LiteSVM evidence and from the still-unproven browser settlement flow. Mock assets never represent PRE holdings; mainnet is disabled.

## Start here

- [Beginner wallet setup and rehearsal](docs/wallet-rehearsal.md)
- [Helius endpoint setup](docs/helius-setup.md) and [same-origin Cloudflare deployment](docs/deployment.md)
- [GitHub release, CI and deployment workflow](docs/github-release.md)
- [Current delivery status](docs/delivery-status.md) and [troubleshooting](docs/troubleshooting.md)

**Public URL:** https://barterbook-devnet.rileycreighton.workers.dev. **Repository:** https://github.com/RileyCreighton/barterbook. See [the next account/wallet steps](docs/next-steps.md). Stocklana currently lists **September 25, 2026, 4 p.m. Eastern** as its deadline; see the [fresh official-rule check](docs/submission.md). No entry has been submitted.

## What is implemented

- Wallet Standard connection, wallet-signed authentication, one-use challenges, and short-lived secure sessions.
- Persistent selected-inventory listings, exact basket offers/counteroffers, versioned acceptance, readiness rooms, and bounded two-/three-owner discovery.
- Integer-only fee calculations, checked token transfers, strict independent browser/server transaction validation, and immutable partial-signature merging.
- D1 transaction constraints for wallet/listing reservations, frozen attempts, concurrent signature updates, and original-transaction recovery.
- Persistent public transaction-metadata receipts, bounded history, and finalized raw-evidence downloads that retain message bytes, block time when available, fees and transaction-specific token changes.
- A no-wallet guide that separates illustrative examples, developer-controlled demo activity and execution evidence; account changes clear private session and signing state.

Launch configuration accepts at most three independently validated devnet mints. Three assets support a meaningful two-for-one basket and a three-owner cycle. The transfer engine is bounded at five lines; this release does not enable a five-distinct-asset basket. Opposing bilateral transfers of the same mint are rejected rather than silently netted.

## Local setup

The recorded local runs used Node.js **26.8.2**. Tests use Node's built-in `node:sqlite`, so use a Node runtime that provides it. Dependency versions and the compatible `@solana/web3.js` **1.99.0** / `@solana/spl-token` **0.4.15** pair are pinned in `package.json` and `package-lock.json`.

```sh
npm ci --ignore-scripts
test -e .dev.vars || cp .env.example .dev.vars
npm run build
npm run db:migrate
```

Leave `SETTLEMENT_ENABLED=false` and `DEVNET_ASSETS_JSON=[]` to browse locally without RPC credentials, funds, or a wallet. The checked-in D1 ID is a placeholder for local development. Apply every checked-in migration. Migration `0002_guard_hardening.sql` updates triggers without deleting records; subsequent migrations add an asset cache and persistent provider-request pacing.

Run these in separate terminals:

```sh
npm run dev:api
```

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite forwards `/api` to the local Worker on port 8787. Keep `APP_ORIGIN=http://localhost:5173` for this mode. Origin checks intentionally reject mutation requests from other sites/ports. Sessions use a Secure, HttpOnly, SameSite=Strict, host-only cookie; use `localhost` for local browser testing and HTTPS when hosted.

To preview built static assets through the Worker directly, build first and set the local `APP_ORIGIN` to the exact browser origin used for that preview. Do not change the origin of a running signing session.

## Server configuration

`.dev.vars` is ignored by version control. Copy the placeholders from `.env.example`; enter secrets locally, never in chat, source code, screenshots, or frontend `VITE_` variables.

| Setting | Meaning |
|---|---|
| `APP_ORIGIN` | Exact public application origin used for wallet challenges and mutation checks. |
| `SOLANA_CLUSTER` | `devnet` for this release. Mainnet settlement is rejected independently of the flag. |
| `SOLANA_RPC_URL` | Server-only Helius devnet endpoint, including its provider credential. |
| `SOLANA_RPC_FALLBACK_URL` | Optional independent devnet RPC for conservative history reconciliation; it must also pass the devnet genesis check. |
| `SETTLEMENT_ENABLED` | Defaults to `false`; enable only after the fixture and compatibility gates pass. |
| `DEVNET_ASSETS_JSON` | JSON array of up to three tested devnet mock `Asset` records. Empty by default. |
| `RPC_HISTORY_TRUSTED` | `true` only after verifying that the primary endpoint provides authoritative history. |
| `FALLBACK_HISTORY_TRUSTED` | Equivalent independently verified property for the fallback. |
| `DEMO_PARTICIPANTS_JSON` | Up to six public fixture wallet addresses (three SDK plus three browser participants); matching offers/history receive explicit “Demo wallet” labels. |
| `SITE_URL`, `REPOSITORY_URL` | Real public HTTPS links, configured only after deployment/publication. |
| `BUILD_ID` | Reviewed Git commit identity archived with new finalized evidence. |
| `DB` | Cloudflare D1 binding configured in `wrangler.jsonc`. |
| `ASSETS` | Worker static-assets binding for the built `dist/` directory. |

History flags are assertions the operator must verify, not a way to turn a null RPC response into proof of absence. Using two URLs on the same provider host does not count as independent absence evidence. Each recovery endpoint must also retain blocks covering the frozen attempt context. An unavailable or pruned fallback may leave an expired attempt locked until its original outcome can be established.

Wallet public addresses and mint addresses are public terms. Wallet private keys and provider secrets never belong in client configuration. Sessions are opaque random tokens stored only as hashes; the application does not need a server trading wallet or session-signing key.

## Devnet fixtures and actual signing proof

The authorized test setup is **new disposable devnet-only wallets funded only by a faucet**. Do not import an existing funded wallet or acquire stock tokens to make the demonstration work.

```sh
npm run devnet:fixtures -- --run YOUR_RUN_ID
npm run devnet:exchange -- --run YOUR_RUN_ID
```

Read [the disposable-devnet script guide](scripts/DEVNET.md) before execution. The scripts enforce the devnet genesis hash, keep disposable keys and recovery journals under ignored `.test-wallets/`, and persist signed bytes and identity before broadcasting. They produce a registry only after separate fee-aware compatibility transfers validate every mint. If created successfully, `evidence/devnet/<runId>/assets.json` is the JSON array to copy into the server-owned `DEVNET_ASSETS_JSON` setting.

These scripts use SDK signers and **do not prove browser-wallet compatibility**. The browser signing laboratory and [wallet smoke checklist](docs/evidence-and-wallet-smoke.md) must separately verify real wallet message signing, sign-without-broadcast partial transaction signing, signature preservation, and unchanged message bytes for two and three owners. Wallet approvals belong to the user controlling those authorized test wallets.

The original faucet request and one explicit, journaled retry did not establish funding; those records remain intact. Later user-operated faucet transfers funded the disposable SDK payer and Bob with 1 Devnet SOL each, with [official source attribution](evidence/devnet/20260925-sdk-proof-01/faucet-source-verification.json). The setup wallet then [funded Alice and Carol with 0.05 SOL each](evidence/devnet/20260925-sdk-proof-01/browser-sol-alice-carol-01-receipt.json). Four wallets did not require four airdrops. All three mints passed actual fee-aware transfers, and the three browser wallets received mock inventory. The SDK [two-for-one basket](evidence/devnet/20260925-sdk-proof-01/devnet-two-for-one-receipt.json), [three-owner exchange](evidence/devnet/20260925-sdk-proof-01/devnet-three-way-receipt.json) and [failed final leg](evidence/devnet/20260925-sdk-proof-01/devnet-atomic-last-leg-failure-receipt.json) have finalized Devnet metadata. These are developer-run programmatic tests, not browser transaction approvals. Do not delete unresolved journals; [earlier funding checks](evidence/devnet/20260925-sdk-proof-01/funding-checks/) remain historical evidence.

Real PRE tests require a separate eligibility confirmation, explicit asset/fee authorization, fresh mint/account compatibility checks, separate mainnet registry/database records, and separately recorded receipts. Mock tokens are not proof of eligibility or PRE-bounty qualification.

## Tests and evidence

```sh
npm test
npm run check
npm run build
npm run spike
npm run profile
```

The latest recorded full suite passed; [finishing verification](evidence/finish-verification.json) links its recorded count and individual results. Earlier reports remain preserved. `npm test` covers fee rounding/caps/epoch transitions, net minima, exact-lot matching, transaction tampering, partial signatures, auth replay and origin checks, D1 races, uncertain submission, prior-success recovery, and transaction-specific receipts. The HTTP settlement integration tests use real SQLite constraints and **mocked RPC account data**; they do not execute trades onchain.

Separate `tests/local-runtime.test.ts` checks execute the actual bundled Token-2022 and associated-token programs in **LiteSVM 0.8.0**, with signature and blockhash verification. They passed a fee-aware two-for-one basket, a three-owner exchange with missing receiving ATAs, and a deliberately failing final leg that rolled back token changes and ATA creation while retaining the network fee. The unchanged message hash and exact account effects are recorded in [local program-execution evidence](evidence/local/litesvm-execution.json). These are real in-process program executions, **not public devnet/mainnet receipts or browser-wallet proof**; their local signatures have no public explorer page.

`npm run spike` records an SDK-only two-owner/three-transfer message and a three-owner/three-transfer message. The recorded wires were **774 bytes** and **870 bytes**, respectively, with immutable message bytes and valid signatures. This is local construction evidence, not a browser-wallet or network receipt: [signing spike](evidence/signing-spike.json).

A local workerd/D1 HTTP smoke exercised authentication, nonce replay rejection, session persistence, room privacy and public endpoints: [local Worker smoke](evidence/local-worker-smoke.json). Six [local browser checks](evidence/local/browser-ui-smoke.json) passed, including the no-wallet walkthrough and its actual local evidence in step 4. No wallet extension was available, so these checks do not prove browser wallet signing. The [evidence ledger and remaining checks](docs/evidence-and-wallet-smoke.md) distinguish local, browser, devnet and mainnet outcomes.

### Worker CPU gate

The free-tier target is 10 ms CPU per dynamic request; no paid plan was purchased. An early **local workerd** V8 sampling profile measured approximately **4.74 ms sampled active CPU per strict three-owner verification** in a warmed batch of 100. This is not hosted per-request CPU, a cold-start result, a percentile, or a measurement of the full RPC/D1/auth request path. See [the raw profile](evidence/workerd-cpu-profile.json) and [provider gates](docs/sources-and-provider-gates.md).

Reproduce the isolated local profile in separate terminals:

```sh
npx wrangler dev --config scripts/wrangler-profile.jsonc --port 8790 --inspector-port 9230
```

```sh
node scripts/profile-workerd.mjs
```

Hosted Free-tier headroom remains a release gate. Never weaken signature/instruction verification to fit a CPU budget. If measured traffic requires a paid tier, obtain explicit approval before upgrading.

## Hosting and release

Cloudflare sign-in, the free `rileycreighton.workers.dev` hostname, all six remote D1 migrations and a healthy Helius Devnet endpoint are prepared. The prototype is deployed and the repository is public; a GitHub release draft is being prepared. Follow [deployment](docs/deployment.md) for an ignored deployment config, additive D1 migrations, server-only secrets, verification and rollback. The checked-in `wrangler.jsonc` keeps safe local defaults. The GitHub workflow is manual so a push does not silently deploy.

The target recurring cost is **$0 at demonstration traffic levels**. [Current published allowances](docs/release/provider-limits.md) include Workers Free's 100,000 dynamic requests/day and 10 ms CPU/request, D1's 5 million rows read and 100,000 written/day, and Helius Free's 1 million credits/month. Actual hosted verification CPU remains unmeasured; no paid upgrade is authorized.

The intended production shape is **one Worker serving static assets plus a Hono API and one D1 database**. Only `/api/*` invokes Worker-first routing; room updates use bounded HTTP polling. A public-asset cache and durable provider-host request slots pace reads to approximately eight per second and submissions to one every 1.1 seconds across Worker instances. No Redis, WebSocket service, extra always-on server, quote subscription, or custom contract is required.

## Screenshots

The deployed no-wallet guide, with illustrations clearly separated from execution proof:

![Hosted desktop guide](docs/screenshots/hosted-guide-desktop.png)

[Hosted mobile guide screenshot](docs/screenshots/hosted-guide-mobile.png). These screenshots show the public guide, not browser-wallet settlement.

## License and contribution

Original BarterBook source is [Apache-2.0](LICENSE), allowing you and others to use, modify, distribute and commercialize it under the license terms. Dependencies retain their own licenses. The existing `rpc-websockets` dependency is LGPL-3.0-only; its exact corresponding source, license texts and rebuild information are included and served at `/legal/`. Keep [NOTICE](NOTICE), [third-party attribution](docs/third-party-attribution.md) and the legal build step when redistributing. See [contributing](CONTRIBUTING.md) and [security reporting](SECURITY.md).

## More detail

- [Architecture, state boundaries and API](docs/architecture.md)
- [Wallet and execution evidence checklist](docs/evidence-and-wallet-smoke.md)
- [Pitch outline, at most three minutes](docs/pitch-outline.md)
- [Submission draft and verified public form limits](docs/submission.md)
- [Third-party attribution](docs/third-party-attribution.md)

The submission text and pitch are preparation artifacts. No competition entry, public announcement, message to another person, or external publication is authorized by this setup guide. This prototype is not a security audit or a claim of live PRE settlement, guaranteed savings, or validated customer demand.
