# Browser-executed Devnet exchanges

The project owner executed the basket and three-person match through the live BarterBook application using browser wallets. Two independent Devnet providers verified finality, every required Ed25519 signature, the exact frozen message, all six token-account deltas and consumption of Bob's durable nonce for each transaction. Wallet software identity comes from participant reports; chain metadata independently proves authorization and settlement.

| Completed trade | Finalized UTC, September 25, 2026 | Signers | Network fee | Receipt |
|---|---|---:|---:|---|
| Two-for-one basket | 19:14:38 | 2 | 0.00001 Devnet SOL | [Open receipt](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/25qQJqb2jgTvY5VVhFsa2fizsxGaZ3pWoVjiREQ9NZkqDxKpy56E1w3ZCHV2RZuNrfh9NeLZgGgsGCix8MpU4XSS) |
| Three-way match | 19:23:39 | 3 | 0.000015 Devnet SOL | [Open receipt](https://barterbook-devnet.rileycreighton.workers.dev/#/receipt/2Cu3fwsynLDHVQzB67DUZGBqcxarquCZKtCEyVoAjneSHtoVeFKWeBdnYxieUgFnXxxGCbjirDC6Zoo6yVvHpy8Z) |

Neither exchange needed new receiving-account rent. Earlier [first successful browser basket](../evidence/hosted/browser-v10-finalized-verification.json) finalized at 19:00:02 UTC and remains archived separately.

## Exact transfers

| Trade | From → to | Gross debit | Token fee | Net received |
|---|---|---:|---:|---:|
| Basket | Alice → Bob, TEST-A | 10 | 0.1 | 9.9 |
| Basket | Alice → Bob, TEST-B | 5 | 0.05 | 4.95 |
| Basket | Bob → Alice, TEST-C | 20 | 0.2 | 19.8 |
| Three-way | Alice → Bob, TEST-A | 10 | 0.1 | 9.9 |
| Three-way | Bob → Carol, TEST-B | 20 | 0.2 | 19.8 |
| Three-way | Carol → Alice, TEST-C | 30 | 0.3 | 29.7 |

## Downloadable proof

- Basket: [original finalized transaction and receipt](../evidence/hosted/browser-basket-finalized-evidence.json), [independent provider verification](../evidence/hosted/browser-basket-finalized-verification.json), [Solana Explorer](https://explorer.solana.com/tx/25qQJqb2jgTvY5VVhFsa2fizsxGaZ3pWoVjiREQ9NZkqDxKpy56E1w3ZCHV2RZuNrfh9NeLZgGgsGCix8MpU4XSS?cluster=devnet).
- Three-way: [original finalized transaction and receipt](../evidence/hosted/browser-ring-finalized-evidence.json), [independent provider verification](../evidence/hosted/browser-ring-finalized-verification.json), [Solana Explorer](https://explorer.solana.com/tx/2Cu3fwsynLDHVQzB67DUZGBqcxarquCZKtCEyVoAjneSHtoVeFKWeBdnYxieUgFnXxxGCbjirDC6Zoo6yVvHpy8Z?cluster=devnet).

Every archive includes the original base64 transaction, message hash, required signer addresses, accepted gross/fee/net transfers and transaction-specific metadata. The verifier checks owner, mint, token program and decimals for every changed token account, rather than relying on aggregate wallet balances.

These are developer-operated browser demonstrations with valueless TEST-A/B/C assets on public Solana Devnet. [Earlier SDK and local execution evidence](evidence-and-wallet-smoke.md) includes atomic failure and recovery regression coverage. Mainnet deployment, real stock-token eligibility and an independent security audit are outside this demonstration.

[Run your own test](judging-guide.md).
