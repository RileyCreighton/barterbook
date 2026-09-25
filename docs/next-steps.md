# Finish the live rehearsal

## Completed two-wallet test

Alice/Bob version 10 finalized on Devnet at **2026-09-25 19:00:02 UTC** using owner-reported Phantom signing. [Two independent providers verified the exact message, both signatures and all six token-account deltas](../evidence/hosted/browser-v10-finalized-verification.json). [The room is finalized with no remaining attempt locks](../evidence/hosted/browser-v10-finalized-database.json). The current deployed build is [`07b09d4`](../evidence/hosted/signing-mode-deployment-07b09d4.json), with [295 passing CI tests](../evidence/local/ci-36175652277.json).

Bob received **9.9 TEST-A + 4.95 TEST-B**; Alice received **19.8 TEST-C**. The exchange fee was **0.00001 Devnet SOL**, with no new receiving-account rent. Keep the completed room and its [public evidence](../evidence/hosted/browser-v10-finalized-evidence.json); no renewal or repeat setup is needed.

## Next: the three-wallet test

Follow the [current three-person rehearsal guide](browser-transaction-retest.md#next-test-alice-bob-and-carol). Use **Phantom on Devnet**, the original Alice/Bob/Carol addresses, and Bob as fee payer so his existing signing account is reused. Solflare's [valid Devnet nonce simulation warning](solflare-durable-nonce-compatibility.md) remains reproducible.

| Person | Gives | Wants at least, after fees |
| --- | --- | --- |
| Alice | 10 TEST-A | 29.7 TEST-C |
| Bob | 20 TEST-B | 9.9 TEST-A |
| Carol | 30 TEST-C | 19.8 TEST-B |

Publish the three exact lots, have Bob open their three-way match, then have everyone accept and mark ready. Bob prepares once; sign **Bob → Alice → Carol**, waiting for each signature to save. Bob submits once and waits for the verified finalized receipt. Actual three-person browser settlement is still pending; earlier SDK three-person receipts remain separate evidence.

If a prepared longer-lived exchange must be abandoned, Bob must cancel on chain through a compatible wallet and reconcile its original outcome before renewal. The one-hour app review period does not revoke saved signatures.

## Recording and delivery

1. Refresh the completed room and public history, open the actual receipt and download its evidence. Preserve old attempts and all original transaction journals.
2. Use the [pitch outline](pitch-outline.md) and [submission checklist](submission.md) for the video. Link only actual videos, source, site and verified receipts. No entry has been submitted; team attestations and final submission authorization remain the owner's responsibility.
3. Keep the [Workers Free CPU limitation](delivery-status.md) visible. Earlier financial request measurements exceed its budget; this successful trade does not establish a performance-budget pass. No paid service was enabled.
4. RPC and fixture setup are already complete. Do not re-enter credentials or regenerate wallets for the rehearsal. Optional GitHub workflow deployment credentials are covered separately in the [release guide](github-release.md).

Historical diagnostics and deployment checkpoints remain in [delivery status](delivery-status.md) and the linked evidence archives.
