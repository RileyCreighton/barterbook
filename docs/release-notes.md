# 0.1.0 — Stocklana MVP preparation

This release combines selected-inventory listings, exact two-owner basket offers/counteroffers and bounded three-owner fixed-lot matching in one application. It uses React/Vite/TypeScript, one Cloudflare Worker/Hono API, D1 and server-side Solana RPC. No new onchain program or custody wallet is introduced.

The shared settlement path validates every instruction, preserves partial signatures over one immutable message, computes raw integer fees/nets, persists signed attempts before broadcast and recovers original outcomes after uncertain submission. Unsupported mint/account extensions and opposing bilateral transfers of one mint are rejected. Three validated mock assets are the live launch target; a five-distinct-asset basket remains disabled.

Recorded evidence includes local tests, the SDK signing spike, local workerd/D1 checks, no-wallet browser UI checks including the repaired mobile guide, and actual local LiteSVM Token-2022 basket/ring/rollback execution. See [the finishing verification](../evidence/finish-verification.json) and [evidence ledger](evidence-and-wallet-smoke.md) for exact scope. None of those records is public devnet or live browser-wallet proof.

Release preparation adds beginner Helius/wallet/deployment/GitHub guides, an under-three-minute pitch and submission drafts within freshly verified form limits. CI checks locally; publishing uses a separate manual workflow. Apache-2.0 covers original application source; retained third-party notices and the exact LGPL dependency source accompany deployment assets.

At preparation time, a funded public devnet exchange, real extension signing, hosted CPU measurements and a verified public deployment remain open gates. The original faucet request and one explicit journaled retry did not establish funds. Update this status only from new recorded evidence. A published repository/URL is not implied by this release note. Mainnet/PRE tests require separate eligibility and asset authorization; fixture-only PRE bounty eligibility remains unconfirmed.
