# Review before making the MVP public

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
