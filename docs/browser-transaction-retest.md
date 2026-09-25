# Browser transaction retest with longer-lived signing

## Completed: Alice and Bob

Version 10 finalized on Devnet at **2026-09-25 19:00:02 UTC**, slot **504129295**. The owner reports successful signing through **Phantom**. [Both independent providers verified the exact signed message, both signatures and all six token-account deltas](../evidence/hosted/browser-v10-finalized-verification.json). [The room and attempt are finalized, with no remaining attempt locks](../evidence/hosted/browser-v10-finalized-database.json).

- Alice gave **10 TEST-A + 5 TEST-B** and received **19.8 TEST-C**.
- Bob gave **20 TEST-C** and received **9.9 TEST-A + 4.95 TEST-B**.
- The exchange network fee was **0.00001 Devnet SOL**; no new receiving-account rent was charged.
- [Shareable receipt](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/iLuszetsxvfEpxz7R1VYRZPQHMg8Mw5mtrTvz18oZ32Fo5ZCKCtJd3VdmWXBvbhnSnrCwthdc9yUxN5g7J1AQfZ) · [Public transaction evidence](../evidence/hosted/browser-v10-finalized-evidence.json).

The two-person room is complete. Do not renew it or repeat signing-account setup. Bob's signing account remains under his authority, with its original nonce consumed, and can be reused for the next room.

The deployed build remains **`07b09d4`**. [Deployment verification](../evidence/hosted/signing-mode-deployment-07b09d4.json), [52 focused regression checks](../evidence/local/signing-mode-guard-tests.json) and [295 passing CI tests](../evidence/local/ci-36175652277.json) cover that runtime. This follow-up records actual browser settlement and changes the rehearsal guide; it does not change the application.

## Wallet choice for the three-person test

Use **Phantom on Devnet** for the same Alice, Bob and Carol addresses. Solflare's simulation service still [misclassifies valid Devnet nonce transactions as Mainnet](solflare-durable-nonce-compatibility.md). The successful Phantom basket does not establish Solflare compatibility or complete the three-person browser test.

## Prepare the existing wallet windows

1. Use your existing separate Zen profiles for Alice, Bob and Carol. Use Phantom on **Devnet**.
2. Close any old approval popup. Open [the fresh signing-update link](https://barterbook-devnet.rileycreighton.workers.dev/?release=07b09d4) in all three profiles, then connect/authenticate the intended Phantom account in each if prompted. A login-message approval is separate from transaction approval.
3. Check the identities below. The app may use the generic demo labels rather than Alice/Bob/Carol.

| Person | App label | Public address as shortened by the app |
| --- | --- | --- |
| Alice | Demo wallet 1 | `8B9FC…DeuTi` |
| Bob | Demo wallet 2 | `H8jpK…5bBk8` |
| Carol | Demo wallet 3 | `EqEnS…HAz5J` |

4. In **Portfolio**, refresh holdings and confirm the required test tokens are available. Have every participant's room open and wallet unlocked before preparing a transaction. The new room will explicitly show **Longer-lived signing**. Its exchange signatures no longer depend on the short recent-blockhash window. Complete the app review/signing round within its one-hour review period.

## Next test: Alice, Bob and Carol

Each person uses **Portfolio → Publish an exact lot** to enter and publish their own row. The quantity is what leaves the sender; the minimum is what that sender wants to receive after token fees.

| Profile | I give | Exact gross quantity | I want | Minimum net receipt |
| --- | --- | ---: | --- | ---: |
| Alice | TEST-A | 10 | TEST-C | 29.7 |
| Bob | TEST-B | 20 | TEST-A | 9.9 |
| Carol | TEST-C | 30 | TEST-B | 19.8 |

1. Publish each row with **Publish selected lot**. Publishing a listing does not sign a transfer.
2. In **Bob's profile**, open **Matches → Find current matches**. Choose the **Three-way cycle** containing the three addresses above. The market also contains developer-controlled demo wallets 4–6; select your own Alice/Bob/Carol cycle.
3. Verify the match shows **9.9 TEST-A from Alice to Bob**, **19.8 TEST-B from Bob to Carol**, and **29.7 TEST-C from Carol to Alice**. These quantities were checked against the current 1% fees and the existing matcher before delivery of this guide.
4. Bob clicks **Review in shared room**. The profile opening the room becomes the fee payer, so use Bob here. Copy this room URL into Alice's and Carol's profiles, or open it from their **Trade rooms** list.
5. All three review the same terms, check the box, click **Accept exact terms**, and click **I’m ready**.
6. Confirm the room shows **Longer-lived signing** and **Signing account ready** for Bob. His setup from the first exchange is reused. Bob clicks **Prepare one transaction** once. Sign in Phantom in sequence: **Bob → Alice → Carol**, waiting for the saved-signature confirmation after each approval.
7. After all three signatures are saved, Bob clicks **Submit signed exchange**. Wait for the verified finalized receipt, then save its shareable link and download the evidence.

If the signing round fails, keep its original room and reconcile that attempt. For a prepared longer-lived exchange, expiry of the review period does not revoke signatures: Bob must approve **Cancel on chain in wallet**, then reconcile the original outcome before renewal. A fresh terms revision and new signatures are required for a replacement. If the altered-transaction error or earlier Devnet/Mainnet warning returns, stop at that point and report which participant, the exact text, and whether the app saved the signature. Do not change networks to proceed.
