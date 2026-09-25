# Put the reviewed release on GitHub

**Current status — 2026-09-25 06:58 UTC:** [RileyCreighton/barterbook](https://github.com/RileyCreighton/barterbook) is public, and initial commit `629ed20` passed [first CI with 143 tests](https://github.com/RileyCreighton/barterbook/actions/runs/36104365100). The [devnet demo](https://barterbook-devnet.rileycreighton.workers.dev) is live with settlement disabled and an empty asset registry. The GitHub `devnet` environment has all nine variables and `CLOUDFLARE_ACCOUNT_ID`; `CLOUDFLARE_API_TOKEN` is still missing, so manual Actions deployment is not ready. The published Worker was deployed separately. No competition entry has been submitted.

The initial publication below is complete for this repository; retain it as a setup reference for a new repository. Future changes still require a reviewed commit and passing checks.

## First repository

1. Review `git status` and the source tree. Exclude `.dev.vars`, `.env.deploy.local`, `.test-wallets/`, `.wrangler/`, `node_modules/`, wallet exports and provider credentials. Keep the lockfile, migrations, evidence labels, LICENSE, NOTICE and `docs/vendor/` source archive. The legal source archive is intentionally included.
2. In [GitHub's new-repository page](https://github.com/new), choose the agreed owner and name. An empty repository avoids conflicting starter files. Public visibility lets judges read source without an invitation; use it only after the user approves publication.
3. If the folder is not yet a Git repository, initialize it with `git init -b main`. Add reviewed files, inspect `git diff --cached --stat` and the staged diff, then commit. Check `git status --ignored` to confirm secret files are excluded. Do not assume `.gitignore` removes secrets already committed.
4. Add the exact remote URL returned by GitHub with `git remote add origin ACTUAL_REMOTE_URL`, then `git push -u origin main`. These commands publish the reviewed commit; do not substitute an invented repository URL.
5. Open the repository logged out. Set its description and website only to truthful current information. Confirm LICENSE, setup and evidence links work.

If any credential entered Git history, stop publication and rotate it; deleting its current file is insufficient. Do not upload executable signed transaction journals as release artifacts.

## Continuous checks

`.github/workflows/ci.yml` runs local tests (including SDK signing checks), the production build and local D1 migrations on pushes to `main` and pull requests. It scans the working files and full fetched Git history for secrets. It never deploys or asks for provider/wallet secrets. Test evidence is retained as a GitHub artifact for 14 days. The first run linked above passed; it proves the reviewed commit's CI checks, not later uncommitted changes or live-wallet settlement.

Node is pinned to 26.8.2 because tests use `node:sqlite`. Official checkout/setup/upload actions are pinned to verified full commit IDs. The token has read-only repository permissions, and checkout credentials are not persisted. The dependency lockfile controls package versions. [GitHub's workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use) explains these choices.

## Manual deployment workflow

Create a GitHub **environment** named `devnet` under Settings → Environments. If available for your repository plan, restrict it to the default branch and require a human reviewer. Add these environment secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | A token scoped to the intended account with Worker script deployment and D1 edit permissions. Start from Cloudflare's Edit Workers template, add D1 access if absent, and reduce unnecessary scope. |
| `CLOUDFLARE_ACCOUNT_ID` | The intended Cloudflare account ID. |

Add these environment **variables**:

| Variable | Value |
|---|---|
| `CLOUDFLARE_D1_DATABASE_ID` | Actual UUID of `barterbook-devnet`; required. |
| `APP_ORIGIN` | Exact HTTPS deployment origin; required. |
| `SITE_URL` | Actual public app URL; defaults to the origin. |
| `REPOSITORY_URL` | Actual public repository URL, or blank while unpublished. |
| `DEVNET_ASSETS_JSON` | Validated three-mint fixture registry; default `[]`. |
| `DEMO_PARTICIPANTS_JSON` | Authorized public participant metadata; default `[]`. |
| `SETTLEMENT_ENABLED` | `false` by default; enable only for the authorized rehearsal after fixture and hosted core-path checks, then complete real wallet proof. |
| `RPC_HISTORY_TRUSTED`, `FALLBACK_HISTORY_TRUSTED` | `false` unless each endpoint's authoritative coverage has been verified. |

`BUILD_ID` is set to the checked-out Git commit automatically. Store `SOLANA_RPC_URL` and an optional `SOLANA_RPC_FALLBACK_URL` as **Cloudflare Worker secrets**, using [deployment setup](deployment.md); the workflow neither reads nor uploads them. No wallet secret belongs in either provider.

Once the reviewed workflow is on the default branch, choose Actions → **Deploy devnet demo (manual)** → Run workflow. [GitHub requires `workflow_dispatch` on the default branch](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). The job accepts only that branch. It reruns tests/build, creates an ignored deployment config from variables, records a D1 bookmark, applies migrations, then deploys the single Worker. Concurrent deployments wait rather than cancel a migration.

A green job establishes that those commands succeeded; it does not prove a wallet transaction or hosted CPU headroom. Perform the public browser checks, save the actual URL/version/commit, and keep any failed migration's log for repair. No push-triggered deployment is configured. Do not run a cloud database restore as an automated rollback.
