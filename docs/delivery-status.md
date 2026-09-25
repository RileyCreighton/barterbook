# Delivery status — September 25, 2026

Checkpoint: **2026-09-25 06:58 UTC**. The [public devnet demo](https://barterbook-devnet.rileycreighton.workers.dev) and [source repository](https://github.com/RileyCreighton/barterbook) are live. Initial commit `629ed20` passed [GitHub CI with 143 tests](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100). Status labels distinguish implementation from evidence. The live deadline remains **September 25 at 4 p.m. Eastern** in the current official event page. No entry has been submitted.

| Requirement | Implemented | Verified locally | Verified on devnet / hosted | Blocked or next action |
|---|---|---|---|---|
| Exact baskets, three-owner matching, strict signing, fees | Yes | Financial/signing/matcher tests and actual LiteSVM token-program execution | No | Fund authorized devnet fixtures and run real exchanges |
| Auth, listings, counteroffers, rooms, reservations, recovery | Yes | SQLite/API regression tests; earlier local Worker smoke | 16 hosted HTTP checks passed, including SDK authentication, replay rejection, session persistence and room privacy | Hosted browser-wallet and financial-room rehearsal remain pending |
| Public history and finalized raw metadata archive | Yes | Privacy/pagination/receipt integration tests | No | Real application-settled receipts |
| Account changes and wallet prompts | Yes | Wallet-adapter tests | No real extension proof | User prepares three isolated profiles and approves prompts |
| No-wallet guide and demo disclosure | Yes | Local browser checks and desktop/mobile screenshots | Hosted desktop/mobile no-wallet walkthrough verified | Keep illustrative examples and local execution proof distinct from public receipts |
| Faucet-only, repeatable devnet fixtures | Run-scoped immutable scripts and authenticated idempotent seeding | SDK construction/local execution; script recovery/receipt regressions | Original request and one explicit retry remain unfunded; no settlement | Preserve journals; bounded funding recovery |
| Single Worker + D1 deployment | Deployed Worker and manual workflow | Local build/dry run | Public demo live; all six remote D1 migrations applied | Registry is `[]` and settlement remains disabled; GitHub deployment token still missing |
| Free-plan CPU limit | Native crypto and early profile | 4.74 ms warmed core verification, not full request | Financial-path CPU unmeasured; telemetry API returned 403 | Dashboard or specifically scoped telemetry token; actual hosted path CPU gate |
| GitHub release and license | Public repository; Apache/third-party materials | Secret scan, tests, production build and local migrations passed in CI | Initial commit `629ed20`; first CI passed 143 tests; hosted legal downloads passed | `devnet` environment has nine variables and account-ID secret; add `CLOUDFLARE_API_TOKEN` before manual workflow deployment |
| Stocklana package | Drafts, rules, form limits, script/checklists prepared | Fresh public form limits verified | Not submitted | Actual live/repo/video/proof links and owner submission |

See [evidence ledger](evidence-and-wallet-smoke.md), [rehearsal](wallet-rehearsal.md), [deployment](deployment.md), and [release checklist](release-checklist.md). Earlier evidence remains intact; local signatures are never relabeled as devnet receipts.

The disposable SDK payer still has zero faucet SOL. No public devnet settlement, real browser-extension signing, or hosted financial CPU proof is claimed. The [hosted HTTP report](../evidence/hosted/http-smoke-1790319106255.json) records HTTP/Worker/D1 checks with ephemeral SDK authentication, not an onchain exchange.
