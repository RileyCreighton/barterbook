# Disposable devnet fixtures, evidence and board seeding

These commands use **new disposable devnet wallets and faucet SOL only**. They never import a user's funded wallet, acquire PRE tokens or purchase a service. TEST-A, TEST-B and TEST-C are minted mock assets, not PRE holdings. The SDK scripts do not prove browser-extension compatibility. No competition submission or external message is sent.

Run commands from the repository root. Install the pinned dependencies with `npm ci`. Node 22 or newer is needed; this project was exercised with Node 26. Keep `.test-wallets/` private and backed up locally: it contains keys and transaction recovery journals and is ignored by Git. Never paste keys, seed phrases, cookies, provider URLs containing credentials, or `.test-wallets` files into chat or a submission.

## 1. Create a named run, then inspect funding

Choose a new run name once and reuse it for every continuation command. This example uses `demo-2026-09-25-a`:

```sh
node --import tsx scripts/devnet-fixtures.ts --run demo-2026-09-25-a --init-only
node --import tsx scripts/devnet-faucet.ts --run demo-2026-09-25-a --check
```

The first command creates three disposable SDK keys without requesting SOL or broadcasting. The second queries the payer's **finalized balance and transaction history** and writes a new public inspection record. The default endpoint is Solana's public devnet RPC. An optional `DEVNET_RPC_URL` environment variable may use an authorized provider, configured in your terminal locally. It is never a frontend variable or part of public evidence. Every chain command checks the devnet genesis hash before doing work.

Once the displayed wallet is the new disposable payer and its inspection shows no prior funding, request one faucet payment:

```sh
node --import tsx scripts/devnet-faucet.ts --run demo-2026-09-25-a --request --request-id faucet-01
```

A request is durably recorded before contacting the faucet. A timeout or error does **not** retry it. Running the same request ID again only inspects funding. If an earlier request returned a signature, its original status must be reconciled; an unresolved signature blocks another request. If an earlier request returned no signature, a later **explicit** retry requires a new read of finalized zero balance and empty history and at least 15 minutes since the preceding request. A wallet-wide time bucket also prevents concurrent requests. Rate-limited reads use bounded 1/2/4-second backoff; faucet writes do not retry automatically.

Only after reviewing the new inspection and authorizing another faucet-only request:

```sh
node --import tsx scripts/devnet-faucet.ts --run demo-2026-09-25-a --check
node --import tsx scripts/devnet-faucet.ts --run demo-2026-09-25-a --retry --request-id faucet-02
```

Do not issue another request because a UI timed out. A finalized balance below the fixture threshold of 0.1 SOL stops new transaction construction or rebroadcast; it does not prevent read-only reconciliation of an original journal or reuse of its verified finalized archive, and it does not cause an automatic top-up. Transactions with unresolved expiry also stop; their journals must not be deleted to force a replacement.

## 2. Create and separately validate three mock mints

After the faucet balance is finalized:

```sh
node --import tsx scripts/devnet-fixtures.ts --run demo-2026-09-25-a --execute
```

This creates three Token-2022 mints with six decimals and a 1% transfer fee capped at 1,000,000 raw units. Each of the three SDK wallets receives 1,000,000,000 raw units of each mock mint. Each mint must then pass its own actual finalized transfer: gross 100,001 raw, fee 1,001 raw, net 99,000 raw. Only matching transaction-specific metadata allows `tested: true` in:

```text
evidence/devnet/demo-2026-09-25-a/assets.json
```

That file is the exact `Asset[]` JSON for the server's `DEVNET_ASSETS_JSON` setting. A per-mint immutable record and its raw finalized transaction archive remain beside it. Existing mint/transfer journals cause a status check, not another mint or payment. If a command was interrupted, continue with both flags:

```sh
node --import tsx scripts/devnet-fixtures.ts --run demo-2026-09-25-a --execute --resume
```

`--execute` permits operations that have not yet been built. `--resume` permits checking and, while valid, rebroadcasting the **same original signed bytes** for an unfinished operation. It never refreshes that operation's blockhash. A finalized operation is reused. Finalized transaction metadata is queried independently of the signature-status cache, and a previously validated immutable archive remains usable if an RPC later prunes its history. A single RPC's missing status after expiry is insufficient to create a replacement, so the script holds the original journal for authoritative reconciliation.

## 3. Run the SDK two-for-one basket, three-way exchange and rollback proof

```sh
node --import tsx scripts/devnet-exchange.ts --run demo-2026-09-25-a --execute
```

Participant 1 is Alice, participant 2 Bob and participant 3 Carol for these examples. The public manifest continues to label their addresses as disposable **SDK** participants.

- Basket: Alice gives Bob 10 TEST-A plus 5 TEST-B; Bob gives Alice 20 TEST-C. The corresponding net receipts at the configured fees are 9.9 A, 4.95 B and 19.8 C.
- Three-way exchange: Alice gives Carol 10 A; Carol gives Bob 15 C; Bob gives Alice 20 B. Net receipts are 9.9 A, 14.85 C and 19.8 B.
- Controlled failure: the final sorted token-transfer instruction intentionally exceeds its source balance. Only this isolated SDK test skips preflight. It must fail at that final instruction and show zero intended token deltas in finalized metadata. A small network fee still applies. The public application has no preflight bypass.

The shared builder/verifier validates each message before each signature, verifies all resulting signatures and records an unchanged message hash after every sequential SDK signature. Those signing observations and the frozen plan are stored inside the same durable full-byte journal before public signing evidence is written; an interrupted publication can be recovered from that original journal. The scripts store full signed bytes, the locally derived signature/transaction ID, actual lifetime and a submission-started event before every broadcast. A crash or timeout never creates a fresh executable replacement. To continue after an interruption:

```sh
node --import tsx scripts/devnet-exchange.ts --run demo-2026-09-25-a --execute --resume
```

Each finalized exchange produces a receipt summary with its signature, explicitly devnet explorer URL, slot, block time, finality, raw gross/fee/net token deltas, actual SOL fee/rent and source/build fingerprint. Token deltas require unique, in-range account indices, exact mint/owner/token-program/decimals identity and canonical raw u64 amounts; conflicting or missing metadata cannot produce a verified receipt. The adjacent `*-transaction.json` includes the actual raw base64 `getTransaction` JSON-RPC response, parsed metadata, signed bytes and preserved message. Simulation records are stored separately and never called execution receipts. No file is overwritten: all journal events and evidence are append-only or immutable create-if-absent records.

## 4. Give new browser wallets mock inventory

Create new disposable wallets in separate browser profiles/extensions and select **devnet**. Record only their public addresses in a local JSON file, for example `browser-participants.public.json`:

```json
[
  {
    "address": "REPLACE_WITH_NEW_BROWSER_PUBLIC_ADDRESS",
    "label": "Alice browser devnet wallet"
  },
  {
    "address": "REPLACE_WITH_ANOTHER_NEW_PUBLIC_ADDRESS",
    "label": "Bob browser devnet wallet"
  },
  {
    "address": "REPLACE_WITH_THIRD_NEW_PUBLIC_ADDRESS",
    "label": "Carol browser devnet wallet"
  }
]
```

Supply actual public addresses, never recovery phrases. One to three distinct browser recipients are allowed per run. They can be added after SDK fixture creation without replacing the SDK manifest:

```sh
node --import tsx scripts/devnet-fixtures.ts --run demo-2026-09-25-a --browser-participants browser-participants.public.json --execute --resume
```

The script reuses finalized setup operations, creates each recipient's ATA and mints the same mock inventory from this run's disposable mint authority. It appends a public `participants-browser-*.json` manifest. Browser records remain `signingEvidence: "not-yet-proven"`; receiving inventory is not signing proof. The browser fee payer will separately need faucet SOL in its own new devnet wallet. No SDK private key is exported into an extension.

For the app's optional `DEMO_PARTICIPANTS_JSON`, use up to six public `{ "address": "…", "label": "…" }` entries. This labels both SDK and browser developer wallets without changing the three-owner maximum per trade. The scripts' public manifests call that field `publicKey`; map it to `address`. Configure provider credentials only in server `.dev.vars`/Worker secrets. A browser participant creates its own authenticated listings and approvals through the UI.

If a demo has consumed its mock inventory, explicitly name a replenishment batch:

```sh
node --import tsx scripts/devnet-fixtures.ts --run demo-2026-09-25-a --replenish --batch replenish-01 --execute --resume
```

This mints 1,000,000,000 raw units of each mock mint to each recorded participant. The batch/participant/mint operation IDs are stable, so rerunning that same batch cannot mint twice after a timeout. A different batch is a new explicitly requested mint operation. It does not request more SOL automatically.

## 5. Seed a developer board through the normal authenticated API

First copy the verified `assets.json` array into the server-owned `DEVNET_ASSETS_JSON` setting in `.dev.vars`, configure an authorized devnet RPC there, apply `npm run db:migrate`, and start the Worker and Vite in separate terminals:

```sh
npm run dev:api
```

```sh
npm run dev
```

Keep settlement off during initial deployment and inventory setup. Once all three mints are separately validated and preliminary hosted checks pass, enable settlement for the authorized Devnet rehearsal. Measure the actual hosted financial paths and complete real browser signing before describing trading as verified. Use the origin matching `APP_ORIGIN` (normally `http://localhost:5173` locally, or the deployed HTTPS origin). Preview the seed, then execute it:

```sh
node --import tsx scripts/devnet-board-seed.ts --run demo-2026-09-25-a --batch judge-01 --url http://localhost:5173
node --import tsx scripts/devnet-board-seed.ts --run demo-2026-09-25-a --batch judge-01 --url http://localhost:5173 --execute
```

This is labeled **SDK authentication for a developer demo**, not browser-wallet evidence. It signs the real one-use authentication challenges with the three local disposable SDK keys, validates challenge origin/wallet/devnet/expiry, obtains the normal session cookies and calls the actual authenticated `/api/listings` and `/api/offers` endpoints. There are no database inserts or authentication bypasses. It posts the three exact-lot cycle listings and a two-for-one basket offer; acceptance, readiness and settlement signatures remain pending.

The exact request bodies, expiries and `Idempotency-Key` values are saved before posting. Repeat the same batch command after a dropped response; it reuses those values and returns the same listings/room. It does not silently renew expired lots or change their prices. Once old listings expire or are intentionally retired, use a new explicit batch name for new reviewed terms. The script rejects an app registry that differs from this run's three separately validated mock mints.

## Actual execution status, September 25, 2026

The original early request to `5LjQfnCwojPVdqHYjdmZzdnyhzSNottxSZSBGwVkqvAV` returned a public faucet error. Its original wallet files and `.test-wallets/faucet-request.json` remain untouched. The earlier public evidence under `evidence/devnet-faucet*.json` is also preserved.

After a fresh finalized-zero-balance/empty-history check, one explicitly authorized retry was recorded in run `20260925-sdk-proof-01`, reusing only those original disposable keys. The retry failed or remained uncertain; a subsequent finalized read again found **0 lamports and no signatures**. See `evidence/devnet/20260925-sdk-proof-01/funding-checks/` and `faucet-results/`. No mint, swap or controlled-failure transaction was broadcast. There is no actual devnet settlement receipt or browser-extension proof from this run.

To inspect that preserved run without requesting more funds:

```sh
node --import tsx scripts/devnet-faucet.ts --run 20260925-sdk-proof-01 --check
```

All script tests use isolated temporary wallets and mocked chain transport or the real authentication/board HTTP routers backed by test SQLite. They cover immutable writes, signature/message identity, persistence before broadcast, timeout followed by original success, expiry holds, faucet cooldown/backoff, scoped authentication and idempotent reseeding after a lost HTTP response. Run them with:

```sh
npx vitest run tests/devnet-scripts.test.ts
```
