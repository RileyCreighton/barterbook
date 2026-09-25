# Solflare Devnet nonce network warning

## Confirmed September 25, 2026

Bob's one-time signing setup finalized on Devnet. Version 10 uses its durable nonce, with no stored exchange signatures at the diagnostic snapshot. Two independent configured providers identify as Devnet and confirm the exact nonce and Bob's authority. [Original attempt evidence](../evidence/hosted/browser-v10-devnet-nonce.json).

The network warning was then reproduced without sending any owner transaction to Solflare's external service. Initial unsigned transactions with random unfunded addresses reproduced the warning when using a nonce. [Synthetic checks](../evidence/hosted/solflare-synthetic-nonce-check.json). These alone would not establish valid-chain compatibility.

A stronger control used the project's pre-existing disposable SDK wallet `5LjQfnCwojPVdqHYjdmZzdnyhzSNottxSZSBGwVkqvAV`. Its signing account was created through the normal authenticated setup API, with signed bytes journaled before broadcast. Setup finalized, holding 1,056,640 Devnet lamports in the account and charging a 5,000-lamport network fee. A lagging finalized read initially returned RPC -32016; the same original operation was reconciled, without replacing or re-signing it.

The unsigned test was a zero-value self-transfer preceded by the exact nonce-advance instruction. The configured Devnet RPC simulated it successfully with `replaceRecentBlockhash: false` and `sigVerify: false`. The nonce account was also independently visible at the public `api.devnet.solana.com` endpoint. No test exchange was signed or broadcast.

Solflare's `https://activity-api.solflare.com/v3/simulations/static-and-dynamic` service was given `network: "devnet"` and `method: "signTransaction"`, using only this developer-controlled fixture:

| Transaction | Compiled-message request | Wire-transaction request |
| --- | --- | --- |
| Ordinary Devnet blockhash, zero-value self-transfer | Simulation succeeded; unknown-site warning only | Same |
| Valid Devnet nonce, legacy message | Blocked as a Mainnet network mismatch | Same |
| Valid Devnet nonce, v0 message | Blocked as a Mainnet network mismatch | Same |

[Full sanitized valid-account comparison](../evidence/hosted/solflare-valid-devnet-nonce-check.json).

This establishes a reproducible misclassification in the tested Solflare simulation service. It does not establish the implementation defect inside that closed service, nor explain every earlier warning on short-lived attempts. Adding an arbitrary network field to the injected request is not an established fix: the inspected official 2.28.1 extension forwards only the transaction/message and reads its own configured network for simulation. Both public signing payload paths and both transaction versions were tested.

## Owner rehearsal outcome

The owner subsequently reported successful Phantom signing. [Independent checks against both configured Devnet providers](../evidence/hosted/browser-v10-finalized-verification.json) establish that the same version 10 attempt finalized at slot **504129295**, **2026-09-25 19:00:02 UTC**. Both signatures verify, the finalized bytes match the frozen message, and every expected token-account delta matches. The chain establishes settlement; the wallet application's identity comes from the owner report.

[The room and attempt are finalized, with two stored signatures and no remaining locks](../evidence/hosted/browser-v10-finalized-database.json). Bob's nonce was consumed and his signing account remains under his authority. No replacement attempt, message-verification relaxation, network switch or new owner setup was needed for this success.

Continue with [the three-person rehearsal](browser-transaction-retest.md#next-test-alice-bob-and-carol), using Phantom on Devnet for the same Alice, Bob and Carol addresses and Bob as fee payer. The [three-person browser settlement subsequently finalized](browser-execution-evidence.md). There is no automatic fallback prompt or automatic wallet switch.

For future prepared durable attempts, the app review period does not revoke saved signatures. Cancellation must be signed by the fee payer using a compatible wallet and the original outcome reconciled before renewal. Solflare's cancellation request uses a nonce too and may hit the same simulation limitation. No owner attempt or lock was manually changed during this diagnosis.
