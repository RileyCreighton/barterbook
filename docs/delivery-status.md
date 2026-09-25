# Delivery status — September 25, 2026

[Deployed build `a7569bc`](../evidence/hosted/judging-deployment-a7569bc.json) · [Passing GitHub CI](https://github.com/RileyCreighton/barterbook/actions/runs/36181898767) · [Live faucet verification](../evidence/hosted/judge-faucet-live-check.json)

## Ready for judging

- The public site and GitHub repository are live.
- The browser-executed basket and three-person match are finalized on Devnet. [Both are independently verified](browser-execution-evidence.md).
- The site highlights those browser receipts, exact transfers, Explorer links and downloadable raw evidence.
- The recorded walkthrough follows the actual executed trades.
- Judges have a [hands-on guide](judging-guide.md), a self-service TEST-A/B/C faucet and a link to Solana's Devnet SOL faucet.
- [Submission copy](submission.md) and an optional [three-minute video outline](pitch-outline.md) reflect the completed results.

The self-service faucet has its own mint-only key for the three test assets. It cannot spend participant balances and has no funded fee payer. The requesting wallet pays its own setup rent and network fee. Authentication, rate limits, strict transaction reconstruction and an immutable submission journal protect the endpoint.

## Known operating limits

- Devnet only, with three validated mock mints and at most three owners per exchange. Mock tokens are not stock ownership or real PRE holdings.
- Phantom is the demonstrated browser path. [Solflare's nonce simulation service](solflare-durable-nonce-compatibility.md) misclassified a valid Devnet nonce transaction in the recorded reproduction.
- Historical hosted CPU measurements include prepare at 48 ms, renewal at 28 ms and original recovery at 60 ms, exceeding the published Workers Free 10 ms allowance. Invocation outcomes in those samples were `ok`; the performance budget is not claimed resolved. [CPU evidence](../evidence/hosted/cpu-2026-09-25T09-51-25.797Z.json). No paid plan was enabled.
- The app has no independent security audit or production mainnet approval. SOL faucet availability and rate limits are external dependencies.

## Owner submission actions

Review the final descriptions, team information and eligible tracks, then submit before the official deadline. A video is optional; a short recording is recommended if time permits. The task prepares and publishes the app and repository; it has not submitted a competition entry or attested eligibility for the owner.

Historical deployment, test and transaction records remain under `evidence/`. [Release notes](release-notes.md) describe the current delivery.
