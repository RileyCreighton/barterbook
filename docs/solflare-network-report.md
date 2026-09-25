# Solflare Devnet signing diagnostic — prepared, not sent

This report is ready for the owner to review and send through official Solflare support. No support message or public issue has been submitted.

## Observed problem

In Solflare **2.28.1**, installed from the official Firefox listing in Zen, the owner can view the correct disposable wallet's Devnet SOL and sign BarterBook login messages. A transaction approval instead displays:

> Network mismatch. Your current network is set to devnet, but this transaction is for mainnet. Switch to the correct network before signing.

The owner did **not** switch to mainnet. No transaction signature was saved for this attempt. After the prompt was closed, the application conservatively reconciled the original attempt as expired and unlanded. This is not an onchain failure or completed browser exchange.

## Reproduction and expected behavior

1. Use separate authorized disposable Devnet wallets with test SOL and Token-2022 mock inventory.
2. Connect Solflare using Wallet Standard and complete signed-message authentication.
3. Accept a two-owner basket: Alice gives 10 TEST-A plus 5 TEST-B; Bob gives 20 TEST-C and pays the network fee. Every token has a 1% transfer fee, producing net receipts of 9.9 A, 4.95 B and 19.8 C.
4. Prepare one legacy transaction using a Devnet blockhash. Independently validate its instructions against accepted terms.
5. Bob requests `solana:signTransaction` with `chain: "solana:devnet"` and the unchanged transaction bytes. Other required signature slots are still empty.
6. Solflare opens the mismatch warning instead of permitting the expected Devnet partial signature.

Expected: a sign-only approval for the current Devnet message, preserving the exact message and other signature slots. The application must durably save the complete signed transaction before any broadcast; a wallet integration that broadcasts during signing is unsuitable.

## Public evidence

- [Frozen-message network and recovery checks](../evidence/hosted/solflare-network-diagnostic-256c575e.json): both independently configured RPC providers return the Devnet genesis identifier and the exact frozen blockhash at its context slot. Version 5, attempt `256c575e-b91b-4414-96da-ac9d8587129f`, is safely expired with zero saved signatures and a null transaction ID.
- [Static package review](../evidence/hosted/solflare-2.28.1-compatibility-review.json): official Mozilla package and source-file hashes; no installed wallet files were accessed.
- [Hosted request timing](../evidence/hosted/cpu-2026-09-25T09-51-25.797Z.json): transaction preparation succeeded; no signature-upload request appears in the recorded window.
- App: https://barterbook-devnet.rileycreighton.workers.dev
- Source: https://github.com/RileyCreighton/barterbook

The public extension wrapper validates the Wallet Standard chain but does not forward it into the background request. The extension also reads its configured network and sends that cluster to its simulation service, so the omitted field alone does not establish the warning's cause. No secure application workaround is established by this inspection.

The background sign-only handler also forwards bytes to a vendor RPC proxy using a sign-specific header. Static inspection cannot establish whether that proxy records or broadcasts them. Please confirm whether this version supports partially signed multi-owner transactions without broadcasting, and how a dapp should explicitly select Devnet through Wallet Standard.

Only public addresses, transaction references and sanitized diagnostics are included. Do not attach recovery phrases, private keys, authentication cookies, provider endpoints or private wallet storage to a support request.
