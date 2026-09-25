# Free service limits checked September 25, 2026

These are current published limits, not measured capacity of this app. Account dashboards can impose additional restrictions. No paid plan, credit purchase or automated signup was used for this check.

| Service | Published free allowance relevant to this MVP | Release implication |
|---|---|---|
| Cloudflare Workers | 100,000 dynamic requests/day; 10 ms CPU/request; 128 MB memory; 50 subrequests/request | Profile complete hosted API paths. Network waiting is excluded from CPU, but signature checks, parsing and encoding count. |
| Workers static assets | Static asset requests are free and unlimited; 20,000 files/version, 25 MiB/file on Free | One Worker serves the frontend. API requests still use Worker resources. |
| D1 | 5 million rows read/day, 100,000 rows written/day, 5 GB total account storage | Scanned rows count; bound matching and polling. Daily exhaustion can interrupt service. |
| D1 operational limits | 10 databases/account, 500 MB/database, 50 queries/Worker invocation; seven-day Time Travel | A small single database fits the intended shape. A historical restore cannot erase executable attempt records. |
| GitHub Actions | Standard hosted runners are free for public repositories | This project uses standard `ubuntu-latest`; no larger paid runner. |
| Helius Free | 1 million credits/month; 10 RPC requests/second; 1 `sendTransaction`/second; one API key | Credits are not identical to request count. Retain durable request pacing and explicit uncertainty after timeouts. |

Primary sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [static-asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Helius plans](https://www.helius.dev/docs/billing/plans), [Helius public pricing](https://www.helius.dev/pricing).

The Helius dashboard Free plan is distinct from its programmatic Agent signup, which the published plans page says requires 1 USDC. Do not use that paid signup path here. No paid data product, streaming add-on or wallet-as-a-service is needed.

The early local workerd profile averaged about 4.74 ms sampled active CPU per warmed strict three-owner verification. It does not establish hosted full-request headroom, cold starts or a tail percentile. Measure hosted core paths first, then measure financial paths during the authorized Devnet rehearsal before declaring trading verified; optimize repeated work without weakening financial verification. A quota error or CPU limit does not make a signed attempt safe to replace.

Deployment references: [Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), [D1 setup](https://developers.cloudflare.com/d1/get-started/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/). Limits and terms should be rechecked if deploying on another date.

GitHub source: [standard hosted runner billing](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
