# Source checks and provider gates

Public sources checked September 25, 2026. A documentation check establishes published behavior/limits; it is not a successful account provisioning, deployment or application benchmark.

## Public form evidence

The logged-out [Stocklana submission page](https://hackathons.solana.com/hackathons/stocklana/submit) was fetched without signing in. Its current script URLs were retrieved at `2026-09-25T04:14:13Z`.

| Public asset | SHA-256 | Observed evidence |
|---|---|---|
| [Form script](https://hackathons.solana.com/_next/static/chunks/9028d10e94052f9f.js) | `aa2df98c956091cbf90a0ac6e3f32999fc1b188da063037359d8ddd079da6d7c` | Short and full textareas bind `maxLength` to exported constants; separate draft and final actions. |
| [Constants script](https://hackathons.solana.com/_next/static/chunks/9032bfd6f2a41198.js) | `ba36338030fb353edd5057a8a7d844d4aefe9d831e975c60f2bbb6a090dcf6ee` | `MAX_SHORT_DESCRIPTION_LENGTH=280`; `MAX_LONG_DESCRIPTION_LENGTH=5000`; `MAX_BOUNTY_TRACKS_PER_SUBMISSION=3`. |

The [event rules](https://hackathons.solana.com/hackathons/stocklana) and [platform guidance](https://hackathons.solana.com/how-it-works) were independently read. The submission draft records their relevant requirements. Account-specific requirements, authenticated validation and final submission status remain untested. No form mutation or external message was sent.

## Worker Free CPU gate

[Cloudflare's current limits](https://developers.cloudflare.com/workers/platform/limits/) list 10 ms CPU per HTTP request and 100,000 requests/day on Free. Network/database waiting does not count as CPU. Cloudflare reports CPU and wall time separately in invocation logs and supports local DevTools profiling. A local elapsed-time benchmark is useful directional evidence; it is not a hosted CPU-limit certification.

Before declaring the Free tier suitable, profile these actual request paths with representative input and worst allowed sizes:

| Request path | Required workload |
|---|---|
| Authentication | Challenge verification with native Ed25519; nonce consumption and session handling. |
| Prepare | Maximum supported instruction decoding/building, account/fee checks and serialization. |
| Signature upload | Full message verification plus one Ed25519 verification and durable update. |
| Submit/reconcile | All signatures, strict instruction verification and receipt metadata decoding. |
| Three-way match | Maximum bounded candidate count; reject false-positive net cycles. |
| Room polling | Indexed D1 read, authorization and compact serialization; no repeated full mint decoding per poll. |

Record runtime/version, build, fixture sizes, cold/warm samples, sample count and observed CPU distribution. Include hosted invocation CPU when access exists. Keep strict verification intact if a path exceeds budget; first reduce duplicate work, cap candidates, and use native crypto. A paid upgrade is an explicit user decision, not an automatic fallback. No paid service was purchased by this documentation task.

[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) lists standard `Ed25519`, SHA-256, random values and UUID support. Prefer those native APIs where compatible and prove the deployed runtime path. No wallet/private signing key belongs in the Worker.

## Solana evidence boundaries

[Partial signing](https://solana.com/docs/core/transactions/partial-signing) requires each signer to approve the same bytes; changing payer, blockhash, accounts or instructions invalidates prior signatures. Its example uses local keys, so it is not proof that a selected browser extension preserves partial signatures. Test actual extensions separately.

Use official [simulation options](https://solana.com/docs/rpc/http/simulatetransaction), [send semantics](https://solana.com/docs/rpc/http/sendtransaction), [history-aware status](https://solana.com/docs/rpc/http/getsignaturestatuses), [transaction receipt metadata](https://solana.com/docs/rpc/http/gettransaction), and [transfer fees](https://solana.com/docs/tokens/extensions/transfer-fees) when reviewing implementation. A successful RPC send response is not confirmation, a simulation is not settlement, and a null cached status is not proof of absence.

PRE identity comes from the [issuer catalog](https://prestocks.com/api/prestocks), while fresh chain state controls transfer compatibility. Read the [issuer legal FAQ](https://prestocks.com/faq?tab=legal) before eligible authorized real-token testing. The site may render terms dynamically; recorded prior research does not replace participant eligibility confirmation. This source check did not determine any person's eligibility or obtain sponsor approval for a fixture-only demo.
