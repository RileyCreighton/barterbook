# Execution evidence and browser-wallet smoke checklist

This ledger separates recorded local results from the remaining public-network and browser-wallet checks. Automated SDK signatures do not establish browser-wallet compatibility; local execution does not establish devnet execution; devnet fixtures do not establish PRE holdings or mainnet execution. The unchecked sections below are the remaining live-wallet acceptance checklist, not a statement that the automated equivalents are absent.

## Evidence ledger

The earlier recorded local run passed **110 tests across 13 files**; [its machine-readable report](../evidence/test-results.json) retains that historical run. The production build also passed. The later published-build checkpoint below records GitHub CI separately. Further changes require their relevant checks again; an older report does not prove a newer build.

| Run | UTC time | Environment | Evidence | Result and limits |
|---|---|---|---|---|
| Two-for-one basket | See artifact `executedAt` | Local LiteSVM 0.8.0; SDK signers | [Program execution](../evidence/local/litesvm-execution.json) | Three fee-aware transfers, two signatures on one message, three receiving ATAs created; passed. 774-byte wire. |
| Three-owner exact-lot exchange | See artifact `executedAt` | Local LiteSVM 0.8.0; SDK signers | [Program execution](../evidence/local/litesvm-execution.json) | Three signatures preserve one message; exact recipient nets and withheld fees checked; passed. 870-byte wire. |
| Deliberately failing final leg | See artifact `executedAt` | Local LiteSVM 0.8.0 | [Program execution](../evidence/local/litesvm-execution.json) | Final transfer failed; all token changes and receiving ATA creations rolled back. Local transaction fee remained charged. |
| Compatibility gate | 2026-09-25 04:46:22 | Local binary account fixtures | [Compatibility tests](../evidence/compatibility-tests.json) | 27 checks passed, including exact u64 amounts and rejecting unsupported mint/account extensions. No RPC calls. |
| No-wallet UI review | 2026-09-25 04:51:43 | Local app, Codex in-app browser | [Browser review](../evidence/local/browser-ui-smoke.json) | Six checks passed, including local evidence in walkthrough step 4. No wallet extension was available. |
| Worker/API smoke | 2026-09-25 04:57:06 | Local workerd and migrated D1 | [Worker smoke](../evidence/local-worker-smoke.json) | Authentication, replay rejection, session persistence, privacy and public endpoints passed using an ephemeral SDK identity. |
| Early Worker CPU profile | 2026-09-25 04:33:49 | Local workerd | [Sampling profile](../evidence/workerd-cpu-profile.json) | About 4.74 ms sampled active CPU per strict three-owner verification in a warmed batch. Hosted/full-request Free-tier headroom remains unverified. |
| Devnet faucet reconciliation | 2026-09-25 04:25:20 | Public devnet; new disposable wallet | [Faucet](../evidence/devnet-faucet.json), [follow-up](../evidence/devnet-faucet-reconciliation.json) | One faucet request failed; finalized balance was zero and signature history empty. No fixture mint or exchange was broadcast. |
| Public devnet two-for-one basket | 2026-09-25 07:35:24 captured | Public devnet; developer-run SDK signers | [Receipt](../evidence/devnet/20260925-sdk-proof-01/devnet-two-for-one-receipt.json), [raw transaction](../evidence/devnet/20260925-sdk-proof-01/devnet-two-for-one-transaction.json), [signing](../evidence/devnet/20260925-sdk-proof-01/devnet-two-for-one-sdk-signing.json) | Finalized; three exact fee-aware legs, two signatures over one message; 774 bytes; `10000` lamports network fee. Not browser-wallet proof. |
| Public devnet three-way exchange | 2026-09-25 07:35:32 captured | Public devnet; developer-run SDK signers | [Receipt](../evidence/devnet/20260925-sdk-proof-01/devnet-three-way-receipt.json), [raw transaction](../evidence/devnet/20260925-sdk-proof-01/devnet-three-way-transaction.json), [signing](../evidence/devnet/20260925-sdk-proof-01/devnet-three-way-sdk-signing.json) | Finalized; three signatures preserve one message; exact net deltas verified; 870 bytes; `15000` lamports network fee. |
| Public devnet final-leg failure | 2026-09-25 07:35:40 captured | Public devnet; developer-run SDK signers | [Receipt](../evidence/devnet/20260925-sdk-proof-01/devnet-atomic-last-leg-failure-receipt.json), [raw transaction](../evidence/devnet/20260925-sdk-proof-01/devnet-atomic-last-leg-failure-transaction.json), [signing](../evidence/devnet/20260925-sdk-proof-01/devnet-atomic-last-leg-failure-sdk-signing.json) | Finalized failure: instruction 7, custom error 1; all intended raw token deltas zero; `15000` lamports fee. Existing accounts only; no public new-ATA rollback claim. |
| Browser wallet signing and recovery | pending | Authorized devnet wallets in actual extensions | No live-wallet proof yet | Requires message signing, partial signing, unchanged bytes and cancel/reload/recovery checks. |
| Hosted demo HTTP checks | 2026-09-25 06:51:46 | Public Cloudflare Worker and D1 | [16-check report](../evidence/hosted/http-smoke-1790319106255.json) | Public endpoints, SDK authentication/session controls and legal downloads passed. No browser-extension signing or onchain exchange. |
| Hosted financial CPU | pending | Cloudflare Worker | No full-path CPU proof | Telemetry access returned 403; deployment and HTTP success do not establish CPU headroom. |

Local LiteSVM signatures identify executions inside that isolated runtime; they have **no public explorer page**. Its account effects come from actual local program execution. They are not manufactured public `getTransaction` responses. Public settlement receipts must independently pass the transaction-metadata checks below.

Store shareable evidence under `evidence/local/`, `evidence/devnet/` and `evidence/mainnet/`, keeping the environment explicit. Existing top-level evidence files retain an explicit scope. Do not add wallet secrets or full provider endpoints. Keep signed transaction bytes in durable attempt storage; publish historical bytes only after resolving their lifetime/outcome and deciding that the disclosure is intended. Record commit/build, wallet and browser versions, attempt ID and transaction ID for each future live signing run.

### Published-build checkpoint — 2026-09-25 06:58 UTC

The [public devnet demo](https://barterbook-devnet.rileycreighton.workers.dev) and [source repository](https://github.com/RileyCreighton/barterbook) are accessible. [First GitHub CI](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100) passed **143 tests** for initial commit `629ed20`, alongside its production build and local migration checks. All six migrations were applied to remote D1. Hosted desktop/mobile no-wallet walkthrough checks passed; the separately saved HTTP report above covers 16 real hosted checks using an ephemeral SDK identity.

At that initial checkpoint, the fixture payer was at zero faucet SOL, `DEVNET_ASSETS_JSON` was `[]`, and settlement was disabled. There was no browser-extension signature round trip, public devnet settlement receipt, or hosted financial-path CPU proof. Telemetry returned HTTP 403. The GitHub `devnet` environment had nine variables and the account-ID secret; its deployment API-token secret was still missing. This snapshot is preserved; the later execution checkpoint below supersedes its funding and SDK-settlement status.

### SDK devnet execution checkpoint — 2026-09-25 07:35 UTC

The three public devnet executions listed above are finalized. Their artifacts retain the full transaction metadata, original signed bytes, exact raw deltas and hashes after each SDK signature. The [basket](https://explorer.solana.com/tx/4TLQ55rcPS79kRAQTw52JH2SRTodvH5UzQgeczaRngpbHqu7YBqzfifr126N1BK8cD9GqDhAegdsKr3ofyKgPrP9?cluster=devnet), [three-way exchange](https://explorer.solana.com/tx/3YfomqM1UoyqHkqobn2sUQYMoLh5CcUMsecsbF6o4Zcrrjvzbfsp4E1A6a54etPxcuSvT5z1LXmjmzHVy6coWsC2?cluster=devnet), and [controlled failure](https://explorer.solana.com/tx/Egor5yrT3AXee5otWCdZi1ufCfmqNKBBYVZohAsELwfhzQDbeBycNEY3XZXjjbtrSSRai4dGd88XNnoHB8YyNj6?cluster=devnet) have real devnet explorer records. They were developer-run SDK tests with disposable faucet-funded wallets, not transactions signed by browser extensions or settled through the hosted app.

All three [mock mints](../evidence/devnet/20260925-sdk-proof-01/assets.json) passed actual compatibility transfers. Nine inventory operations finalized, giving each browser participant 1,000 TEST-A, 1,000 TEST-B and 1,000 TEST-C. A separate [finalized funding receipt](../evidence/devnet/20260925-sdk-proof-01/browser-sol-alice-carol-01-receipt.json) records `50000000` lamports each to Alice and Carol from the authorized SDK faucet wallet, with a `5000`-lamport fee; Bob already had faucet funding.

Alice's connection and authentication success is user-reported only. Independent server-side inspection of that browser session was blocked by Cloudflare management error `7403` (“no accounts”). The live registry remains `[]` and settlement disabled: Cloudflare account access currently blocks registering the validated mints, and re-login was requested. Hosted financial CPU remains unmeasured. The focused script suite now passes **35 tests**, including **14 new helper regressions**; a new complete suite/CI run has not yet been recorded at this checkpoint. The initial 143-test CI remains historical. Browser partial signing, hosted settlement and recovery must still pass their own checklist below.

### Hosted registry and browser preparation — September 25, after 07:56 UTC deployment

Cloudflare account access is restored and correct-account D1 reads work. Deployed commit `b02e90b`, Worker version `69e2cdac-ab4d-423b-a424-837d799b1066`, now serves three validated mock mints, six demo participants and SDK execution evidence. [Sixteen new hosted HTTP checks passed](../evidence/hosted/http-smoke-1790323034655.json). [SDK board seeding through normal authenticated APIs](../evidence/devnet/20260925-sdk-proof-01/board-hosted-judge-01.json) created three open exact-lot listings and a separate basket room; it did not accept terms or settle automatically.

[Browser preparation evidence](../evidence/hosted/browser-preparation-2026-09-25T08-07-31.122Z.json) records independently found authentication records for all three browser wallets, alongside the user's report of successful Phantom logins and portfolios with 1,000 of each test token. Alice created a browser offer for 10 TEST-A + 5 TEST-B against 20 TEST-C, with Bob as fee payer; its D1 terms were independently checked. Acceptance/readiness and transaction signing remain pending. Authentication is not a transaction-signing proof.

The owner confirmed Workers Free, dashboard allowances of 100,000 requests and 200,000 events, and reports `GET /holdings` CPU of 2 ms. This is a dashboard report, not automated raw telemetry or financial-path CPU evidence; telemetry API access still returns 403. Settlement remains disabled. New wallet account-list handling, stale-cookie identity protection, mobile overflow and dated expiry fixes are locally verified but await deployment. The latest validation passed 177 tests and a separate corrected eight-test hosted-rehearsal suite, plus production build; the combined CI run is upcoming. Earlier blocked-account and empty-registry checkpoints above remain historical.

## Authorization and network gate

- [ ] Test wallets are explicitly authorized, isolated demo wallets. Record public keys and authorization, never seed phrases or private keys.
- [ ] The app, registry, database records, RPC cluster and explorer links all name the same environment.
- [ ] Test mint names say “test” or “devnet”; no fixture is presented as a real PRE balance.
- [ ] No existing user assets or paid service are used without explicit authorization.
- [ ] Before any real PRE test, review the issuer's current [legal eligibility terms](https://prestocks.com/faq?tab=legal), confirm each actual participant is eligible, obtain authorization for assets/fees, and verify current mint state. Do not infer eligibility from a connected wallet or faucet funding.
- [ ] Mainnet settlement stays disabled until its separate gates pass. Three validated devnet assets do not validate the three mainnet PRE assets.

## First signing milestone: two owners

1. Record wallet extension, extension version, browser/version, OS and public key for each isolated browser profile. Connect to devnet. Prove both message signing and sign-without-broadcast transaction signing are supported.
2. Authenticate with the origin/network/wallet-bound challenge. Confirm reuse, wrong wallet, wrong origin and expiry fail. Rejecting a login prompt must not create a session.
3. Use a fee-bearing test mint so a gross/net mismatch can be observed. Record mint address, owning token program, decimals, epoch, active/next fee schedules, account owners and raw balances.
4. Build the exact two-owner message. Record base64 message bytes/hash, signer order, fee payer, blockhash, last valid block height, total wire size and the allowed instructions.
5. Before opening either wallet prompt, run the browser verifier against accepted terms and current asset policy. Alter the recipient, amount, fee payer, blockhash or one instruction in a controlled test and verify the prompt never opens.
6. Sign in wallet A without broadcasting. Send the partially signed bytes to wallet B. Confirm A's signature survives B's signing. Verify both signatures over the original message and byte-compare the message before and after every round trip.
7. Persist the complete signed transaction bytes, locally derived identifier and lifetime; durably mark submission started before the RPC broadcast. Record observed ordering from database events or test assertions.
8. Submit the exact bytes, reconcile status, and obtain transaction metadata. Record the transaction-specific gross debits, net credits, encoded transfer fees, network fee and any created-account rent. A failed exchange may still pay a network fee.

## Required product executions

- [ ] **Two-for-one basket:** two owners; one gives two distinct tested mints; the other gives a third. Three agreed transfers succeed in one transaction. The same mint is not moved in both bilateral directions.
- [ ] **Three-way exchange:** three owners and three distinct tested mints; each signs the same message. Each incoming net amount satisfies that recipient's accepted listing minimum. Preserve the exact lots; do not partial-fill or divert surplus.
- [ ] **Three-wallet compatibility:** sign in two different orderings where supported; earlier signatures survive. A modified message invalidates all prior signatures, and a replacement requires all signatures again.
- [ ] **Account paths:** existing receiving account, missing receiving ATA and ATA created by another actor before broadcast. Wrong token-program account derivation rejects.
- [ ] **Atomic failure:** cause the final leg to fail with authorized fixtures. Confirm transaction metadata shows no intended token transfers or ATA creations persisted. Record actual network fee, which need not be zero.
- [ ] **Size/resource limit:** actual supported three-leg basket and ring fit 1,232 bytes and simulate within the accepted compute budget. Do not label a five-distinct-asset basket supported until all five mints pass independent validation.

## Recovery and concurrency

- [ ] Rejecting one wallet prompt retains a recoverable state; no automatic new message or debit appears.
- [ ] Stopping after one signature or all signatures retains the attempt and locks; the UI never says signatures were revoked.
- [ ] Inject a timeout after a successful send. Reload the browser/restart the Worker. Reconciliation finds the original success by its stored identifier, with no second executable attempt.
- [ ] Preflight failure, RPC error and HTTP timeout do not authorize a new blockhash. An earlier copy may have been broadcast elsewhere.
- [ ] At expiry, query history and transaction metadata before considering absence. Finalized height must exceed the stored lifetime. Unreliable or conflicting history keeps the attempt unresolved.
- [ ] A new attempt follows only finalized onchain failure, or expiry plus authoritative reconciliation of original absence. Previously landed success is recovered instead of retried.
- [ ] Two tabs racing to prepare a room cannot create competing active attempts. Duplicate signature/submit calls are idempotent.
- [ ] An offer counteroffer changes the accepted revision and invalidates earlier acceptance. It does not erase a live signed attempt's recovery records.

## Receipt proof

For each actual settlement, retain cluster, signature, slot, confirmation/finality, accepted terms hash, frozen message hash and `getTransaction` response or a minimally redacted copy. Verify `meta.err` is null and that its message is the stored message. Map pre/post raw token balances by account index/address and mint; a missing pre-balance is zero only where creation in that transaction is established. Never infer a receipt from current wallet balances.

Check exact source gross debits and destination net credits against terms. Report checked issuer fees separately from `meta.fee` and ATA funding. If metadata is unavailable or inconsistent, show “confirmed; receipt verification pending” and retain the identifier. Failed metadata never produces a “settled” badge. Include an explorer URL with the correct cluster, e.g. `https://explorer.solana.com/tx/<signature>?cluster=devnet` only for devnet.

## Hosted no-wallet check

- [ ] Public URL loads in a fresh logged-out browser with no wallet extension.
- [ ] Board examples, walkthrough, evidence labels and real recorded receipts are distinguishable.
- [ ] Client bundle, source, screenshots and logs contain no RPC/API credentials, wallet secrets or session tokens.
- [ ] Active rooms poll briefly; polling stops or slows when hidden, inactive or terminal.
- [ ] Source/setup links and pitch link open without the developer's login.

Solana's [partial-signing documentation](https://solana.com/docs/core/transactions/partial-signing) describes verification against identical message bytes. [Historical signature status](https://solana.com/docs/rpc/http/getsignaturestatuses) and [transaction metadata](https://solana.com/docs/rpc/http/gettransaction) are separate checks from wallet balance refreshes. The stricter recovery requirements here implement this project's acceptance specification.
