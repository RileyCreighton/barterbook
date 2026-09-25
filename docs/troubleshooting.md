# Common setup and demo problems

| Symptom | Check and next action |
|---|---|
| `node:sqlite` missing or native module load fails | Use Node 26.8.2 and reinstall from the lockfile on the current OS with `npm ci --ignore-scripts`. Do not copy another computer's `node_modules`. |
| Page loads but API fails | Run the local Worker on 8787 and Vite on 5173. Open `localhost`, and ensure local `APP_ORIGIN=http://localhost:5173`. Built/hosted mode needs its actual origin instead. |
| Login rejected or no session | Check the exact origin, devnet selection, clock and one-use challenge. Use HTTPS when hosted. Do not disable origin/cookie checks or reuse a signed challenge. |
| No wallet shown | The embedded browser may have no extension. Open an isolated browser profile with a compatible Wallet Standard extension; the no-wallet walkthrough remains available. |
| Empty live board or asset registry | Expected before RPC/fixture setup. Examples and local evidence remain labeled separately. Add only the actual validated devnet manifest. |
| Wrong program, frozen account, active hook, memo requirement or scaled amount rejected | Treat this as the compatibility gate working. Fix the test fixture policy and revalidate; never remove checks to make the wallet prompt appear. |
| RPC 401/403/429 | Verify the server-only key and devnet endpoint privately. Observe free rate/credit limits. Preserve unresolved attempts. Do not expose the URL in frontend code or repeatedly send fresh transactions. |
| Faucet returns no funds | Inspect the original funding journal and finalized history. Follow the fixture guide's bounded recovery. Do not buy SOL, request repeated blind airdrops or use an existing funded wallet. |
| Wallet strips prior signatures or rewrites the message | Reject the response. Use a compatible sign-without-broadcast flow. A changed message requires all signatures again only after the previous attempt is safely resolved. |
| Submission timeout / room remains locked | Reconcile the stored transaction ID, lifetime and transaction metadata. It may already have succeeded. Never delete the attempt or manually unlock rows to force another trade. |
| Confirmed but receipt pending | Wait for consistent transaction-specific metadata. Keep the original identifier; current wallet balances cannot fill the gap. |
| Worker error 1102 / CPU exhausted | Disable new settlement while profiling hosted full paths. Preserve pending journals; optimize repeated work without weakening verification. Do not silently move to a paid plan. |
| Worker daily quota / D1 quota reached | Pause avoidable polling, keep unresolved attempts and wait for the provider reset or explicit plan approval. Database restoration is not a quota fix. |
| Cloudflare authentication or D1 placeholder error | Sign in to the intended account, create the database, and generate `.wrangler/deploy.json` with its actual UUID. A local database is not a remote database. |
| Migration or deployment fails | Inspect the failed step. Earlier successful migrations can remain applied. Prefer a compatible forward fix; never restore old D1 state over executable attempts. See [deployment recovery](deployment.md). |
| GitHub Run workflow button missing | The manual workflow must exist on the repository's default branch. Check Actions permissions and environment settings. Do not enable automatic deployment as a workaround. |
| Source or legal link broken | Run the legal packaging step after building, redeploy the reviewed bundle, and publish the matching source revision. Verify exact links logged out. |

When reporting a problem, include build ID, environment, wallet/browser versions, error text and public attempt/transaction identifiers. Exclude keys, recovery phrases, cookies, provider URLs and unresolved signed transaction bytes.

## Remote migration reports incomplete SQL input

Cloudflare’s remote D1 statement splitter can misread an unparenthesized `CASE ... END` inside a trigger. The release migrations now use `SELECT (CASE ... END);` and LF endings, preserving their guard behavior. The initial remote application failed without creating application tables; all six migrations then applied successfully after this syntax-only correction. [Upstream issue](https://github.com/cloudflare/workers-sdk/issues/4727). Never remove financial triggers as a workaround. Inspect the migration table/schema before retrying; do not reset a database containing attempts.
