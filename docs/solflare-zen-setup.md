# Use the existing devnet wallets with Solflare in Zen

**September 25 signing repair:** The newer version 6 report is an altered-transaction rejection after Bob approved Solflare’s default prompt. D1 shows no saved signatures or transaction ID. A [transaction-message signing repair](solflare-transaction-signing.md) is prepared: all 262 tests, typecheck, production build and release scan pass. Publication/deployment awaits explicit approval after automatic review rejected the direct main-branch push; the live app is unchanged. Actual extension settlement still needs the owner-controlled rehearsal. The version 5 network-warning investigation below is historical and does not diagnose this new error.

This is the current alternative being evaluated after Phantom could not load balances with BarterBook closed, including after a full Zen restart. **Solflare's complete BarterBook signing workflow is not yet verified.** No Chrome test was performed; see the [owner-report correction](../evidence/hosted/browser-second-attempt-owner-report-correction-77036da8.json).

**Current Solflare-in-Zen checkpoint:** the owner reports that all three wallets use the official Solflare Firefox extension in their existing Zen profiles, show their exact original public addresses, and complete BarterBook login. Displayed Devnet balances are Bob **1 SOL**, Alice **0.05 SOL** and Carol **0.05 SOL**. These extension and login observations are owner reports, not a new independent D1 authentication verification.

The [latest independent D1/RPC diagnostic](../evidence/hosted/solflare-network-diagnostic-256c575e.json) records actual terms **version 5**, attempt `256c575e-b91b-4414-96da-ac9d8587129f`. The owner reports Bob’s **Solflare 2.28.1 in Zen** displayed “Network mismatch”: current network Devnet, transaction Mainnet. No signature was stored. After the prompt was closed and reconciliation ran, D1 independently showed `EXPIRED_UNLANDED`, `safeToRetry: true`, a null transaction identifier and complete absence checks from both trusted histories. Both providers returned the full Devnet genesis and the frozen blockhash matched its context-slot block. This establishes the blockhash’s Devnet origin, not the warning’s cause. [Static inspection of the public Solflare package](../evidence/hosted/solflare-2.28.1-compatibility-review.json) establishes no secure workaround or definite cause; it does not test installed wallet state or execute the package. Complete browser compatibility and a new receipt remain unestablished. No Chrome test occurred. Preserve the original and investigate without switching to Mainnet or bypassing verification. The [version 3 safe-expiry record](../evidence/hosted/browser-third-attempt-reconciled-2383931c.json) remains historical evidence.

Solflare's [official download page](https://www.solflare.com/download/) links to its [Firefox extension published by Solflare](https://addons.mozilla.org/en-US/firefox/addon/solflare-wallet/). [Zen supports Firefox add-ons](https://docs.zen-browser.app/user-manual/extensions). These facts establish an installation route, not completed trading compatibility.

## Setup reference for the existing profiles

1. Keep the original Phantom extension and wallet available. Close BarterBook tabs and pending transaction prompts while checking the replacement wallet interface.
2. In Bob's Zen profile, install Solflare from the official Firefox listing above. Open its extension icon and choose the existing-wallet/recovery-phrase import option.
3. Enter **Bob's existing disposable test-wallet** recovery phrase privately inside that official extension. Never put it in chat, a screenshot, project files or the website. Set any extension password privately. Do not import a wallet containing real funds.
4. If multiple accounts appear, select the account whose full public address matches Bob below. Solflare documents **Advanced** account/derivation selection in its [recovery-phrase import guide](https://help.solflare.com/en/articles/16293240-importing-an-existing-recovery-phrase). If no account matches, stop and report only the visible nonsecret options or public address. Do not fund a different address to work around an import mismatch.
5. Choose **Settings → Network → Devnet**, then use **RECEIVE** to compare the full public address. [Network settings](https://help.solflare.com/en/articles/6328814-differences-between-mainnet-devnet-and-testnet-and-how-to-switch-between-on-solflare), [address instructions](https://help.solflare.com/en/articles/16233240-where-can-i-find-my-wallet-address).
6. Keep BarterBook closed and confirm Solflare loads Bob's 1 Devnet SOL. This checks the wallet's own connection independently of the application.

| Participant | Existing public address | Independently observed Devnet SOL |
|---|---|---:|
| Alice | `8B9FCGFGFjqqQhdkLSChG3Jxnjo4sLn3FdYjd18DeuTi` | 0.05 |
| Bob | `H8jpK2haGLYQDbNHsToFqxAXRmJQ6MwYvemw7wz5bBk8` | 1 |
| Carol | `EqEnSeX2UXqF2stBPK1WGULz5Shs6CWBcU9JRUdHAz5J` | 0.05 |

These are the [finalized balance observations at 09:25 UTC on September 25](../evidence/hosted/rehearsal-sol-balances-1790328303188.json), not proof that an extension displayed them. The balances cover the accepted test basket and planned rehearsals. No extra airdrop or SOL purchase was performed for this diagnosis. Restoring the same address does not transfer its assets.

## Connect and verify before another trade

After Bob's address and balance are correct, open the [existing hosted app](https://barterbook-devnet.rileycreighton.workers.dev), choose **Connect wallet → Solflare**, and approve the login message. A login message establishes identity; it does not authorize token transfers. If Solflare is missing from the picker, report that result: BarterBook only lists wallets advertising the required devnet, message-signing and legacy sign-only capabilities.

The latest attempted room terms were version 5. That attempt safely expired and reconciled after Solflare’s mismatch warning, with no stored signature or broadcast. Do not switch to Mainnet or bypass the strict verifier to continue. Preserve the attempt and wait for a supported next step from the investigation; a login or balance display is not proof of transaction compatibility. Any future renewal requires fresh consent and a new complete signature round only after the prior attempt is safely resolved.

The owner now reports these import/address/network and login checks completed for Bob, Alice and Carol in their separate existing Zen profiles. Do not repeat wallet imports just to follow this reference. If a further signing rehearsal becomes supported, explicitly select the intended wallet in each profile; no such workaround is established yet. Record the actual Zen and Solflare versions. Each participant reviews and accepts the same terms, then separately approves its transaction signature. Record a completed browser exchange only after the unchanged-message checks pass and transaction-specific metadata produces the actual receipt.
