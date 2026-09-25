# Browser transaction retest after the Solflare repair

The repair is live at [BarterBook Devnet](https://barterbook-devnet.rileycreighton.workers.dev), build `b45551b`. [Deployment verification](../evidence/hosted/solflare-signing-deployment-b45551b.json) confirms the served files match the tested build. [CI passed all 262 tests](https://github.com/RileyCreighton/barterbook/actions/runs/36166658227). These checks do not replace the owner-controlled Solflare test below.

## Prepare the existing wallet windows

1. Use your existing separate Zen profiles for Alice, Bob and Carol. Keep Solflare on **Devnet**.
2. Close any old approval popup. Hard-refresh the BarterBook page in all three profiles, then connect/authenticate the intended Solflare account in each if prompted. A login-message approval is separate from transaction approval.
3. Check the identities below. The app may use the generic demo labels rather than Alice/Bob/Carol.

| Person | App label | Public address as shortened by the app |
| --- | --- | --- |
| Alice | Demo wallet 1 | `8B9FC…DeuTi` |
| Bob | Demo wallet 2 | `H8jpK…5bBk8` |
| Carol | Demo wallet 3 | `EqEnS…HAz5J` |

4. In **Portfolio**, refresh holdings and confirm the required test tokens are available. Have every participant's room open and wallet unlocked before preparing a transaction. Once prepared, move through the signatures and submission consecutively; the frozen transaction has a short lifetime.

## Test 1: Alice and Bob, using the existing room

1. Open the [existing Alice/Bob room](https://barterbook-devnet.rileycreighton.workers.dev/#/room/4cff89cad977b4c3d0c50c8d8f6faeb89542ad9a73b49b13) in both profiles. At deployment, version 6 was still marked `SIGNING`, with no stored signatures or transaction ID.
2. In either profile, click **Reconcile original status**. Wait for the app to establish that the original expired without landing and display **Original attempt reconciled** / the renewal controls. If the outcome remains unknown, report the displayed message before creating a replacement.
3. In one profile, click **Refresh fees and preview renewal**, review the preview, then **Create revision for everyone to review**. This should create version 7 if nobody has renewed it in the meantime. Reuse the room; it has no source-listing dependency that requires rebuilding the offer.
4. Confirm the terms: Alice gives **10 TEST-A + 5 TEST-B**; Bob gives **20 TEST-C** and pays the network fee. With the current 1% token fees, Bob receives **9.9 TEST-A + 4.95 TEST-B**, and Alice receives **19.8 TEST-C**.
5. In **both** profiles, check the review box, click **Accept exact terms**, then **I’m ready**. If the page was refreshed after preparation, use **Confirm this browser’s review** to restore that browser's local review.
6. Once both participants show ready, click **Prepare one transaction** once, in Bob's window.
7. Bob clicks **Verify and sign in wallet**, reviews the transaction in Solflare and approves. Wait for BarterBook to show **Your signature is saved** or **Signature verified and saved for the frozen message**.
8. Alice clicks **Verify and sign in wallet**, approves in Solflare, and waits for her saved-signature confirmation.
9. In Bob's window, click **Submit signed exchange**. Keep the room open until **Receipt verified** says **finalized**. If necessary, use **Reconcile original status** to check the same submission.
10. Open the shareable receipt and download its public evidence. Finish this exchange before preparing the three-person exchange, since the same owners cannot have overlapping unresolved attempts.

## Test 2: Alice, Bob and Carol

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
6. Bob clicks **Prepare one transaction** once. Sign in sequence: **Bob → Alice → Carol**, waiting for the saved-signature confirmation after each approval.
7. After all three signatures are saved, Bob clicks **Submit signed exchange**. Wait for the verified finalized receipt, then save its shareable link and download the evidence.

If either signing round fails or expires, keep its original room and reconcile that attempt. A fresh terms revision and new signatures are required for a replacement after safe expiry. If the altered-transaction error or earlier Devnet/Mainnet warning returns, stop at that point and report which participant, the exact text, and whether the app saved the signature. Do not change networks to proceed.
