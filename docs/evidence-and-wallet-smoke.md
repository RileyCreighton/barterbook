# Execution evidence

## Browser trades through the live site

Both the two-for-one basket and the three-person match have completed through browser wallets and finalized on public Solana Devnet. [The browser evidence guide](browser-execution-evidence.md) links the real receipts, original transaction bytes and independent verification from two providers.

| Evidence | What it establishes | Record |
|---|---|---|
| First browser basket | Two wallet signatures, exact transfers, finalized receipt and released locks | [Version 10 verification](../evidence/hosted/browser-v10-finalized-verification.json), [room completion](../evidence/hosted/browser-v10-finalized-database.json) |
| Recorded browser basket | Two signatures, all six token-account changes, immutable message and nonce consumption | [Verification](../evidence/hosted/browser-basket-finalized-verification.json), [raw transaction](../evidence/hosted/browser-basket-finalized-evidence.json) |
| Recorded three-person match | Three signatures, all six token-account changes, immutable message and nonce consumption | [Verification](../evidence/hosted/browser-ring-finalized-verification.json), [raw transaction](../evidence/hosted/browser-ring-finalized-evidence.json) |
| Hosted SDK basket and ring | Authenticated hosted API execution with disposable SDK signers | [Hosted basket](../evidence/devnet/20260925-sdk-proof-01/hosted-hosted-financial-02-basket-receipt.json), [hosted ring](../evidence/devnet/20260925-sdk-proof-01/hosted-hosted-financial-02-ring-receipt.json) |
| Deliberate final-leg failure | Public Devnet failure with zero token settlement in existing accounts | [Failure receipt](../evidence/devnet/20260925-sdk-proof-01/devnet-atomic-last-leg-failure-receipt.json) |
| Local token-program execution | Exact fee accounting, atomic execution and new receiving-account rollback | [LiteSVM report](local-runtime-evidence.md) |
| Longer-lived signing and cancellation | Delayed signing, immutable operations, original-outcome recovery and cancellation races | [Durable signing tests](../evidence/local/durable-signing-tests.json), [protocol](durable-signing.md) |

Browser execution is reported by the participating project owner. Chain verification establishes the actual signatures and settlement independently; it does not infer the wallet application's identity. Original SDK setup and earlier unsuccessful attempts remain archived under `evidence/` with their original provenance.

## Reproduce the result

Use [the judge guide](judging-guide.md) to get Devnet SOL and TEST-A/B/C, then execute both flows with your own wallets. No local installation or developer-operated counterparty is needed. The public receipts and walkthrough are accessible without a wallet.

## Operational scope

The demonstrated assets are valueless Devnet mocks. Real stock-token integration, eligibility and security review are separate work. The [Solflare nonce simulation issue](solflare-durable-nonce-compatibility.md) remains documented; Phantom is the demonstrated path. Historical hosted financial CPU measurements exceed the published Workers Free budget on some routes. Successful settlement does not establish a CPU-budget pass; see [delivery status](delivery-status.md).
