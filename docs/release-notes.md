# Judging release — September 25, 2026

BarterBook now presents its completed browser transactions as the primary product evidence. Both the two-for-one basket and three-person match finalized through the live app; two independent providers verified every signature and token-account change.

Build **`a7569bc`** is deployed as Worker **`8259ab6a-f779-491e-8ee1-4c36a218fb3f`**. [Served-file verification](../evidence/hosted/judging-deployment-a7569bc.json) passed, [GitHub CI succeeded](https://github.com/RileyCreighton/barterbook/actions/runs/36181898767), and [desktop/mobile browser checks](../evidence/local/judging-browser-checks.json) found no page errors or horizontal overflow. The [live token faucet test](../evidence/hosted/judge-faucet-live-check.json) finalized all three exact token credits to a new disposable recipient.

## Included

- Browser-proof cards on the market, walkthrough and evidence pages, linked to actual receipts, Explorer and raw transaction archives.
- A recorded walkthrough using the exact quantities and direction of the executed three-way match.
- A new **Try the demo** page with Phantom setup, SOL-faucet access, TEST-A/B/C claims, reproducible trade recipes and original-request recovery.
- A dedicated, unfunded, mint-only faucet authority for the three valueless Devnet assets. The requesting wallet pays its account creation and fee. Claims use authentication, rate limits, exact client/server reconstruction, verified signatures and immutable bytes persisted before broadcast.
- Refreshed GitHub README, judge guide, evidence ledger, submission copy and optional video outline.
- Migration `0008_demo_faucet.sql`, adding an isolated test-token request journal without changing existing rooms or settlement records.

[Browser execution evidence](browser-execution-evidence.md) · [Testing guide](judging-guide.md) · [Current limits](delivery-status.md)

Earlier signed transactions, failed attempts, SDK receipts and deployment records remain preserved under `evidence/`. No trade journal was rewritten and no participant spending permission was introduced. The exchange protocol and verification requirements remain in place.
