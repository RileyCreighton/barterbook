# Local Solana program execution evidence

The three tests in `tests/local-runtime.test.ts` passed using **LiteSVM 0.8.0**, an in-process Solana runtime. This is actual execution of its bundled Token-2022 and associated-token programs with native signature and blockhash checks enabled. It is **not devnet/mainnet execution, a public transaction receipt, browser-wallet compatibility proof or PRE-token testing**.

| Executed local case | Owners | Signed wire | Observed network fee | Result |
|---|---:|---:|---:|---|
| Fee-aware two-for-one basket; three missing receiving ATAs | 2 | 774 bytes | 10,000 lamports | All three gross debits, net credits and withheld fees matched |
| Fee-aware three-way cycle; three missing receiving ATAs | 3 | 870 bytes | 15,000 lamports | All three whole lots settled with exact net receipts |
| Final transfer deliberately exceeds its source balance | 3 | 870 bytes | 15,000 lamports | Instruction 7 failed; previous token changes and all receiving ATA creations rolled back |

The JSON artifact records the latest run's exact compute usage and timestamp. Fresh fixture addresses can change address-derivation compute usage between runs.

The successful cases each funded three 182-byte Token-2022 ATAs, including `ImmutableOwner`, for 6,472,800 local lamports total. The failed case preserved all three source balances and left all three destination accounts absent. Its network fee was still charged.

Every fixture mint is created through the Token-2022 program. A separate fee-bearing transfer checks its real local net credit and withheld fee before the asset is marked tested inside that runtime. The exchange then uses the application’s shared builder, independent instruction verifier and signature merger. Message hashes remain identical after every sequential SDK signature. Keys are freshly generated in memory and discarded; there are no RPC calls or wallet-file reads in this harness.

The [JSON evidence](../evidence/local/litesvm-execution.json) contains native execution logs, compute usage, message hashes, local signatures and account changes captured immediately around each single synchronous transaction. The network fee is derived from that isolated payer change after subtracting observed new-account funding, because this pinned runtime's metadata API does not expose a fee field. It is not presented as `getTransaction` RPC metadata. Local signatures must never become devnet explorer links.

Reproduce with:

```sh
npm ci --ignore-scripts
npx vitest run tests/local-runtime.test.ts
```

The runtime is deliberately pinned to the latest 0.x release retaining the existing web3.js transaction API, avoiding a second transaction representation in the harness. Its bundled program/runtime versions can differ from a live Solana cluster. Public-network settlement, actual browser extensions, hosted RPC recovery and deployment still require their separate evidence gates. See [LiteSVM upstream](https://github.com/LiteSVM/litesvm) and the [pinned package](https://www.npmjs.com/package/litesvm/v/0.8.0).
