# Stocklana submission preparation

Prepared September 25, 2026. This is a local draft, not a submitted entry. Reconcile the wording with the final evidence ledger before copying it into the form. Nothing here claims a mainnet PRE exchange, eligible PRE ownership, organic customer demand, a security audit, or guaranteed savings.

## Verified form constraints

The official [Stocklana event page](https://hackathons.solana.com/hackathons/stocklana) gives a September 25, 2026, 4 PM ET / 20:00 UTC deadline, one original entry per team, registration, at least one repository/demo/video link, and disclosure of reused open-source components. Edits remain possible until closing. The PRE bounty excludes integrations with another issuer's pre-IPO tokens.

The platform's [submission guidance](https://hackathons.solana.com/how-it-works) permits a devnet demonstration, an optional pitch of at most three minutes and an optional five-minute technical walkthrough. Up to three sponsor tracks may be chosen. Main judging covers every submitted project.

At `2026-09-25T06:12:20.792294+00:00`, the public submission HTML and its currently linked scripts were fetched again; script URLs were rediscovered rather than assumed from an earlier build. The client still enforces **280 UTF-16 code units** for short description and **5,000** for full description. [The verification record](release/submission-rules-verification.json) retains current hashes, source URLs and observed fields. The logged-out [form](https://hackathons.solana.com/hackathons/stocklana/submit) requires sign-in, and its client requires a linked wallet before the form. Authenticated/server validation has not been exercised.

The current fields are project name, short description, full description (Markdown), GitHub repository, demo URL, pitch video URL, technical video URL, team, sponsor tracks, and final review. The client requires a nonempty project name and at least one valid supporting link. Save Draft and Submit Project are different actions. No project-name length limit or additional backend field constraint is claimed here.

Generic devnet demonstrations are allowed by the platform guidance. The PRE bounty asks for a project using PreStocks and excludes other issuers' pre-IPO tokens; it does not explicitly confirm that generic mock-token fixtures alone qualify. Do not select that bounty as if eligibility were established. Real PRE testing still needs issuer eligibility and explicit asset authorization.

The current draft measures **253 / 280** UTF-16 code units for the short description and **4,870 / 5,000** for the full description. The count includes spaces and paragraph breaks, matching the public form’s JavaScript length convention.

## Project name

BarterBook

## Tagline

Your inventory. Shared terms. One atomic exchange.

## Short description

<!-- short:start -->
BarterBook combines token offers, two-for-one baskets and three-owner matches. Hosted API tests with SDK signers finalized both exchanges on Solana devnet. Browser settlement and the Free CPU budget gate remain pending. Mock tokens are not PRE holdings.
<!-- short:end -->

## Full description

<!-- full:start -->
BarterBook explores a specific problem for tokenized-stock holders: finding another holder willing to take a complete package or provide the inventory and terms they want. Instant stock-to-stock routes already exist. Our hypothesis is that selected-inventory discovery and negotiated packages can complement them; we do not claim better prices or guaranteed savings.

One application combines three flows:
- BarterBook: advertise selected supported inventory and a desired replacement.
- BasketSwap: agree an exact two-owner package, including two tokens for one.
- Three-way matching: discover a cycle among three fixed-lot listings when each participant receives the mint and minimum net quantity they requested.

The implemented settlement engine uses existing Solana token programs. Every sending owner signs the same transaction message, so the agreed token legs execute together or fail together. There is no new onchain program, custody wallet, liquidity pool, delegated standing order or AI trading agent. Each browser verifies instructions against accepted terms before asking its wallet to sign.

Raw integer quantities are binding. Transfer fees use the current mint schedule, integer rounding and caps; displayed receipts distinguish gross debit, issuer fee and net received. A Token-2022 checked-fee instruction makes an unexpected fee fail instead of quietly changing consent. Three-way candidates must satisfy every actual net receipt, with no partial fills or surplus diversion. Same-mint opposing bilateral transfers are rejected.

The coordinator records an immutable message, signatures, full signed bytes, transaction identifier, lifetime and submission-started state durably. A timeout or offchain cancel cannot safely revoke already distributed signatures. Recovery checks the original transaction before allowing any replacement; confirmed receipts use that transaction's metadata, not unrelated wallet-balance changes.

The stack is React, Vite and TypeScript, with one Cloudflare Worker serving static assets and a Hono API, D1 persistence and server-side Helius RPC access. Wallet keys remain in browser wallets. Provider credentials stay on the server. Active rooms use short HTTP polling.

The public Worker offers a no-wallet walkthrough with clearly labeled examples and local execution evidence. Three mock devnet mints have passed actual compatibility transfers. They are not PRE holdings, private-company shares or mainnet settlement proof. Real PRE integrations require fresh mint validation and eligible, explicitly authorized participants. Fixture-only PRE bounty eligibility remains unestablished.

Developer-run SDK tests finalized a fee-aware basket and three-owner exchange through the hosted API on public devnet; public application history contains both receipts. Both preserve one message across signatures, and transaction metadata verifies exact gross debits and net receipts. A deliberate final-leg failure finalized with all intended token deltas zero in existing accounts. Network fees were 10,000, 15,000 and 15,000 lamports respectively. Separate local LiteSVM tests prove rollback of newly created receiving accounts. These are controlled SDK tests, not browser-wallet settlements.

Actual devnet proofs: [basket](https://explorer.solana.com/tx/5CQDkJnbjsEG8JBmvEQFGmzUeT573CywExFx2ajkR884CJrkruXcSwdvA2ZWsY8TJK7B8XWDk21Q6v2CWmPZXqwV?cluster=devnet) and [three-way exchange](https://explorer.solana.com/tx/3wfDTWASADuBTxAfgziKaYyQRJFbPHzMwxk1STQD4qLSKtnEr3rLXyHmzW9YfiKRg4movuuBn7xT3HptJ74QPFUn?cluster=devnet).

Three browser wallets received mock inventory and faucet-only funds. D1 verified earlier authentication; the owner now reports all three Solflare logins in Zen. On actual terms version 5, Bob’s Solflare 2.28.1 warned of a Devnet/Mainnet mismatch. No signature was stored. The original safely reconciled as expired and unlanded, with its journal and null transaction ID preserved. Both independent RPCs verified the frozen blockhash’s Devnet origin; this does not establish the warning’s cause or a secure workaround. Full browser signing remains unverified, and no Chrome test occurred. Hosted SDK receipts are separate proof. The Free CPU gate remains unmet: latest prepare was 48 ms, renewal 28 ms and fresh assets 4–5 ms, with no signature POST in that window; earlier recovery took 60 ms against a published 10 ms allowance. Invocation outcomes were ok, but optimization and remeasurement remain necessary. No paid upgrade was made. This is not an audited trading service.

Development used AI coding assistance. The source documentation attributes React, Vite, TypeScript, Hono, Cloudflare tooling, Solana SDKs and other installed dependencies. Research also acknowledges prior bilateral barter, auction and multi-user matching work. The project makes no claim to have invented barter or order cycles.
<!-- full:end -->

## Links and final review

Repository: https://github.com/RileyCreighton/barterbook

Demo: https://barterbook-devnet.rileycreighton.workers.dev/#/walkthrough

Evidence: https://github.com/RileyCreighton/barterbook/blob/main/evidence/finish-verification.json

Pitch video: not recorded. Technical video: not recorded.

Hosted API SDK devnet proofs (plus the earlier direct controlled failure): [basket](https://explorer.solana.com/tx/5CQDkJnbjsEG8JBmvEQFGmzUeT573CywExFx2ajkR884CJrkruXcSwdvA2ZWsY8TJK7B8XWDk21Q6v2CWmPZXqwV?cluster=devnet), [three-way exchange](https://explorer.solana.com/tx/3wfDTWASADuBTxAfgziKaYyQRJFbPHzMwxk1STQD4qLSKtnEr3rLXyHmzW9YfiKRg4movuuBn7xT3HptJ74QPFUn?cluster=devnet), and [controlled final-leg failure](https://explorer.solana.com/tx/Egor5yrT3AXee5otWCdZi1ufCfmqNKBBYVZohAsELwfhzQDbeBycNEY3XZXjjbtrSSRai4dGd88XNnoHB8YyNj6?cluster=devnet). The basket and ring were settled through the hosted API with SDK signers. None of these is browser-wallet execution.

Keep actual repository, hosted-demo, pitch-video and technical-video URLs in their dedicated fields. Do not substitute localhost, private credentials, a placeholder URL or a private repository the judges cannot access. At least one accessible supporting link is required by the event.

- [ ] Final descriptions match the final evidence ledger; rerun character counts after edits.
- [ ] Open supplied links in a logged-out browser.
- [ ] State the demo network and controlled-wallet status in the video.
- [ ] Record eligibility and sponsor requirements before selecting the PRE track; metadata integration alone does not prove bounty eligibility.
- [ ] User explicitly requests final submission before anyone submits. Current authorization is to build and prepare materials only.

Character counts can be reproduced without changing files:

```sh
python3 - <<'PY'
from pathlib import Path
text = Path('docs/submission.md').read_text()
for name, limit in [('short', 280), ('full', 5000)]:
    body = text.split(f'<!-- {name}:start -->\n', 1)[1].split(f'\n<!-- {name}:end -->', 1)[0]
    count = len(body.encode('utf-16-le')) // 2
    print(f'{name}: {count}/{limit} UTF-16 code units')
    assert count <= limit
PY
```
