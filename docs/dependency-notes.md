# Pinned dependencies and audit boundary

The tested chain representation is `@solana/web3.js` 1.99.0 with `@solana/spl-token` 0.4.15. Both browser and Worker use that same legacy transaction representation. The local execution test runtime is the compatible `litesvm` 0.8.0 release; its keys and VM exist only in tests.

Hono 4.13.9, Vite 7.3.6 and Vitest 4.1.11 were selected after checking available patch releases and advisory results. The lockfile fixes the full dependency tree. Use `npm ci --ignore-scripts` as documented: the application and Worker use JavaScript codecs and native platform Web Crypto; native bigint-buffer bindings are not needed. The optional prebuilt LiteSVM library is a local test dependency.

The September 25 dependency audit still reports transitive advisories under the legacy Solana SDK: bigint-buffer native conversion, jayson/stream-json and uuid. The suggested automated SDK downgrade removes the Token-2022 API and is not an acceptable fix. The application does not instantiate a jayson server, use its streaming parser, or expose a generic RPC relay; server RPC uses bounded JSON `fetch`. Workers/browser builds cannot load the native bigint-buffer binding. These are scope observations, not a security audit or proof that every dependency risk is eliminated. Retest before changing the pinned chain pair.

No production security audit is claimed. Mainnet settlement remains disabled, and browser-wallet/devnet/hosted gates are tracked separately in the execution evidence.
