# Third-party attribution

BarterBook is one application assembled with existing open-source libraries and Solana programs. This acknowledgement is not a replacement for the licenses shipped with dependencies. Exact installed versions and license metadata should be taken from the checked-in lockfile/package manifests before release; do not claim that a planned library was installed or audited.

## Software and services

| Component | Role | Upstream |
|---|---|---|
| React | Browser interface | [React](https://react.dev/) |
| Vite | Frontend development and build | [Vite](https://vite.dev/) |
| TypeScript | Shared static types | [TypeScript](https://www.typescriptlang.org/) |
| Hono | Worker HTTP API | [Hono](https://hono.dev/) |
| Cloudflare Workers, D1 and Wrangler | Hosting/runtime, database and deployment tooling | [Cloudflare developer documentation](https://developers.cloudflare.com/) |
| Solana web3.js and SPL Token SDK | Transaction representation, instruction construction and token decoding | [Solana web3.js](https://github.com/solana-foundation/solana-web3.js), [Token program sources](https://github.com/solana-program/token), [Token-2022](https://github.com/solana-program/token-2022) |
| Wallet Standard / selected browser wallets | Participant-controlled signing, where used | [Wallet Standard](https://github.com/wallet-standard/wallet-standard) |
| Vitest | Automated tests, where installed | [Vitest](https://vitest.dev/) |
| LiteSVM 0.8.0 | Local in-process Token-2022 execution and rollback tests; not included in the Worker/browser app | [LiteSVM upstream](https://github.com/LiteSVM/litesvm), [pinned package](https://www.npmjs.com/package/litesvm/v/0.8.0) |
| Helius | Server-side Solana RPC provider when configured | [Helius](https://www.helius.dev/docs) |
| PreStocks catalog | Mainnet identity/reference research, separate from fixture assets | [Official catalog](https://prestocks.com/api/prestocks) |

Provider and issuer names identify integrations or research sources; they do not imply endorsement. Devnet test assets must have their own names and addresses. No issuer price mark is treated as an executable price or proof of savings.

## Research precedents

The product specification acknowledges [Confide](https://github.com/psyto/confide) for bilateral stock barter, [Uncross](https://github.com/Uncross-Org/uncross) for stock auctions, [CoW Protocol](https://docs.cow.fi/cow-protocol/concepts/how-it-works/coincidence-of-wants) for multi-user matching concepts, and [Loopring's historical whitepaper](https://loopring.org/resources/en_whitepaper.pdf) for order-ring precedent. These are conceptual references, not a claim that their code is incorporated. If code is copied, record the exact source revision, files and applicable license here.

The architecture uses existing token programs rather than deploying a new onchain program. Do not describe all underlying token restrictions as app controls: issuer freeze, pausing, transfer-fee and other authorities retain their own roles.

## Release inventory and licenses

Original BarterBook code uses [Apache License 2.0](../LICENSE), with [NOTICE](../NOTICE). Installed dependency names, versions, source-package URLs and license metadata are recorded in [the release inventory](release/dependency-inventory.json); [retained production license texts](third-party-licenses.txt) accompany it. The inventory is derived from the pinned lockfile and installed packages, not a legal audit of every transitive source file.

`rpc-websockets` **9.3.9**, pulled in by Solana web3.js, is **LGPL-3.0-only**. It has not been relicensed or modified. [The exact upstream source archive](vendor/rpc-websockets-9.3.9-source.tar.gz), [source identity/checksum](vendor/rpc-websockets-source.json), [LGPL text](vendor/LGPL-3.0.txt) and [GPL text](vendor/GPL-3.0.txt) are included. The archive is 1.41 MB and includes TypeScript source and its build configuration. The app’s complete source, `package-lock.json` and setup/build commands must accompany any public release so recipients can change that library and rebuild. No additional restriction on reverse engineering for debugging such modifications is imposed by this project.

Run `node .github/scripts/prepare-legal.mjs` after the application build. It places the notices and dependency source under `dist/legal/` for the same host as the app. Both checked-in workflows do this. Confirm `/legal/LICENSE`, `/legal/NOTICE`, `/legal/third-party-licenses.txt` and `/legal/rpc-websockets-9.3.9-source.tar.gz` load after deployment, and publish the actual corresponding application source revision. A source link without the matching source release is not sufficient.

To replace or inspect the library, extract the supplied archive outside this repository, follow its own package/build instructions, then point a development copy of this app’s `rpc-websockets` dependency resolution to that rebuilt package and rebuild with the documented toolchain. Keep the resulting dependency lockfile with that modified release. This project provides source and reproducible dependency identities; it does not claim bit-identical bundles across systems.

The direct development dependencies have permissive licenses; some transitive Wrangler image tooling includes LGPL `libvips` binaries. Those development tools are not copied into the hosted app by the release packaging script. If distributing `node_modules`, a development container or those binaries, preserve their additional licenses and source obligations separately.

The UI uses code/CSS and system fonts; no purchased image or proprietary font has been added in this release task. Research references above are conceptual, not copied implementations. Recheck this inventory when dependencies or assets change.
