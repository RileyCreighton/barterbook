# Common setup and demo problems

**September 25 signing repair:** The newer version 6 report is an altered-transaction rejection after Bob approved Solflare’s default prompt. D1 shows no saved signatures or transaction ID. A [transaction-message signing repair](solflare-transaction-signing.md) is prepared and passes focused local checks; actual extension settlement still needs the owner-controlled rehearsal. The version 5 network-warning investigation below is historical and does not diagnose this new error.

**Current Solflare-in-Zen checkpoint:** the owner reports that all three wallets use the official Solflare Firefox extension in their existing Zen profiles, show their exact original public addresses, and complete BarterBook login. Displayed Devnet balances are Bob **1 SOL**, Alice **0.05 SOL** and Carol **0.05 SOL**. These extension and login observations are owner reports, not a new independent D1 authentication verification.

The [latest independent D1/RPC diagnostic](../evidence/hosted/solflare-network-diagnostic-256c575e.json) records actual terms **version 5**, attempt `256c575e-b91b-4414-96da-ac9d8587129f`. The owner reports Bob’s **Solflare 2.28.1 in Zen** displayed “Network mismatch”: current network Devnet, transaction Mainnet. No signature was stored. After the prompt was closed and reconciliation ran, D1 independently showed `EXPIRED_UNLANDED`, `safeToRetry: true`, a null transaction identifier and complete absence checks from both trusted histories. Both providers returned the full Devnet genesis and the frozen blockhash matched its context-slot block. This establishes the blockhash’s Devnet origin, not the warning’s cause. [Static inspection of the public Solflare package](../evidence/hosted/solflare-2.28.1-compatibility-review.json) establishes no secure workaround or definite cause; it does not test installed wallet state or execute the package. Complete browser compatibility and a new receipt remain unestablished. No Chrome test occurred. Preserve the original and investigate without switching to Mainnet or bypassing verification. The [version 3 safe-expiry record](../evidence/hosted/browser-third-attempt-reconciled-2383931c.json) remains historical evidence.

| Symptom | Check and next action |
|---|---|
| `node:sqlite` missing or native module load fails | Use Node 26.8.2 and reinstall from the lockfile on the current OS with `npm ci --ignore-scripts`. Do not copy another computer's `node_modules`. |
| Page loads but API fails | Run the local Worker on 8787 and Vite on 5173. Open `localhost`, and ensure local `APP_ORIGIN=http://localhost:5173`. Built/hosted mode needs its actual origin instead. |
| Login rejected or no session | Check the exact origin, devnet selection, clock and one-use challenge. Use HTTPS when hosted. Do not disable origin/cookie checks or reuse a signed challenge. |
| No wallet shown | The embedded browser may have no extension. Open an isolated browser profile with a compatible Wallet Standard extension; the no-wallet walkthrough remains available. |
| Empty live board or asset registry | The hosted app now has three validated devnet mints. An empty local setup may still be expected; on the live site, refresh and inspect environment/API status before changing the registry. Examples remain labeled separately. |
| Wrong program, frozen account, active hook, memo requirement or scaled amount rejected | Treat this as the compatibility gate working. Fix the test fixture policy and revalidate; never remove checks to make the wallet prompt appear. |
| RPC 401/403/429 | Verify the server-only key and devnet endpoint privately. Observe free rate/credit limits. Preserve unresolved attempts. Do not expose the URL in frontend code or repeatedly send fresh transactions. |
| Faucet returns no funds | Inspect the original funding journal and finalized history. The current rehearsal already has verified faucet funding, including the [finalized Alice/Carol transfer](wallet-rehearsal.md#fund-the-rehearsal-without-four-separate-airdrops). Four separate airdrops and quota bypasses are unnecessary. Do not buy SOL or use an existing funded wallet. |
| Solflare says current Devnet / transaction Mainnet | Version 5 safely reconciled with zero stored signatures. Both independent RPCs verified the frozen blockhash’s Devnet origin; this does not explain the extension warning. Stay on Devnet and preserve the original; no verified workaround or browser settlement is claimed. |
| Alice sees “Not enough SOL” after Bob signs | Keep the original attempt; follow the [historical diagnostic and current Solflare path](#alice-gets-not-enough-sol-after-bob-signs). Do not buy SOL or prepare a replacement from this popup alone. |
| Wallet strips prior signatures or rewrites the message | Reject the response. Use a compatible sign-without-broadcast flow. A changed message requires all signatures again only after the previous attempt is safely resolved. |
| Submission timeout / room remains locked | Reconcile the stored transaction ID, lifetime and transaction metadata. It may already have succeeded. Never delete the attempt or manually unlock rows to force another trade. |
| Confirmed but receipt pending | Wait for consistent transaction-specific metadata. Keep the original identifier; current wallet balances cannot fill the gap. |
| Worker error 1102 / CPU exhausted | Disable new settlement while profiling hosted full paths. Preserve pending journals; optimize repeated work without weakening verification. Do not silently move to a paid plan. |
| Worker daily quota / D1 quota reached | Pause avoidable polling, keep unresolved attempts and wait for the provider reset or explicit plan approval. Database restoration is not a quota fix. |
| Cloudflare authentication or D1 placeholder error | Sign in to the intended account, create the database, and generate `.wrangler/deploy.json` with its actual UUID. A local database is not a remote database. |
| Cloudflare management read returns `7403` / “no accounts” | The earlier incident is resolved and all three browser authentication records were independently verified. If it recurs, [restore login in the correct Cloudflare browser/profile](#wrangler-login-opens-alices-zen-profile), then retry the read. This blocks independent D1 inspection; it does not by itself establish a hosted app or wallet-login failure. Preserve the existing deployed database and sessions. |
| Migration or deployment fails | Inspect the failed step. Earlier successful migrations can remain applied. Prefer a compatible forward fix; never restore old D1 state over executable attempts. See [deployment recovery](deployment.md). |
| GitHub Run workflow button missing | The manual workflow must exist on the repository's default branch. Check Actions permissions and environment settings. Do not enable automatic deployment as a workaround. |
| Source or legal link broken | Run the legal packaging step after building, redeploy the reviewed bundle, and publish the matching source revision. Verify exact links logged out. |

When reporting a problem, include build ID, environment, wallet/browser versions, error text and public attempt/transaction identifiers. Exclude keys, recovery phrases, cookies, provider URLs and unresolved signed transaction bytes.

## Wrangler login opens Alice's Zen profile

Choose the browser/profile already used for the Cloudflare account that owns the Worker. You do not need to change the default browser, wallet profiles, or Phantom's Devnet settings.

1. In the terminal waiting for the earlier login, press **Ctrl+C** once.
2. Run the following commands, then **leave this terminal open** for the local login callback:

   ```sh
   cd /home/riley/dev/barterbook
   npx wrangler login --browser=false
   ```

3. Copy the **entire generated `https://dash.cloudflare.com` OAuth URL** from the terminal. Paste it into the address bar of your normal Cloudflare browser/profile, instead of Alice's Zen profile. Do not send that URL in chat.
4. Sign into the Cloudflare account whose **Workers & Pages** page contains **barterbook-devnet**, then click **Allow** on the authorization page.
5. Wait for the terminal to say **Successfully logged in**. Report only that success; do not share authorization codes, tokens or other secrets.

The [`--browser=false` option](https://developers.cloudflare.com/workers/wrangler/commands/general/#login) prevents automatic browser opening while retaining the normal local callback flow. A wrong Cloudflare account/profile is separate from Phantom connectivity.

## Phantom warns that network balances or prices may be outdated

**Historical Phantom investigation; current path is [Solflare in Zen](solflare-zen-setup.md).** The warning about trouble updating networks points to Phantom's balance/price refresh; its exact cause is not established by the message. It is not a BarterBook transaction receipt or a reason to recreate a wallet. On September 25 at 07:16 UTC, the public app health check and its configured Helius Devnet reads succeeded; Alice still had zero finalized lamports. Phantom's [official status page](https://status.phantom.com/) reported the extension and Devnet nodes operational. These checks do not prove that Phantom can reach its own services from the user's browser.

**Later verified checkpoint:** Alice connected and authenticated while the banner persisted, including with all BarterBook tabs closed. The earlier Cloudflare `7403` management-access problem was resolved, and all three browser authentication records were independently found in D1. Authentication establishes neither complete partial transaction-signature preservation nor settlement compatibility. There is no need to reset a working wallet solely to remove the banner.

The earlier isolation procedure is retained below for context; the owner has since reported working Solflare logins for all three participants in Zen.

1. Stay in the existing **Zen** profiles. Close every BarterBook tab and transaction popup while app testing is paused; do not prepare, sign or submit a transaction during this check.
2. Open Phantom directly from its toolbar icon. Keep **Settings → Developer Settings → Testnet Mode → Solana Devnet** selected. Inspect **Home**, including the displayed SOL balance and any warning. [Official network instructions](https://help.phantom.com/articles/use-testnets-in-phantom-5997313271699).
3. Report the visible warning, whether balances load, and the public wallet address being viewed. Do not share recovery phrases, private keys or raw logs. Compare wallet display with separately recorded RPC evidence without treating one as proof of the other.
4. The owner is concerned app testing may affect Phantom. Closing the app is an isolation check, not a conclusion about cause. Do not reset the extension, import a wallet, install Chrome or create another attempt as part of this check.

## Alice gets “Not enough SOL” after Bob signs

In the earlier Zen/Phantom rehearsal, the owner reports Bob approved his transaction signature and Alice's popup then showed **“Not enough SOL”**, while Devnet was selected. The coordinator stored one signature for attempt `77036da8-52f3-4502-9f00-9929ac42a114`; it later [safely reconciled as expired and unlanded](../evidence/hosted/browser-second-attempt-reconciled-77036da8.json). Read that record’s withdrawn Chrome report alongside [its correction](../evidence/hosted/browser-second-attempt-owner-report-correction-77036da8.json). The [09:22 UTC diagnostic](../evidence/hosted/alice-phantom-sol-diagnostic-1790328122638.json) preserves the original identifier and message hash. This is partial progress, not a completed browser exchange.

Fresh finalized reads found Alice **0.05 SOL**, Bob **1 SOL**, Carol **0.05 SOL** and the disposable SDK reserve **0.86530616 SOL**, all on Devnet. The frozen message names **Bob** as fee payer, with `10000` lamports network fee and `6472800` lamports account rent. A read-only simulation using a temporary blockhash and disabled signature verification succeeded at **32,011 compute units**. The stored original message was unchanged, no new signatures were requested, and nothing was broadcast. That diagnostic cannot prove Alice's wallet accepts the message, nor can it replace the original transaction.

**Historical correction and isolation check:** the owner did not install or use Chrome, did not create Chrome profiles, and did not perform the previously reported Chrome restoration/balance check. That report is [withdrawn](../evidence/hosted/browser-second-attempt-owner-report-correction-77036da8.json) without overwriting the original record. The owner reported the warning in both Phantom wallets and chose to stay in Zen. This led to the Solflare alternative; it did not establish a successful Chrome test.

The following isolation steps were the earlier investigation, not the current setup instruction; use the [Solflare guide](solflare-zen-setup.md) now.

1. Pause app testing and close all BarterBook tabs and transaction popups.
2. Inspect **Phantom Home → Solana Devnet** in the existing Zen profiles, then report whether the balances and warnings change. No wallet import, browser change, new signature or transaction is requested.
3. Preserve the two safely reconciled attempts and their evidence. Do not buy SOL, request another faucet transfer, change the fee payer or weaken verification to bypass the popup.

Phantom's [supported-browser guidance](https://help.phantom.com/articles/48456789393811) recommends Chrome and says its Firefox extension no longer receives updates. This is provider guidance, not evidence of a Chrome test or a requirement to change browsers now. The [Chrome migration reference](wallet-rehearsal.md#optional-chrome-migration-reference) is optional only if the owner later chooses it. The precise cause of the warning, including any relationship to app testing, remains unproven.

## Faucet funding is separate from the Phantom banner

The [07:30 UTC funding snapshot](../evidence/devnet/20260925-sdk-proof-01/funding-checks/1790321412651-64ee1de1-bb5d-40e2-9441-9bf84909f095.json) verified 1 SOL finalized in the disposable SDK payer and 1 SOL in Bob's new devnet wallet. The [official faucet monitor](https://faucet.solana.com/monitor) identifies their source, `dev2JBjyB5CshoGsiJCwzdmJYiEUwAXMdqDR7txoFBJ`; [the attribution record](../evidence/devnet/20260925-sdk-proof-01/faucet-source-verification.json) connects that source to the exact credits. No balance-refresh banner changes these recorded transaction results.

The authorized helper transfer **finalized**, supplying Alice and Carol with **0.05 devnet SOL (`50000000` lamports) each** from the SDK faucet wallet, with a `5000`-lamport network fee. Bob received no top-up. The [verified receipt](../evidence/devnet/20260925-sdk-proof-01/browser-sol-alice-carol-01-receipt.json) and [devnet explorer transaction](https://explorer.solana.com/tx/5HQduJtbwwhr1sPLVg3sntjGbTn3gc39nzVntPJ7xTJASM2Q2bkTTnX5j9TDtQu8B7HCBUBXUxj94r5s2ACxmBCz?cluster=devnet) preserve the exact outcome; do not rerun it as a fresh transfer. Do not request four new airdrops or evade a rate limit. Built-in GitHub verification for a higher faucet quota is optional and unnecessary for the current plan.

Separately, all three [public devnet mock mints](../evidence/devnet/20260925-sdk-proof-01/assets.json) passed compatibility transfers. Nine finalized inventory operations issued 1,000 of each TEST-A/TEST-B/TEST-C to each browser wallet. This was SDK-operated setup. The SDK basket, three-way exchange and controlled final-leg failure subsequently finalized; their exact receipts are linked in the [evidence ledger](evidence-and-wallet-smoke.md). The complete browser signature round trip and settlement remain unproven. Phantom's displayed refresh state is not evidence that any of these transactions succeeded or failed.

## Remote migration reports incomplete SQL input

Cloudflare’s remote D1 statement splitter can misread an unparenthesized `CASE ... END` inside a trigger. The release migrations now use `SELECT (CASE ... END);` and LF endings, preserving their guard behavior. The initial remote application failed without creating application tables; all six migrations then applied successfully after this syntax-only correction. [Upstream issue](https://github.com/cloudflare/workers-sdk/issues/4727). Never remove financial triggers as a workaround. Inspect the migration table/schema before retrying; do not reset a database containing attempts.
