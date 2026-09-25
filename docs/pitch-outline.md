# BarterBook pitch: maximum 2 minutes 50 seconds

This recording outline matches the delivered local prototype. Keep the application’s **DEVNET · TEST ASSETS** configuration label visible and explicitly identify the execution evidence as **LOCAL LITESVM**, not public devnet. No browser-wallet signing or hosted demonstration is claimed. The official [pitch limit is three minutes](https://hackathons.solana.com/how-it-works).

| Time | Narration and evidence |
|---|---|
| 0:00–0:20 | **The user and problem.** “A tokenized-stock holder may want to rotate a complete package or find specific inventory at acceptable terms. Instant routes exist, but they do not show another holder's negotiated package. BarterBook explores that discovery gap.” Open the selected-inventory examples. |
| 0:20–0:35 | **One application.** “An offer board finds people; BasketSwap negotiates the package; three-way matching connects compatible fixed lots. All use one shared approval and settlement flow.” Point to the three entry paths. |
| 0:35–1:15 | **Two for one.** In the no-wallet walkthrough, inspect the illustrative two-owner, three-transfer basket. Point to gross debit, issuer fee and net receipt. “The walkthrough uses examples. We also executed this type of basket against the actual Token-2022 program in an isolated local Solana runtime, using newly generated test keys.” Open step 4 and the recorded basket details. |
| 1:15–1:35 | **Atomic execution.** Show the recorded local token deltas and withheld fees, followed by the failing-final-leg case. “The successful basket used one message with two signatures. When the last leg failed, earlier token changes and new receiving accounts rolled back. The local transaction fee still applied.” Label this local evidence; do not show a public explorer link. |
| 1:35–2:10 | **Three-way exchange.** Show the illustrative cycle: each participant gives a fixed gross lot and requests a minimum net amount of one other mint. “Every actual incoming net must meet its recipient's terms. We reject a short receipt.” Open the recorded local three-owner result. “Three SDK signers approved identical message bytes, and all three legs executed together locally.” |
| 2:10–2:35 | **Why Solana and what is protected.** “Existing token programs settle every agreed leg in one transaction. There is no new contract or custody wallet. The browser signing path checks the instructions before prompting, and a timeout triggers recovery of the original transaction. Automated tests cover tampering, fees, signing and uncertain outcomes.” |
| 2:35–2:50 | **Current state.** “The app, tests and production build run locally. Browser-wallet signing and public devnet settlement remain pending; our faucet attempt returned no funds. Cloudflare and Helius setup are next.” Point to the evidence ledger and source/setup documentation. |

Use transparent cuts to shorten navigation. Keep private keys, provider URLs, session cookies and private browser tabs out of the recording. No price, savings, mainnet completion or sponsor-eligibility claim should appear without supporting evidence. If public devnet and browser-wallet checks later pass, update the recording from their recorded evidence; local execution alone does not satisfy those gates. Use only actual accessible source/demo/video links in the entry.

## No-wallet judge walkthrough

1. Open the local app and choose the judge walkthrough without connecting a wallet. Confirm the devnet/test-asset banner and illustrative-example labels are visible. A hosted URL can replace localhost only after deployment is available and verified.
2. Inspect the example two-for-one package and its exact gross, fee and net quantities. The examples do not represent a wallet's live inventory.
3. Inspect the three-way listing cycle; read each participant's fixed lot and incoming minimum. Confirm each displayed net receipt satisfies its actual recipient.
4. Open step 4, which displays the recorded **local LiteSVM** basket, ring and rollback evidence. Expand the basket to inspect exact raw source changes, recipient nets and withheld fees. Local signatures have no public explorer page. Public devnet receipts remain pending.
5. Read the recovery explanation: after any signature, stopping the room does not instantly revoke the transaction; the original lifetime and status must be reconciled.
6. Open the source/setup instructions and evidence ledger. The walkthrough requires no assets, login or wallet extension. The separate signing laboratory explains that a compatible extension is needed for real wallet prompts.
