# BarterBook pitch: maximum 2 minutes 50 seconds

This 170-second outline matches the hosted prototype with settlement still disabled. Keep **DEVNET · TEST ASSETS** visible and identify each proof as **PUBLIC DEVNET · SDK SIGNERS** or **LOCAL LITESVM**. The developer-run devnet basket, ring and deliberate final-leg failure have finalized receipts. The website's browser-wallet exchange remains unproven; its live registry is still empty pending restored Cloudflare account access. The official [pitch limit is three minutes](https://hackathons.solana.com/how-it-works).

| Time | Narration and evidence |
|---|---|
| 0:00–0:20 | **The user and problem.** “A tokenized-stock holder may want to rotate a complete package or find specific inventory at acceptable terms. Instant routes exist, but they do not show another holder's negotiated package. BarterBook explores that discovery gap.” Open the selected-inventory examples. |
| 0:20–0:35 | **One application.** “An offer board finds people; BasketSwap negotiates the package; three-way matching connects compatible fixed lots. All use one shared approval and settlement flow.” Point to the three entry paths. |
| 0:35–1:15 | **Two for one.** Inspect the illustrative basket, then open the actual devnet basket receipt linked below. Point to gross debit, issuer fee and net receipt. “The walkthrough uses examples. Separately, our developer-run test finalized this fee-aware basket on public devnet. Two disposable SDK signers approved one message. Transaction metadata verifies all three token legs; the network fee was 10,000 lamports.” |
| 1:15–1:35 | **Atomic execution.** Show the actual devnet final-leg failure. “The final transfer failed, and every intended token delta stayed zero. The 15,000-lamport network fee still applied. This test used existing accounts; new-account rollback is proven separately in our local runtime.” Keep the two environments visibly distinct. |
| 1:35–2:10 | **Three-way exchange.** Show the illustrative fixed-lot cycle, then the actual devnet three-way receipt. “Every incoming net must meet its recipient's terms. Three SDK signers approved identical message bytes, and all three legs finalized together on public devnet. The fee was 15,000 lamports. These are developer tests with mock assets, not browser-wallet settlement or PRE holdings.” |
| 2:10–2:35 | **Why Solana and what is protected.** “Existing token programs settle every agreed leg in one transaction. There is no new contract or custody wallet. The browser signing path checks the instructions before prompting, and a timeout triggers recovery of the original transaction. Automated tests cover tampering, fees, signing and uncertain outcomes.” |
| 2:35–2:50 | **Current state.** “The site, source and SDK devnet receipts are public. The browser exchange still needs live mint registration, hosted CPU checks and actual extension signing. Settlement remains disabled.” Point to the evidence ledger and setup documentation. |

Use transparent cuts to shorten navigation. Keep private keys, provider URLs, session cookies and private browser tabs out of the recording. No price, savings, mainnet completion or sponsor-eligibility claim should appear without supporting evidence. SDK execution does not satisfy browser-wallet gates. Alice's reported authentication success is not independent server verification or a transaction-signing result. Use only actual accessible source/demo/video links in the entry.

Actual finalized devnet records: [two-for-one basket](https://explorer.solana.com/tx/4TLQ55rcPS79kRAQTw52JH2SRTodvH5UzQgeczaRngpbHqu7YBqzfifr126N1BK8cD9GqDhAegdsKr3ofyKgPrP9?cluster=devnet), [three-way exchange](https://explorer.solana.com/tx/3YfomqM1UoyqHkqobn2sUQYMoLh5CcUMsecsbF6o4Zcrrjvzbfsp4E1A6a54etPxcuSvT5z1LXmjmzHVy6coWsC2?cluster=devnet), and [controlled failure](https://explorer.solana.com/tx/Egor5yrT3AXee5otWCdZi1ufCfmqNKBBYVZohAsELwfhzQDbeBycNEY3XZXjjbtrSSRai4dGd88XNnoHB8YyNj6?cluster=devnet). The [evidence ledger](evidence-and-wallet-smoke.md) links exact metadata and signature hashes.

## No-wallet judge walkthrough

1. Open https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough without connecting a wallet. Confirm the devnet/test-asset banner and illustrative-example labels are visible.
2. Inspect the example two-for-one package and its exact gross, fee and net quantities. The examples do not represent a wallet's live inventory.
3. Inspect the three-way listing cycle; read each participant's fixed lot and incoming minimum. Confirm each displayed net receipt satisfies its actual recipient.
4. Open step 4, which displays the recorded **local LiteSVM** basket, ring and rollback evidence. Expand the basket to inspect exact raw source changes, recipient nets and withheld fees. Local signatures have no public explorer page. Separately open the actual **SDK devnet** explorer records above; do not imply that the hosted walkthrough executed those transactions.
5. Read the recovery explanation: after any signature, stopping the room does not instantly revoke the transaction; the original lifetime and status must be reconciled.
6. Open the source/setup instructions and evidence ledger. The walkthrough requires no assets, login or wallet extension. The separate signing laboratory explains that a compatible extension is needed for real wallet prompts.


## Optional technical video — maximum five minutes

Use only scenarios actually executed; never stage wallet success. Spend 0:00–0:40 on the Worker/D1/shared-verifier architecture; 0:40–1:20 on exact raw amounts, fee rounding and accepted terms; 1:20–2:10 on the immutable partial-signature flow; 2:10–3:10 on persistence before broadcast and original-ID recovery; 3:10–4:20 on actual receipts/rollback evidence, explicitly distinguishing local, SDK-devnet and browser-devnet proof; and 4:20–5:00 on hosted CPU, tested wallet versions and remaining limits. If live transactions remain blocked, show code/tests and the honest evidence ledger instead of simulating approvals.

## Recording checklist for the eventual real-wallet demo

- [ ] Same public URL and Devnet label visible in three separate participant profiles.
- [ ] Connect wallet and show the authentication message; hide recovery material.
- [ ] Create selected-inventory listings and the exact basket through the real app.
- [ ] Show each participant accepting terms separately from wallet transaction approval.
- [ ] Capture all three wallet approvals, unchanged message hash and signing progress.
- [ ] Show the actual finalized receipt, explicit devnet explorer page and history after reload.
- [ ] Show a declined prompt without inventing an onchain receipt; separately label any recorded onchain failure and its fee.
- [ ] Demonstration-wallet disclosure visible; no organic-use, stock-ownership or sponsor-eligibility claim.
- [ ] Entire pitch under three minutes; optional technical video under five minutes; actual accessible video links supplied by the owner.
