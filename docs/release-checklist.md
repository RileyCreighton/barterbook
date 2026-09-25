# Review before making the MVP public

**Published checkpoint — 2026-09-25 06:58 UTC:** the [public demo](https://barterbook-devnet.rileycreighton.workers.dev) and [repository](https://github.com/RileyCreighton/barterbook) are live. Initial commit `629ed20` passed [CI with 143 tests](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100). All six remote D1 migrations applied; hosted desktop/mobile no-wallet checks and [16 HTTP checks](../evidence/hosted/http-smoke-1790319106255.json) passed. Hosted legal downloads include the notices and LGPL source archive.

Settlement remains disabled with an empty asset registry and an unfunded disposable SDK payer. Browser-extension signing, public devnet settlement and hosted financial CPU evidence remain pending; telemetry access returned 403. GitHub's `devnet` environment has nine variables and the account-ID secret, but still needs `CLOUDFLARE_API_TOKEN` for its manual deploy workflow. No competition entry has been submitted. Use the checklist below for subsequent releases and for any proposal to enable settlement; unchecked items are not retroactive claims about the initial publication.

- [ ] The user chose the actual repository owner/name and authorized its visibility and the target Cloudflare account.
- [ ] The reviewed commit passes relevant financial/signing/recovery checks, the full suite and production build; evidence records that exact run.
- [ ] Secret scan and staged-file review exclude provider credentials, wallet exports, cookies and executable attempt journals.
- [ ] Original source LICENSE/NOTICE and third-party notices are retained; the exact LGPL source is served, and the corresponding application source revision is accessible.
- [ ] All migrations apply to the intended D1 database; previous Worker version and D1 bookmark are recorded, with no unsafe automatic restore.
- [ ] Actual app URL loads logged out, `/api/health` says devnet, and source/legal links work. No invented URL remains in submission fields.
- [ ] No-wallet examples, local runtime evidence and real public devnet receipts are visibly distinct.
- [ ] Live settlement, if enabled, uses three separately validated mock mints, authorized disposable wallets and recorded real extension signing; every actual receipt is verified from its own transaction metadata.
- [ ] Full hosted signing/settlement paths fit the free Worker CPU and provider limits; no paid upgrade is assumed.
- [ ] Pitch is at most three minutes; final short/full descriptions pass 280/5,000 UTF-16 limits and match the current evidence.
- [ ] The official event deadline is rechecked, supporting links are accessible, sponsor eligibility is separately established, and the user explicitly authorizes any final competition submission.

Unfinished live-wallet or faucet gates should remain stated plainly. Publish a useful no-wallet demo with settlement disabled if that is the authorized and verified state; do not create synthetic public receipts.
