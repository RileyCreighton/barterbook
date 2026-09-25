import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AccountLayout,
  AccountState,
  AccountType,
  ExtensionType,
  MemoTransferLayout,
  MintLayout,
  PausableConfigLayout,
  ScaledUiAmountConfigLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TransferFeeAmountLayout,
  TransferFeeConfigLayout,
  TransferHookLayout,
} from "@solana/spl-token";
import { Buffer } from "buffer";
import { decodeAsset, validateTokenAccount } from "../src/server/chain";
import { b64 } from "../src/shared/crypto";
import { U64_MAX } from "../src/shared/amounts";
import { ata } from "../src/shared/transactions";
import type { Asset } from "../src/shared/types";

type Extension = { type: number; data: Buffer };
type RawInfo = NonNullable<Parameters<typeof decodeAsset>[1]>;
const key = () => Keypair.generate().publicKey;
const encode = <T>(
  layout: { span: number; encode(value: T, buffer: Uint8Array): number },
  value: T,
) => {
  const buffer = Buffer.alloc(layout.span);
  layout.encode(value, buffer);
  return buffer;
};
function packed(
  base: Buffer,
  accountType: AccountType,
  extensions: Extension[],
): Buffer {
  if (!extensions.length) return base;
  const data = Buffer.alloc(
    166 + extensions.reduce((sum, e) => sum + 4 + e.data.length, 0),
  );
  data.set(base);
  data[165] = accountType;
  let offset = 166;
  for (const extension of extensions) {
    data.writeUInt16LE(extension.type, offset);
    data.writeUInt16LE(extension.data.length, offset + 2);
    data.set(extension.data, offset + 4);
    offset += 4 + extension.data.length;
  }
  return data;
}
const info = (
  data: Buffer,
  program = TOKEN_2022_PROGRAM_ID.toBase58(),
): RawInfo => ({
  data: [b64(data), "base64"],
  owner: program,
  lamports: 3_000_000,
  executable: false,
  rentEpoch: 0,
});
function mintFixture(extras: Extension[] = [], maximumFee = U64_MAX) {
  const mint = key();
  const authority = key();
  const fee = {
    type: ExtensionType.TransferFeeConfig,
    data: encode(TransferFeeConfigLayout, {
      transferFeeConfigAuthority: authority,
      withdrawWithheldAuthority: authority,
      withheldAmount: 0n,
      olderTransferFee: { epoch: 0n, maximumFee, transferFeeBasisPoints: 100 },
      newerTransferFee: {
        epoch: 100n,
        maximumFee: maximumFee - 1n,
        transferFeeBasisPoints: 300,
      },
    }),
  };
  const extensions = [fee, ...extras];
  const base = encode(MintLayout, {
    mintAuthorityOption: 1 as const,
    mintAuthority: authority,
    supply: U64_MAX,
    decimals: 6,
    isInitialized: true,
    freezeAuthorityOption: 1 as const,
    freezeAuthority: authority,
  });
  const asset: Asset = {
    cluster: "devnet",
    mint: mint.toBase58(),
    symbol: "LOCAL-COMPAT",
    name: "Raw-buffer compatibility fixture, not a chain asset",
    decimals: 6,
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
    hasTransferFee: true,
    olderFee: {
      epoch: "0",
      basisPoints: 100,
      maximumFeeRaw: maximumFee.toString(),
    },
    newerFee: {
      epoch: "100",
      basisPoints: 300,
      maximumFeeRaw: (maximumFee - 1n).toString(),
    },
    observedEpoch: "0",
    observedSlot: "0",
    observedAt: 0,
    extensions: extensions.map((e) => e.type),
    multiplier: "1",
    pendingMultiplier: "1",
    tested: true,
    mock: true,
  };
  return {
    asset,
    authority,
    base,
    extensions,
    rawInfo: info(packed(base, AccountType.Mint, extensions)),
  };
}
function tokenFixture(
  extras: Extension[] = [],
  overrides: Partial<Parameters<typeof AccountLayout.encode>[0]> = {},
) {
  const { asset } = mintFixture();
  const owner = key();
  const base = encode(AccountLayout, {
    mint: new PublicKey(asset.mint),
    owner,
    amount: U64_MAX,
    delegateOption: 0 as const,
    delegate: PublicKey.default,
    state: AccountState.Initialized,
    isNativeOption: 0 as const,
    isNative: 0n,
    delegatedAmount: 0n,
    closeAuthorityOption: 0 as const,
    closeAuthority: PublicKey.default,
    ...overrides,
  });
  const extensions: Extension[] = [
    {
      type: ExtensionType.TransferFeeAmount,
      data: encode(TransferFeeAmountLayout, { withheldAmount: 123n }),
    },
    { type: ExtensionType.ImmutableOwner, data: Buffer.alloc(0) },
    ...extras,
  ];
  return {
    asset,
    owner: owner.toBase58(),
    address: ata(owner.toBase58(), asset.mint, asset.tokenProgram),
    rawInfo: info(packed(base, AccountType.Account, extensions)),
    extensions,
  };
}
const memo = (required: boolean): Extension => ({
  type: ExtensionType.MemoTransfer,
  data: encode(MemoTransferLayout, { requireIncomingTransferMemos: required }),
});
const scaled = (multiplier: number, next: number): Extension => ({
  type: ExtensionType.ScaledUiAmountConfig,
  data: encode(ScaledUiAmountConfigLayout, {
    authority: key(),
    multiplier,
    newMultiplierEffectiveTimestamp: 9_999_999_999n,
    newMultiplier: next,
  }),
});
const hook = (active: boolean): Extension => ({
  type: ExtensionType.TransferHook,
  data: encode(TransferHookLayout, {
    authority: key(),
    programId: active ? key() : PublicKey.default,
  }),
});
const paused = (value: boolean): Extension => ({
  type: ExtensionType.PausableConfig,
  data: encode(PausableConfigLayout, { authority: key(), paused: value }),
});

describe("raw mint compatibility gate (no RPC calls)", () => {
  it("decodes both fee caps and supply above Number safe range without precision loss", () => {
    const f = mintFixture();
    const result = decodeAsset(f.asset, f.rawInfo, "101", "123");
    expect(result.asset.olderFee.maximumFeeRaw).toBe("18446744073709551615");
    expect(result.asset.newerFee.maximumFeeRaw).toBe("18446744073709551614");
    expect(result.mint.supply).toBe(U64_MAX);
    expect(result.asset).toMatchObject({
      observedEpoch: "101",
      observedSlot: "123",
      hasTransferFee: true,
    });
  });
  it("allows fee-bearing mints with inactive hook, unpaused state and unchanged multiplier", () => {
    const f = mintFixture([hook(false), paused(false), scaled(1, 1)]);
    expect(() => decodeAsset(f.asset, f.rawInfo, "1", "100")).not.toThrow();
  });
  it.each([
    ["active transfer hook", () => hook(true), /Active transfer hooks/],
    ["paused mint", () => paused(true), /paused/],
    ["changed current multiplier", () => scaled(2, 1), /multiplier/],
    ["pending changed multiplier", () => scaled(1, 2), /multiplier/],
    ["nonfinite multiplier", () => scaled(Number.NaN, 1), /multiplier/],
  ] as const)(
    "rejects %s even when that extension type was registered",
    (_name, extension, error) => {
      const f = mintFixture([extension()]);
      expect(() => decodeAsset(f.asset, f.rawInfo, "1", "100")).toThrow(error);
    },
  );
  it("rejects an unknown extension even if a caller tries to include it in the manifest", () => {
    const f = mintFixture([{ type: 65534, data: Buffer.alloc(0) }]);
    expect(() => decodeAsset(f.asset, f.rawInfo, "1", "100")).toThrow(
      /untested extensions/,
    );
  });
  it("rejects a newly introduced otherwise-recognized extension absent from the tested manifest", () => {
    const f = mintFixture([paused(false)]);
    f.asset.extensions = [ExtensionType.TransferFeeConfig];
    expect(() => decodeAsset(f.asset, f.rawInfo, "1", "100")).toThrow(
      /untested extensions/,
    );
  });
  it("rejects a mint account owned by the wrong token program", () => {
    const f = mintFixture();
    f.rawInfo.owner = TOKEN_PROGRAM_ID.toBase58();
    expect(() => decodeAsset(f.asset, f.rawInfo, "1", "100")).toThrow();
  });
  it("rejects changed decimals, missing mint and uninitialized mint", () => {
    const f = mintFixture();
    expect(() =>
      decodeAsset({ ...f.asset, decimals: 9 }, f.rawInfo, "1", "100"),
    ).toThrow(/decimals/);
    expect(() => decodeAsset(f.asset, null, "1", "100")).toThrow();
    const base = Buffer.from(f.base);
    base[45] = 0;
    expect(() =>
      decodeAsset(
        f.asset,
        info(packed(base, AccountType.Mint, f.extensions)),
        "1",
        "100",
      ),
    ).toThrow(/initialization/);
  });
  it("rejects changes in the declared fee-extension policy", () => {
    const f = mintFixture();
    expect(() =>
      decodeAsset({ ...f.asset, hasTransferFee: false }, f.rawInfo, "1", "100"),
    ).toThrow(/fee extension/);
  });
});

describe("raw token-account authority and transfer requirement gate (no RPC calls)", () => {
  it("accepts a fee-bearing account with immutable owner and preserves spendable raw balance", () => {
    const f = tokenFixture();
    const account = validateTokenAccount(
      f.asset,
      f.owner,
      f.address,
      f.rawInfo,
    );
    expect(account.amount).toBe(U64_MAX);
    expect(account.amount.toString()).toBe("18446744073709551615");
    // Withheld fees are separate; spendable amount must not be reduced a second time.
    expect(account.amount).not.toBe(U64_MAX - 123n);
  });
  it("permits a present MemoTransfer extension when incoming memos are not required", () => {
    const f = tokenFixture([memo(false)]);
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).not.toThrow();
  });
  it("rejects memo-required recipients", () => {
    const f = tokenFixture([memo(true)]);
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).toThrow(/transfer requirements/);
  });
  it.each([
    ["frozen", { state: AccountState.Frozen }],
    ["uninitialized", { state: AccountState.Uninitialized }],
    [
      "unexpected delegate",
      { delegateOption: 1 as const, delegate: key(), delegatedAmount: 10n },
    ],
    [
      "unexpected close authority",
      { closeAuthorityOption: 1 as const, closeAuthority: key() },
    ],
    [
      "native/wrapped SOL account",
      { isNativeOption: 1 as const, isNative: 1000000n },
    ],
    ["wrong token mint", { mint: key() }],
  ] as const)("rejects %s", (_name, overrides) => {
    const f = tokenFixture([], overrides);
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).toThrow(/authority|state|mint/);
  });
  it("rejects a token account whose spending authority is a different wallet", () => {
    const f = tokenFixture();
    expect(() =>
      validateTokenAccount(f.asset, key().toBase58(), f.address, f.rawInfo),
    ).toThrow(/authority/);
  });
  it("rejects a token account owned by a different token program", () => {
    const f = tokenFixture();
    f.rawInfo.owner = TOKEN_PROGRAM_ID.toBase58();
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).toThrow();
  });
  it.each([
    ExtensionType.ConfidentialTransferAccount,
    ExtensionType.CpiGuard,
    65534,
  ])("rejects unsupported account extension %s", (type) => {
    const f = tokenFixture([{ type, data: Buffer.alloc(1) }]);
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).toThrow(/transfer requirements/);
  });
  it("requires raw base64 account data rather than trusting parsed RPC quantities", () => {
    const f = tokenFixture();
    f.rawInfo.data[1] = "jsonParsed";
    expect(() =>
      validateTokenAccount(f.asset, f.owner, f.address, f.rawInfo),
    ).toThrow(/base64/);
  });
});
