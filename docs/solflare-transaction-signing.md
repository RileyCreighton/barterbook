# Solflare transaction-message signing repair

## September 25 owner report and database check

Bob approved Solflare's default transaction prompt, without changing fees, and BarterBook displayed `Transaction contains altered or unapproved instructions/accounts/message`. The hosted version 6 attempt `1c3f8189-1965-4f10-9941-de24f53f768f`, in the existing Alice/Bob room, was independently read from D1: `SIGNING`, no saved signatures, null transaction ID, and `safeToRetry: false`. That snapshot does not establish an onchain outcome or authorize replacing the unresolved attempt.

The original unsigned message reconstructs exactly from the frozen plan and survives both legacy `Transaction` and `VersionedTransaction` SDK round trips unchanged. The returned browser transaction was not captured, so its exact changed fields are unknown.

## Public extension source findings

The [official Mozilla Solflare 2.28.1 package](https://addons.mozilla.org/firefox/downloads/file/4841247/solflare_wallet-2.28.1.xpi) was downloaded and inspected as text. No installed profile, keys or wallet storage were read, and extension code was not executed. The original hashes are recorded in [the earlier package review](../evidence/hosted/solflare-2.28.1-compatibility-review.json).

- `inpage.js`: Wallet Standard `solana:signTransaction` calls the provider's `signTransactionV2` request with a wire transaction.
- `static/2832.js`, module `78444`: wire-transaction simulation uses each simulation result's `enrichedTx` as `serializedTransactions`. Module `50093` signs those returned bytes. This exposes an automatic transaction-rewriting path even without a manual fee edit; it is consistent with the reported rejection, but does not establish the exact mutation in Bob's uncaptured response.
- `inpage.js`: the public provider's allowlist also exposes `request({ method: "signTransaction", params: { message } })`, where `message` is the base58 compiled transaction message. This is a transaction approval method, distinct from `signMessage`.
- `static/2832.js`, modules `48371` and `78444`: this message method retains transaction simulation and the approval screen, then signs the original message. It does not substitute `enrichedTx`. It returns a signature rather than a replacement transaction.
- `background.js`: the transaction-message method returns the signature and the injected wrapper includes the public key. The extension may also pass a transaction containing this one signature to its vendor proxy. Since BarterBook always requires two or three owners and sends no prior signatures through this method, this path cannot provide that proxy with all participants' signatures. Proxy behavior remains untested.

## Application change

For an explicitly selected Solflare wallet, the app binds the injected provider to the same connected public address, independently validates the original frozen wire against accepted Devnet terms, and requests a transaction-message signature. It verifies the returned address and Ed25519 signature against the exact original bytes, inserts only that owner's signature slot, and runs the existing complete message/signature checks. Provider identity and both wallet account representations are checked before and after approval. Previous signatures never leave the app through this method.

Other wallets keep the existing Wallet Standard path. A rejected or unsupported Solflare request is surfaced once; it does not trigger a fallback prompt. There is no use of authentication-message signing for a transaction, no network switch, no relaxed verifier, no change to transaction construction or settlement, and no automatic new attempt.

Regression tests use fake providers and real cryptographic signatures. They cover two and three owners with Bob as fee payer, preservation of all earlier slots and exact message bytes, wrong-message/wrong-key signatures, malformed responses, missing or mismatched providers, account changes during approval, cancellation, unaccepted terms, and other wallets' existing behavior. These tests do not establish actual Solflare extension compatibility or a browser settlement.

## Continue the owner-controlled rehearsal

After the repair is deployed, refresh both participants' app tabs so they load the updated signer. In the existing room, use **Reconcile original status** for version 6. Only after the server independently reports a safe terminal result, renew the terms using the existing room controls. Both participants must accept and mark ready for the new version; prepare once, then Bob signs first and Alice signs second. Keep Solflare on Devnet and review its normal transaction approval. Claim completion only after the app records the actual finalized receipt.

The earlier version 5 network warning is a separate historical observation. This repair does not establish that warning's cause. If it recurs, report it without switching networks.

## Release readiness

Commit `87e516e` passed all 262 tests across 22 files with one test worker, typecheck, production build and the release secret scan. [Sanitized readiness evidence](../evidence/local/solflare-transaction-signing-87e516e.json) records the original attempt snapshot and recovery bookmark. An initial automatic approval review required explicit publication authorization; the owner subsequently approved publication and deployment. The repair is now live as build `b45551b`, Worker `dd5624c1-15b3-4115-a30b-06cd53c31aba`. [Served-file verification](../evidence/hosted/solflare-signing-deployment-b45551b.json) passed and [CI passed all 262 tests](../evidence/local/ci-36166658227.json). Use the [two- and three-person retest guide](browser-transaction-retest.md) for the remaining real browser verification.

## Version 7 follow-up, September 25

The owner retried after refreshing both tabs and renewing the room, and still reported the altered-message error. A later retry displayed a Devnet/Mainnet warning. The saved version 7 message reconstructs exactly in Node and an isolated Firefox session. Both configured RPCs identify as Devnet and return the attempt’s exact blockhash at its recorded origin slot. By the read-only check, both providers had finalized beyond its last valid block height. These observations establish Devnet origin and later expiry, not the wallet warning’s cause, an extension signing pass, or safe replacement.

The follow-up adds an authenticated member-only signing-status read, checks Devnet genesis and current blockhash validity before opening the wallet, and provides an on-demand local message comparison plus network-status report. The report omits raw transaction bytes and signatures. It works after expiry, never authorizes a replacement, and leaves the attempt journal and locks untouched. Existing strict message/signature validation and original-attempt reconciliation remain required. Errors identify whether rejection occurred before the wallet, after approval, or during upload.

An optional comparison against Solflare’s external simulation service was blocked by automatic approval review because it would send transaction details to that service. No such request was executed; no cause is inferred from an unavailable result. The next useful evidence is Bob’s **Check transaction without signing** report from the existing room.

The follow-up is published and deployed as `a91581c622445627293782e74efec7880488dbd8`, Worker `75041df9-ac2f-48b2-ad30-eea7ed58f681`. All 272 local tests, production build and release scan passed. [Hosted verification](../evidence/hosted/signing-check-deployment-a91581c.json) matches every served JavaScript/CSS asset and the index to the tested build. No database migration or financial-state mutation was performed.

Bob subsequently copied the real browser report: exact message and term agreement, the expected Solflare transaction-message path, current connection, matching provider account, and a live Devnet status check reporting the expired blockhash. No signature was stored in that snapshot. This narrows the current diagnosis but does not prove what caused the earlier error or authorize replacement without reconciliation. [CI passed all 272 tests](../evidence/local/ci-36169861192.json).

A safer external comparison used only newly generated unfunded dummy addresses, a zero-value unsigned transfer, and a public Devnet blockhash. Both compiled-message and wire-transaction simulations returned no network-mismatch alert. Repeating the compiled-message simulation after the public RPC confirmed blockhash expiry also returned no network-mismatch alert. Both simulations failed because these were dummy accounts; this does not establish real wallet behavior. In particular, **expiry alone did not reproduce the warning**, so its cause remains unknown. [Sanitized synthetic comparison](../evidence/hosted/solflare-synthetic-network-check.json).
