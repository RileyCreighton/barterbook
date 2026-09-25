# Contributing

Discuss the concrete problem and keep changes bounded. This release prioritizes a complete two-for-one basket and three-owner exact-lot exchange. Custom programs, custody, arbitrary basket cycles, standing delegated orders and mainnet asset tests are outside its scope.

Use Node.js 26.8.2 and install pinned dependencies with `npm ci --ignore-scripts`. Start from the [local setup](README.md) with settlement disabled. Use [deployment](docs/deployment.md) only for an explicitly intended remote release; ordinary contributions need no provider secrets or funded wallet.

Before proposing a financial or signing change, run the relevant tests and then `npm test` and `npm run build`. Add meaningful regression tests for changed financial behavior rather than tests that repeat implementation details. Preserve raw integer strings/BigInt, independent instruction verification, immutable message bytes and conservative original-transaction recovery. Keep local/runtime, SDK, browser-wallet and public-network evidence distinctly labeled.

Database changes use new forward migration files. Never rewrite an already applied migration or delete a live attempt to make a test pass. Keep existing deployment and D1 schema compatibility in mind; document recovery implications. Frontend changes should remain useful without a wallet and accessible to a first-time judge.

Do not commit `.dev.vars`, `.env.deploy.local`, `.test-wallets/`, `.wrangler/`, provider URLs with keys, wallet exports or unresolved signed bytes. Do not change pinned Solana SDKs without checking instruction/wire behavior and licensing. Use the private reporting path in [SECURITY.md](SECURITY.md) for vulnerabilities.

Describe what changed, why, what actually ran, and any remaining gates. Include screenshots for visible changes and source/receipt evidence for execution claims. Do not submit competition entries or publish messages as part of a contribution.

By intentionally submitting a contribution to this repository, you license your original contribution under the project's Apache-2.0 license. Third-party work retains its own license; attribute it and preserve its notices. No contributor license agreement or transfer of copyright is implied.
