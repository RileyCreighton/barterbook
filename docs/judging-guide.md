# Test BarterBook

**[Open the live demo](https://barterbook-devnet.rileycreighton.workers.dev/#/try)** · **[Recorded walkthrough](https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough)** · **[Verified browser trades](browser-execution-evidence.md)**

BarterBook is a working Solana Devnet demo. You can inspect the completed basket and three-person exchange without a wallet, or execute your own using Phantom and the self-service TEST-A/B/C faucet. The tokens have no monetary value and do not represent stock ownership.

## Explore in two minutes

1. Open the recorded walkthrough. Switch between the basket and the three-way match to see the exact transfers, fees and consent flow.
2. Open either **View verified receipt** link. Inspect its onchain slot, source debits, net receipts and network fee.
3. Download the original transaction evidence or open Solana Explorer. The evidence archive includes independent checks from two Devnet providers.
4. Open **Market**, **Matches**, and **Evidence** to explore the public app. Connecting a wallet unlocks Portfolio and private trade rooms.

## Get wallets and tokens

1. Use the Phantom browser extension. Enable **Settings → Developer Settings → Testnet Mode**, then select **Solana Devnet**. See [Phantom's testnet guide](https://docs.phantom.com/developer-powertools/testnet-mode).
2. Use separate browser profiles for two wallets (basket) or three (cycle). This keeps each participant's wallet and app session separate. You can operate all profiles yourself for the demonstration; no developer counterparty is required.
3. Create a fresh test wallet in each profile. Get at least **0.02 Devnet SOL per wallet** from the [Solana faucet](https://faucet.solana.com/). Its availability and limits are controlled by the faucet. Request Devnet, not Mainnet.
4. Open **Try the demo**, connect Phantom and approve the login message in each profile. This authenticates the wallet; it does not authorize a transfer.
5. Click **Get 1,000 TEST-A, TEST-B & TEST-C** and approve the separate token-setup transaction. It costs less than **0.01 Devnet SOL** to create the three token accounts and pay its network fee. Click **Check token request** after a few seconds until it is finalized, then refresh Portfolio.

The [live faucet check](../evidence/hosted/judge-faucet-live-check.json) finalized delivery of exactly 1,000 of each token into a fresh disposable wallet through the hosted API. The token faucet issues only the three supported mock mints. Its separate key has minting authority only; it cannot spend your tokens or SOL. The wallet pays setup rent and network fees. Rate limits allow eight preparations per wallet per day and impose a shared service limit. Private keys and recovery phrases stay in your wallet.

## Test a two-wallet basket

1. In Alice's profile, choose **Make a basket offer** and enter Bob's public wallet address.
2. Alice gives **10 TEST-A + 5 TEST-B**; Bob gives **20 TEST-C**. Select **Bob as fee payer** and longer-lived signing. Review and publish the exact offer.
3. Open the resulting shared room in both profiles. Each participant checks the review box, chooses **Accept exact terms**, then **I'm ready**.
4. Bob chooses **Set up signing in wallet** and approves the one-time Devnet transaction. Once **Signing account ready** appears, Bob chooses **Prepare one transaction**.
5. Bob chooses **Verify and sign in wallet**. Wait for his saved-signature confirmation. Alice then signs and waits for hers.
6. Bob chooses **Submit signed exchange** once. Wait for **Receipt verified · finalized**. The expected receipts are **9.9 A + 4.95 B to Bob** and **19.8 C to Alice**.

## Test a three-wallet match

Publish these exact lots through **Portfolio → Publish an exact lot**:

| Wallet | Gives | Wants | Minimum received after token fees |
|---|---|---|---:|
| Alice | 10 TEST-A | TEST-C | 29.7 |
| Bob | 20 TEST-B | TEST-A | 9.9 |
| Carol | 30 TEST-C | TEST-B | 19.8 |

Bob opens **Matches → Find current matches**, selects the **Three-way cycle** containing your three addresses, and chooses **Review in shared room**. Open that room in every profile. All three accept and mark ready. Bob's signing account from the basket is reused. Bob prepares once; sign **Bob → Alice → Carol**, waiting for each signature to save. Bob submits once and opens the finalized receipt.

The recorded demo participants are not automated market makers. Choose your own addresses in the match; a listed developer wallet cannot trade without its owner approving.

## If something interrupts the test

- **No holdings:** verify the same address and Devnet network, check the token request until finalized, then refresh Portfolio. Phantom may not display custom mock-token names; the app identifies them by their exact mint addresses.
- **SOL faucet unavailable:** try its published options or an existing faucet-funded Devnet wallet. Do not buy SOL for this test. The recorded walkthrough and verified receipts remain accessible without funding.
- **Token approval expires:** choose **Check token request**. An unsigned expired request allows a fresh preparation. A submitted request must be checked or resent using its original bytes.
- **Wallet mismatch:** reconnect the intended address in that profile and review the room again. Use Phantom for this release; the observed Solflare nonce simulation issue is documented separately.
- **Exchange timeout:** use **Reconcile original status**. Do not create another exchange to replace an unresolved submission.
- **Abandon a prepared exchange:** the fee payer uses **Cancel on chain in wallet**, then reconciles the original outcome before renewing. The one-hour review period does not revoke already issued durable signatures.

## Run the source

Use Node **26.8.2**:

```sh
npm ci --ignore-scripts
cp .env.example .dev.vars
npm run db:migrate
npm run build
npm test
```

Run `npm run dev:api` and `npm run dev` in separate terminals. The local default has settlement disabled. Hosted testing above requires no RPC account, private server setup or local installation. For your own deployment, see [deployment](deployment.md), [server configuration](../README.md#development), and [Devnet fixture scripts](../scripts/DEVNET.md).
