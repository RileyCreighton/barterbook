# Security policy

BarterBook 0.1.x is an unaudited devnet prototype. Mainnet settlement is disabled. Local tests and program execution are evidence of specific checks, not a security certification or proof of real browser-wallet compatibility.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** private channel when the maintainer has enabled it. No private reporting address or response SLA is currently promised. If private reporting is unavailable, contact the maintainer privately through a channel they publish before sending sensitive details. Do not post private keys, seed phrases, cookies, provider endpoints, unresolved signed transaction bytes or an exploit against someone else's funds in a public issue.

Include the affected commit, exact local reproduction, expected/actual result, and relevant test-wallet public identifiers. Use disposable local/devnet fixtures only. Do not acquire assets, test on user wallets or run a mainnet exploit to demonstrate a finding.

## Settlement invariants

- Accepted raw gross/net quantities, fees, participants, programs and accounts determine every permitted instruction.
- Each browser checks the complete frozen message before signing; a changed message requires every signature again.
- Full signed bytes, locally derived transaction ID, lifetime and submission-started state are durable before broadcast.
- Timeout, preflight error and cancellation do not authorize replacement. Original success evidence survives later missing/conflicting provider history.
- Only the original transaction's metadata can verify a receipt. A database rollback cannot reverse chain execution.
- Provider keys are server secrets; private wallet keys never enter application storage. Fixture script keys remain ignored local test material.

When responding to an incident, stop new signing/settlement, preserve current attempt journals and reconcile original identifiers before any restore, unlock or replacement. Keep authentication and recovery records out of public artifacts. See [deployment recovery](docs/deployment.md) and [the evidence checklist](docs/evidence-and-wallet-smoke.md).

Dependency updates require review of runtime compatibility and license obligations. Preserve the LGPL dependency notices/source described in [attribution](docs/third-party-attribution.md). Rotate exposed provider credentials immediately; removing them from the latest commit does not remove historical exposure.
