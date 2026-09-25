# Longer-lived Devnet signing

## Why this change is necessary

In the real version 8 rehearsal, preparation finished at 17:57:20 UTC, Bob's signature saved at 17:57:33, and Alice's signature upload was rejected at 17:57:50. Finalized Devnet metadata puts the last valid block at 17:57:44 and the first invalid block at 17:57:45. The original blockhash lifetime was about 25 seconds. Preparation took 2.6 seconds. [Measured evidence](../evidence/hosted/browser-v8-signing-expiry.json).

Bob's signature was stored and Alice's returned signature passed client verification before the server rejected its expired lifetime. This retry therefore established that the transaction-message signing path worked for that signing round; it did not finalize an exchange. The user explicitly chose longer-lived signing for the video and three-person rehearsal.

## Behavior and consent

New browser-created baskets, three-person match rooms, and renewed terms explicitly name the fee payer's durable signing account. Previously frozen short-lived attempts remain unchanged and must reconcile normally. Every new revision requires fresh acceptance and readiness.

The fee payer uses **Set up signing in wallet** once. Setup creates a System Program nonce account at an address derived from that wallet and the fixed `barterbook-devnet-nonce-v1` seed. The wallet is both funding account and nonce authority. Setup is separately reviewed in the wallet and capped at 0.002 Devnet SOL in account funding plus 0.000025 SOL in network fees. The account remains controlled by that wallet and can be reused across rooms. The app stores no nonce private key and has no signing authority.

The exchange begins with an exact nonce-advance instruction, followed by the accepted compute budget, receiving-account creation and token transfers. Every participant still verifies and signs the same complete message. A one-hour review period limits new in-app approvals; it does **not** revoke previously issued signatures. Closing the page, stopping collection, or letting the room's review period end does not invalidate a durable authorization.

Solana's [durable nonce documentation](https://solana.com/docs/core/transactions/durable-nonces) describes the first-instruction requirement and the stored nonce lifetime. This is the reason signatures can be collected without a recent-blockhash deadline. The documentation also notes possible future deprecation; the implementation uses the currently supported System Program mechanism.

## Cancellation and recovery

**Cancel on chain in wallet** stops further signature collection and asks only the fee payer to approve an exact single-instruction cancellation. The cancellation uses the **original nonce as its own lifetime**. It cannot advance a future trade's nonce if the original trade already won the race. Cancellation and exchange cannot both consume the same nonce. A network fee may be charged. After cancellation finalizes, use **Reconcile original status** to establish the original outcome before renewing.

Setup and cancellation have their own immutable journal. Signed bytes and their locally derived transaction identifier are persisted before any app broadcast. An interrupted request checks that original operation. **Resend original submission** reuses its saved bytes; it never opens a replacement wallet prompt. **Review pending request in wallet** can resume an unsigned/interrupted approval against the same stored operation.

Original exchange recovery requires actual finalized nonce invalidation and independent history checks. An authority change alone is reversible and never authorizes replacement. A positive original receipt takes priority over cancellation assumptions. Failed durable transactions also remain locked until nonce invalidation is independently verified. An attempt with no stored payer signature additionally requires the existing complete bounded message-history scan.

The nonce is initially observed at a finalized bank, which anchors the history scan's lower bound. Absence checks must reach the finalized bank that observed invalidation. A unique database index prevents freezing the same nonce/account pair twice. Existing participant allocation locks serialize use of a fee payer's nonce. Incomplete or conflicting history keeps locks held.

## Validation and remaining proof

[Local regression results](../evidence/local/durable-signing-tests.json) include two- and three-owner signing, actual delayed Token-2022 execution in LiteSVM, replay rejection, cancellation before execution, a late cancellation after successful execution, changed instruction rejection, setup persistence before broadcast, interrupted setup recovery, original-attempt lock retention, nonce authority changes and stale provider snapshots. [Isolated Firefox checks](../evidence/local/durable-signing-firefox.json) exercised setup and cancellation controls with generated dummy keys and mocked APIs.

The pinned LiteSVM 0.8.0 rolls back nonce advancement when a later token instruction fails, unlike the documented Solana behavior. That test proves token rollback and verifies that the application refuses replacement while the nonce remains live. It is not claimed as proof of nonce consumption on a public network. No dependency upgrade or hidden emulator patch was made.

Actual Solflare setup and finalized two-/three-person browser receipts remain the owner's live verification step. Follow the [updated rehearsal guide](browser-transaction-retest.md).
