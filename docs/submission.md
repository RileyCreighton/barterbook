# Stocklana submission package

Prepared September 25, 2026. The site and source are public; this document is ready to copy into the submission form. No entry has been submitted by this task.

## Verified requirements

The [official Stocklana page](https://hackathons.solana.com/hackathons/stocklana) requires registration, one original entry per team, disclosure of reused open-source work, and at least one GitHub, demo or video link. The posted deadline is **September 25, 2026, 4 p.m. Eastern / 20:00 UTC**. Edits are allowed until closing.

A video is **optional**. [Official submission guidance](https://hackathons.solana.com/how-it-works) permits a pitch of at most **3 minutes** and a separate technical walkthrough of at most **5 minutes**. A concise demo is recommended to show the problem, both executed flows and the receipts, but do not miss the deadline to record one. Up to three sponsor tracks may be selected. Generic mock tokens do not by themselves establish PRE bounty eligibility.

The public form client was previously checked for a 280 UTF-16-unit short-description limit and 5,000-unit full-description limit; [the archived form verification](release/submission-rules-verification.json) records that inspection. Official deadline/link/video guidance was rechecked at 2026-09-25T19:41:27.317543+00:00. Authenticated server validation and final team attestations remain part of the owner's submission.

## Project name

BarterBook

## Short description

<!-- short:start -->
BarterBook lets holders negotiate token baskets and discover three-person matches. Each wallet signs one fee-aware atomic Solana transaction. Browser-executed basket and three-way trades are finalized on Devnet, with public receipts and a self-service test demo.
<!-- short:end -->

## Full description

<!-- full:start -->
BarterBook helps token holders find the inventory and package they actually want, then exchange it together. A holder may want two assets for one position, or a three-person cycle where no direct pair satisfies everyone's needs. Selected-inventory discovery and exact negotiated packages complement instant swap routes.

The app combines three flows:
- An offer board for selected inventory and desired replacements.
- Two-owner baskets, including two tokens for one.
- Three-person matching across fixed lots, respecting every recipient's minimum after transfer fees.

Every participant reviews the complete terms and signs the same Solana transaction. Existing token programs execute all agreed legs atomically. There is no custom settlement program, liquidity pool, custody wallet or standing spending permission. The browser reconstructs the approved instructions before requesting a signature; the server independently verifies the message and signatures.

Token-2022 fee checks preserve exact gross debits and net receipts. Calculations use raw integers, current fee schedules, rounding and fee caps. The app rejects a match if any participant receives less than their accepted minimum. Longer-lived, wallet-owned signing accounts give participants time to review across separate browser profiles. Immutable transaction journals and independent history checks reconcile the original outcome before allowing a replacement.

Both core flows have now completed through the live site with browser-wallet approvals:
- Basket: Alice gave 10 TEST-A + 5 TEST-B; Bob gave 20 TEST-C. Bob received 9.9 A + 4.95 B, Alice received 19.8 C. Network fee: 0.00001 Devnet SOL.
- Three-way match: Alice sent 10 A to Bob, Bob sent 20 B to Carol, Carol sent 30 C to Alice. Net receipts were 9.9 A, 19.8 B and 29.7 C. Network fee: 0.000015 Devnet SOL.

Both finalized on September 25, 2026. Two independent providers verified every required signature, the exact approved message and all token-account deltas. [Basket receipt](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/25qQJqb2jgTvY5VVhFsa2fizsxGaZ3pWoVjiREQ9NZkqDxKpy56E1w3ZCHV2RZuNrfh9NeLZgGgsGCix8MpU4XSS) and [three-way receipt](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/2Cu3fwsynLDHVQzB67DUZGBqcxarquCZKtCEyVoAjneSHtoVeFKWeBdnYxieUgFnXxxGCbjirDC6Zoo6yVvHpy8Z) include downloadable original transaction metadata. Earlier SDK execution tests also demonstrate a failing final leg with zero token settlement; local LiteSVM tests cover receiving-account rollback and recovery edge cases.

Judges can explore the recorded walkthrough and receipts without a wallet, or run their own two- or three-wallet exchange. The live Try the demo guide explains Phantom Devnet setup, links the Solana SOL faucet and provides a self-service faucet for 1,000 TEST-A/B/C per test wallet. Judges can control each participant in separate browser profiles; no developer counterparty is required.

The stack is React, Vite and TypeScript, with a Cloudflare Worker serving static assets and a Hono API, D1 persistence and independent server-side Devnet RPC providers. Wallet keys remain in wallets. The separate demo-faucet key can mint only the mock assets and has no participant spending authority. Provider credentials and the faucet key remain server secrets.

This is a public Devnet prototype with valueless test tokens, not real stock ownership or PRE holdings. A real issuer integration needs separate asset and eligibility validation. Phantom is the demonstrated browser path; an observed Solflare nonce simulation limitation remains documented. The project is not independently audited. Historical financial-route CPU measurements exceed the published Workers Free budget; that operating limit remains documented rather than claimed resolved.

The public repository includes the full source, testing guide, original transaction evidence and reproducible regression checks. Development used AI coding assistance. Apache-2.0 and third-party notices identify the reused libraries, and the documentation acknowledges prior barter and cyclic matching work.
<!-- full:end -->

## Supporting links

- Repository: https://github.com/RileyCreighton/barterbook
- Demo: https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough
- Hands-on test: https://barterbook-devnet.rileycreighton.workers.dev/#/try
- Evidence: https://github.com/RileyCreighton/barterbook/blob/main/docs/browser-execution-evidence.md
- Pitch video: add your actual public or unlisted recording if available; optional.
- Technical video: optional; add only if recorded.

Descriptions: **262/280** and **4115/5000** UTF-16 units.

Before submitting, open the links while logged out, supply your team information, select only tracks whose requirements you meet and review the final entry. Save Draft and Submit Project are different actions. Final submission has not been authorized in this task.
