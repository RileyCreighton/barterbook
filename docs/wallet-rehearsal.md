# Devnet wallet setup and demo rehearsal

A judge can review the app without a wallet. The separate live-signing rehearsal needs three **new, authorized, disposable devnet wallets**. Existing balances and real PRE tokens are outside this fixture exercise. No purchase or transfer of user assets is needed.

## Create Alice, Bob and Carol in Chrome

**Concrete candidate: the Phantom Chrome extension.** Its official setup and devnet controls are documented below. Its partial-signature behavior with this app is **untested until the rehearsal succeeds**. Installation is not a compatibility claim.

1. Open desktop Chrome. Click the **profile picture/icon at the top right → Add Chrome profile** (sometimes **Add**). Choose **Continue without an account** when offered; a separate Google login is unnecessary. Name it **BarterBook Alice**, choose a distinct color, and finish. Repeat for **BarterBook Bob** and **BarterBook Carol**. Use three normal profile windows, not three tabs in one profile. [Google's profile instructions](https://support.google.com/chrome/answer/2364824?hl=en).
2. In **Alice's new window**, type [phantom.com/download](https://phantom.com/download) directly. Choose **Download for desktop → Chrome → Add to Chrome** and confirm the browser's installation prompt. Use the puzzle-piece Extensions menu to pin Phantom. Repeat the installation separately in Bob and Carol. The official download page links to the legitimate store listing. [Phantom's installation guide](https://help.phantom.com/articles/4412436271635).
3. In Alice, open the Phantom toolbar icon. Choose **Create a New Wallet → Create a Recovery Phrase Wallet**. Set a local extension password; privately write the new recovery phrase offline, confirm it is saved, and complete the username/Continue/Get Started screens. Repeat with a **different new wallet** in Bob and Carol. Do not select “I Already Have a Wallet,” import an existing recovery phrase, or restore a funded wallet. Do not share the phrases or passwords with the app or developer. [Official new-wallet steps](https://help.phantom.com/articles/45135465489555).
4. In **each** Phantom extension, click the **profile avatar at upper left → Settings → Developer Settings → Testnet Mode**. Turn it on, then choose **Solana Devnet** for Solana. Check the test-network banner. **Leave Auto-Confirm on localhost off** so every rehearsal approval is visible. Solana Testnet is a different network; choose Devnet specifically. [Developer settings](https://help.phantom.com/articles/28951369255699), [test-network selection](https://help.phantom.com/articles/use-testnets-in-phantom-5997313271699).
5. Return to the wallet **Home → Receive** and use the **copy icon** for its **Solana** address. Paste only that public address into a small record labeled Alice, Bob or Carol. Check the three addresses differ. The address can be shared; the recovery phrase cannot. Do not copy an Ethereum address or Cash account. [Official address instructions](https://help.phantom.com/articles/view-your-wallet-address-in-phantom-28355153389075).
6. Give the developer only those three labeled public addresses and confirm they are new disposable devnet test wallets. Also record the extension version from `chrome://extensions` → Phantom → Details, and Chrome's version from its About page. No purchase is needed; fixtures use only authorized faucet funds.
7. In each profile, open **the same [public devnet app](https://barterbook-devnet.rileycreighton.workers.dev)**, or `http://localhost:5173` for a separately configured local run. Keep that origin identical throughout the signing attempt. Click the app's wallet connection and choose Phantom. Confirm the connected address matches that profile's record and the app says devnet. Separate profiles keep extension wallets and the app's session cookies separate. Profiles on one computer are still controlled by that computer's user; this is a controlled test, not three independent customers. Settlement on the public app is currently disabled pending funded fixtures and the hosted CPU gate.
8. Sign the app's origin-bound login challenge in each profile. Then test sign-without-broadcast on the immutable two-owner message. A wallet that only sends transactions, changes the message, or loses earlier signatures cannot pass this flow. Stop and record the result rather than bypassing the verifier.

Fixture preparation uses the current [devnet script guide](../scripts/DEVNET.md) and those authorized public addresses. Validate all three mock mints through actual devnet compatibility transfers before registering them. Local LiteSVM addresses are not public devnet assets. Label every fixture as a mock token, never a PRE holding.

If faucet funding is unavailable, keep settlement disabled and show the local evidence. The recorded earlier public request failed and its reconciliation showed zero funds. Follow any newer journal/evidence rather than issuing blind repeat requests.

## Rehearse the two-for-one basket first

Agree a two-owner package with three distinct validated mints. Review exact gross debits, issuer fees, recipient net amounts, fee payer, network-fee cap and any ATA rent. Each browser must verify the full message before its wallet prompt. Sign in A, then B; earlier signatures and the message hash must remain unchanged. Each signature is to the same transaction, not three separate sends.

Before broadcast, the durable attempt must contain full signed bytes, locally derived identifier, blockhash/lifetime and submission-started state. Open the resulting receipt only after its own transaction metadata verifies the agreed raw deltas. Record its real devnet explorer link and actual finality; current wallet balance changes are not receipt proof.

Then rehearse the three-owner fixed-lot cycle. Each incoming **net** must meet that participant's minimum; all three sign the same message. There are no partial fills, four-owner rings or five-distinct-asset baskets in this release.

## Rehearse failure and recovery

Using authorized fixtures, cover a rejected prompt, a reload after one signature, and a timeout after a send that may have succeeded. Recover the original attempt by its stored identifier. A UI cancel cannot revoke distributed signatures. A preflight error, timeout or new blockhash is not permission to make another executable attempt. New signatures follow only finalized onchain failure or authoritative reconciliation of expiry, including possible earlier success.

The public devnet script's deliberate failing-final-leg case uses **existing token accounts**. If executed, retain its transaction-specific metadata showing the final transfer failed and all intended raw token deltas stayed zero; the network fee may still apply. This case does not test rollback of newly created ATAs. Rollback of both token effects and new receiving-ATA creation is currently proven only in the isolated local LiteSVM run. Record any future public test of missing-account rollback separately. No public controlled-failure execution is claimed yet. Complete the detailed [wallet and evidence checklist](evidence-and-wallet-smoke.md).

## Record the judge walkthrough

Use the [2:50 pitch outline](pitch-outline.md). Open the app logged out, show the illustrative basket and cycle, then the clearly labeled actual local execution evidence. If live devnet runs later succeed, use their real receipts and exact tested wallet versions. Do not present SDK or local signatures as browser proof. Hide secrets, unrelated tabs and wallet recovery material. Record transparent cuts; never imply a failed or unexecuted exchange settled.

Before sharing, play the whole recording, verify it is under three minutes, test every actual source/demo/video link logged out, and count the [submission descriptions](submission.md) again. Creating a video or draft does not authorize submitting the entry or messaging anyone.
