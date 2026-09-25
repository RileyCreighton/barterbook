# Deploy one Worker and one D1 database

The app works locally before any account setup. A public deployment needs your Cloudflare account; settlement also needs a server-side devnet RPC, three validated fixture mints and real browser-wallet checks. Keep settlement disabled while preparing the public walkthrough. No paid subscription is required by this guide, and no service should be upgraded automatically.

The current hosted financial paths exceed the Free plan's 10 ms CPU allowance: after optimization, preparation measured 26/52 ms, signature collection 9–11 ms, submission 10/13 ms and recovery 19 ms. Those requests completed, but this is **not a Free CPU-budget pass**. [Actual measurements](../evidence/hosted/cpu-2026-09-25T08-44-50.289Z.json) and [current Cloudflare pricing](https://developers.cloudflare.com/workers/platform/pricing/) support the limitation. Workers Paid starts at $5/month with included usage and possible overages. No upgrade has been made; the owner must explicitly choose any paid change.

## 1. Prepare locally

Install the recorded Node.js **26.8.2** toolchain, then open a terminal in the project folder:

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run db:migrate
```

Copy `.env.example` to ignored `.dev.vars` for local use. Start `npm run dev:api` and `npm run dev` in separate terminals, then open `http://localhost:5173`. Local migrations do not change Cloudflare. Do not paste provider credentials or wallet recovery phrases into chat or GitHub.

## 2. Create free accounts and the database

1. Sign up or sign in to [Cloudflare](https://dash.cloudflare.com/). Use Workers Free. Choose your `workers.dev` subdomain in Workers & Pages; a paid domain is unnecessary.
2. Run `npx wrangler login` and approve your own Cloudflare account in the browser. `npx wrangler whoami` should show the intended account.
3. Run `npx wrangler d1 create barterbook-devnet`. Save the returned database UUID and account ID. Creation is a remote account change; run it only in the account you intend to use.
4. For live devnet preparation, use the [Helius dashboard](https://dashboard.helius.dev/) **Free** plan and select devnet. The separate agent signup flow requires a payment; this guide uses dashboard signup. Copy its complete RPC URL privately into `.dev.vars`, not a `VITE_` variable. Leave automatic credit purchasing off.

For the exact beginner file-edit steps, use [Helius setup](helius-setup.md).

See the [fresh free-plan limits](release/provider-limits.md) before enabling live traffic. A missing RPC does not prevent the no-wallet walkthrough.

## 3. Prepare deployment settings without changing local defaults

Create ignored `.env.deploy.local` in the project root. The following values are placeholders; replace them with actual values. Leave the repository URL blank until a real accessible repository exists.

```dotenv
CLOUDFLARE_D1_DATABASE_ID=YOUR_DATABASE_UUID
APP_ORIGIN=https://barterbook-devnet.YOUR_SUBDOMAIN.workers.dev
SITE_URL=https://barterbook-devnet.YOUR_SUBDOMAIN.workers.dev
REPOSITORY_URL=
BUILD_ID=YOUR_REVIEWED_COMMIT_ID
DEVNET_ASSETS_JSON=[]
DEMO_PARTICIPANTS_JSON=[]
SETTLEMENT_ENABLED=false
RPC_HISTORY_TRUSTED=false
FALLBACK_HISTORY_TRUSTED=false
RPC_ADDRESS_HISTORY_TRUSTED=false
FALLBACK_ADDRESS_HISTORY_TRUSTED=false
```

`APP_ORIGIN` must exactly match the HTTPS origin people use, with no path. The asset and participant arrays are public metadata, not secret-key storage. Fill them only from the validated fixture manifest and authorized public wallet addresses. The app validates their schema; preserve raw quantity strings.

The address-history flags are separate operator assertions that each provider's finalized address index is complete for the attempt's lifetime. Keep them false until that property has been assessed. Recovery still requires fresh independent histories, a verified blockhash origin, complete bounded scans and exact message/signature checks. A partial scan or unavailable metadata keeps the attempt locked.

```sh
node --env-file=.env.deploy.local .github/scripts/deployment-config.mjs
```

This writes ignored `.wrangler/deploy.json`, resolving source/assets/migration paths and replacing the D1 placeholder. It leaves checked-in `wrangler.jsonc` suitable for localhost. Review the generated public settings before deployment. Helius credentials are never written to this generated file.

## 4. Migrate and deploy

Record the D1 bookmark before an update, then apply all migrations and deploy the built assets and API:

```sh
npx wrangler d1 time-travel info barterbook-devnet --config .wrangler/deploy.json
npx wrangler d1 migrations apply barterbook-devnet --remote --config .wrangler/deploy.json
npx wrangler deploy --config .wrangler/deploy.json
```

Save the printed real deployment URL and Worker version ID. Test that URL in a fresh logged-out browser. `/api/health` must say devnet and settlement disabled. Open the walkthrough and local evidence, refresh a nested page, and check `/legal/LICENSE`, `/legal/NOTICE` and `/legal/rpc-websockets-9.3.9-source.tar.gz`. Publish the matching application source revision with that release.

To configure RPC secrets, let Wrangler prompt for each complete value; never put it on the command line:

```sh
npx wrangler secret put SOLANA_RPC_URL --config .wrangler/deploy.json
npx wrangler secret put SOLANA_RPC_FALLBACK_URL --config .wrangler/deploy.json
```

The fallback is optional. An independent provider is useful for reconciliation; two URLs on one provider host do not establish independent absence. Keep history flags false until history coverage is verified. Secrets stay on Cloudflare and survive ordinary deploys. They are not GitHub repository variables.

For the authorized devnet rehearsal, enable settlement only after the three real fixture mints pass compatibility, authorized participant addresses are configured and the hosted core request paths have been checked against the CPU budget. Then execute the [wallet rehearsal](wallet-rehearsal.md); claim browser compatibility only after that actual test passes. Keep broader public trading disabled until the full rehearsal and recovery gates pass. Regenerate the deployment config after editing its settings. Changing a provider or build does not release unresolved attempts.

## 5. Updates and rollback

For every update, review migrations, run relevant tests and the build, copy legal assets, record the previous Worker version/D1 bookmark, then apply migrations before deploying compatible code. [D1 migration failures](https://developers.cloudflare.com/d1/reference/migrations/) stop at the failing migration; previously successful migrations may remain applied. A Worker rollback does not reverse SQL changes or Solana transactions.

Prefer an additive repair migration. [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) restores a selected code version only when its bindings and the current database schema remain compatible:

```sh
npx wrangler rollback PREVIOUS_WORKER_VERSION_ID --config .wrangler/deploy.json
```

D1 [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) can overwrite the database. **Do not restore an older database over active/signed attempts.** It could erase a still-executable transaction's journal. Disable new settlement, stop writes, preserve the current database and every signed attempt/identifier/lifetime, reconcile onchain outcomes, and plan how newer attempt records will be retained before considering a restore. Export only to protected local storage, never a public artifact:

```sh
npx wrangler d1 export barterbook-devnet --remote --output .wrangler/before-repair.sql --config .wrangler/deploy.json
```

An operator-reviewed restore, if required after that reconciliation, is `npx wrangler d1 time-travel restore barterbook-devnet --bookmark ACTUAL_BOOKMARK --config .wrangler/deploy.json`. Free-plan history is seven days. No automatic database restore or deletion is included in the workflows.

For repeat deployments, use [the manual GitHub workflow guide](github-release.md). The workflow has not been executed remotely as part of preparation.


## Self-service judging faucet

Migration `0008_demo_faucet.sql` adds a separate authenticated request journal. The hosted faucet uses the exact three Devnet mints and dedicated `FAUCET_AUTHORITY` in `src/shared/demo-faucet.ts`. Its unfunded key has only minting authority; transfer-fee configuration and participant spending authority are separate. The operator stores its base64 Ed25519 secret only as the Worker secret `DEMO_FAUCET_MINT_SECRET`, never in public config or frontend variables. With the secret absent, preparation is disabled.

The caller authenticates a wallet, gets a fixed 1,000-of-each mint transaction, reviews it in the wallet and pays less than 0.01 Devnet SOL for rent and fees. The server checks network identity, registered mocks, a balance floor and fee/rent caps. Both sides reconstruct every instruction; full signed bytes and the transaction identifier are saved before broadcast. An interrupted submission checks or resends its original request. Rate limits apply per wallet, IP and globally.

This published faucet is deliberately bound to this demo's three mints. A separate deployment with different fixtures must configure and review its own mint-only authority and update the shared constants; copying the public source does not give access to the hosted mint key. Judges can use the hosted faucet directly without any server setup.
