import { createPrivateKey, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { b64, equalBytes, unb64 } from "../src/shared/crypto";
import {
  buildTransaction,
  unsignedWire,
  verifyWireSignatures,
  wireParts,
} from "../src/shared/transactions";
import {
  connectWallet,
  connectionIsCurrent,
  signFrozenTransaction,
  signNonceOperation,
  signWalletMessage,
  watchWalletConnection,
} from "../src/client/wallet";
import type { BrowserAccount, BrowserWallet } from "../src/client/wallet";
import { fixture } from "./fixtures";
import {
  nonceAddress,
  nonceOperationWire,
  verifyNonceOperation,
  type NonceOperation,
  type NonceOperationPlan,
} from "../src/shared/nonce";

function detachedSignature(key: Keypair, message: Uint8Array): Uint8Array {
  const privateKey = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(key.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  return new Uint8Array(sign(null, message, privateKey));
}

it("never prompts a payer when encoded ATA creations exceed its accepted SOL allowance", async () => {
  const f = fixture();
  const wire = unsignedWire(f.plan);
  const adapter = fakeWallet(f.owners[0]);
  const connection = await connectWallet(adapter.wallet);
  f.plan.accountRentLamports = "0";
  f.terms.maxAccountRentLamports = "0";
  await expect(
    signFrozenTransaction(connection, wire, f.plan, f.terms),
  ).rejects.toThrow(/allowance/);
  expect(adapter.signTransaction).not.toHaveBeenCalled();
});

function fakeWallet(
  key: Keypair,
  transform?: (bytes: Uint8Array) => Uint8Array,
) {
  const account: BrowserAccount = {
    address: key.publicKey.toBase58(),
    publicKey: key.publicKey.toBytes(),
    chains: ["solana:devnet"],
    features: ["solana:signMessage", "solana:signTransaction"],
  };
  let accounts: readonly BrowserAccount[] = [account];
  const listeners = new Set<() => void>();
  const connect = vi.fn(async () => ({ accounts: [account] }));
  const signTransaction = vi.fn(async (input: { transaction: Uint8Array }) => {
    const transaction = Transaction.from(input.transaction);
    transaction.partialSign(key);
    const signed = new Uint8Array(
      transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }),
    );
    return [{ signedTransaction: transform ? transform(signed) : signed }];
  });
  const signMessage = vi.fn(async (input: { message: Uint8Array }) => {
    return [
      {
        signedMessage: input.message,
        signature: detachedSignature(key, input.message),
        signatureType: "ed25519",
      },
    ];
  });
  const wallet: BrowserWallet = {
    version: "1.0.0",
    name: "Fake test adapter — not an extension proof",
    icon: "data:image/png;base64,",
    chains: ["solana:devnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": { connect },
      "standard:events": {
        on: (_event: "change", listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
      "solana:signMessage": { signMessage },
      "solana:signTransaction": {
        supportedTransactionVersions: ["legacy"],
        signTransaction,
      },
    },
  };
  return {
    wallet,
    account,
    signTransaction,
    signMessage,
    connect,
    setAccounts(next: readonly BrowserAccount[]) {
      accounts = next;
      listeners.forEach((listener) => listener());
    },
  };
}

function fakeSolflare(key: Keypair) {
  const adapter = fakeWallet(key);
  Object.defineProperty(adapter.wallet, "name", { value: "Solflare" });
  const provider = {
    isSolflare: true,
    isConnected: true,
    publicKey: key.publicKey,
    request: vi.fn(
      async (input: { method: string; params: { message: string } }) => ({
        publicKey: key.publicKey.toBase58(),
        signature: bs58.encode(
          detachedSignature(key, bs58.decode(input.params.message)),
        ),
      }),
    ),
  };
  vi.stubGlobal("window", { solflare: provider });
  return { ...adapter, provider };
}

describe("Solflare transaction-message compatibility (fake provider, not extension proof)", () => {
  afterEach(() => vi.unstubAllGlobals());
  for (const count of [2, 3])
    it(`collects ${count} durable approvals through Solflare's exact-message path`, async () => {
      const f = fixture(count);
      f.terms.feePayer = f.owners[1].publicKey.toBase58();
      f.terms.nonceAccount = await nonceAddress(f.terms.feePayer);
      f.plan.lastValidBlockHeight = "0";
      let wire = unsignedWire(f.plan);
      const original = wireParts(unb64(wire)).message;
      for (const key of [f.owners[1], f.owners[0], ...f.owners.slice(2)]) {
        const adapter = fakeSolflare(key);
        wire = await signFrozenTransaction(
          await connectWallet(adapter.wallet),
          wire,
          f.plan,
          f.terms,
        );
        expect(wireParts(unb64(wire)).message).toEqual(original);
      }
      await verifyWireSignatures(unb64(wire), f.plan, true);
    });
  for (const kind of ["setup", "cancel"] as const)
    it(`uses transaction approval for the single-signer ${kind} without signMessage`, async () => {
      const f = fixture(),
        key = f.owners[0],
        wallet = key.publicKey.toBase58(),
        adapter = fakeSolflare(key);
      const plan: NonceOperationPlan = {
        kind,
        wallet,
        nonceAccount: await nonceAddress(wallet),
        blockhash: f.plan.blockhash,
        contextSlot: "1",
        lastValidBlockHeight: kind === "cancel" ? "0" : "500",
        rentLamports: kind === "setup" ? "1447680" : "0",
        networkFeeLamports: "5000",
        ...(kind === "cancel" ? { attemptId: "original" } : {}),
      };
      const op: NonceOperation = {
        id: "local",
        plan,
        wireBase64: await nonceOperationWire(plan),
        signedWireBase64: null,
        txid: null,
        state: "PREPARED",
        createdAt: Date.now(),
        error: null,
      };
      const wire = await signNonceOperation(
        await connectWallet(adapter.wallet),
        op,
      );
      await verifyNonceOperation(unb64(wire), plan, true);
      expect(adapter.provider.request).toHaveBeenCalledOnce();
      expect(adapter.signMessage).not.toHaveBeenCalled();
      expect(adapter.signTransaction).not.toHaveBeenCalled();
    });

  for (const count of [2, 3])
    it(`collects ${count} exact signatures with Bob as payer without sending earlier signatures to Solflare`, async () => {
      const f = fixture(count);
      f.terms.feePayer = f.owners[1].publicKey.toBase58();
      let wire = unsignedWire(f.plan);
      const original = wireParts(unb64(wire)).message;
      for (const owner of [f.owners[1], f.owners[0], ...f.owners.slice(2)]) {
        const adapter = fakeSolflare(owner);
        const before = wireParts(unb64(wire));
        wire = await signFrozenTransaction(
          await connectWallet(adapter.wallet),
          wire,
          f.plan,
          f.terms,
        );
        expect(adapter.provider.request).toHaveBeenCalledExactlyOnceWith({
          method: "signTransaction",
          params: { message: bs58.encode(original) },
        });
        expect(adapter.signTransaction).not.toHaveBeenCalled();
        expect(adapter.signMessage).not.toHaveBeenCalled();
        const after = wireParts(unb64(wire));
        expect(after.message).toEqual(original);
        for (let i = 0; i < before.signers.length; i++)
          if (before.signers[i] !== owner.publicKey.toBase58())
            expect(after.signatures[i]).toEqual(before.signatures[i]);
      }
      await verifyWireSignatures(unb64(wire), f.plan, true);
    });

  it("rejects a signature over a changed blockhash without retrying another signing method", async () => {
    const f = fixture();
    const adapter = fakeSolflare(f.owners[0]);
    const changed = buildTransaction(f.plan);
    changed.recentBlockhash = Keypair.generate().publicKey.toBase58();
    adapter.provider.request.mockResolvedValueOnce({
      publicKey: f.owners[0].publicKey.toBase58(),
      signature: bs58.encode(
        detachedSignature(f.owners[0], changed.serializeMessage()),
      ),
    });
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        unsignedWire(f.plan),
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/different transaction|invalid signature/);
    expect(adapter.provider.request).toHaveBeenCalledOnce();
    expect(adapter.signTransaction).not.toHaveBeenCalled();
    expect(adapter.signMessage).not.toHaveBeenCalled();
  });

  it("rejects a correct-address response signed by another key", async () => {
    const f = fixture();
    const adapter = fakeSolflare(f.owners[0]);
    const wire = unsignedWire(f.plan);
    adapter.provider.request.mockResolvedValueOnce({
      publicKey: f.owners[0].publicKey.toBase58(),
      signature: bs58.encode(
        detachedSignature(f.owners[1], wireParts(unb64(wire)).message),
      ),
    });
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        wire,
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/invalid signature/);
  });

  for (const response of [
    undefined,
    {},
    { signature: "!".repeat(88) },
    { signature: "1".repeat(63) },
    { signature: "1".repeat(89) },
    { publicKey: "wrong", signature: "1".repeat(64) },
  ])
    it(`rejects malformed or wrong-account responses: ${JSON.stringify(response)}`, async () => {
      const f = fixture();
      const adapter = fakeSolflare(f.owners[0]);
      adapter.provider.request.mockResolvedValueOnce(response as never);
      await expect(
        signFrozenTransaction(
          await connectWallet(adapter.wallet),
          unsignedWire(f.plan),
          f.plan,
          f.terms,
        ),
      ).rejects.toThrow(/invalid transaction signature/);
    });

  for (const change of [
    "missing",
    "wrong account",
    "disconnected",
    "not Solflare",
  ])
    it(`does not prompt an injected provider that is ${change}`, async () => {
      const f = fixture();
      const adapter = fakeSolflare(f.owners[0]);
      if (change === "missing") vi.stubGlobal("window", {});
      if (change === "wrong account")
        adapter.provider.publicKey = f.owners[1].publicKey;
      if (change === "disconnected") adapter.provider.isConnected = false;
      if (change === "not Solflare") adapter.provider.isSolflare = false;
      await expect(
        signFrozenTransaction(
          await connectWallet(adapter.wallet),
          unsignedWire(f.plan),
          f.plan,
          f.terms,
        ),
      ).rejects.toThrow(/unavailable|account changed/);
      expect(adapter.provider.request).not.toHaveBeenCalled();
      expect(adapter.signTransaction).not.toHaveBeenCalled();
    });

  for (const change of [
    "provider replaced",
    "provider account",
    "standard account",
  ])
    it(`discards approval when ${change} changes during the prompt`, async () => {
      const f = fixture();
      const adapter = fakeSolflare(f.owners[0]);
      const original = adapter.provider.request.getMockImplementation()!;
      adapter.provider.request.mockImplementationOnce(async (input) => {
        const output = await original(input);
        if (change === "provider replaced")
          vi.stubGlobal("window", { solflare: { ...adapter.provider } });
        if (change === "provider account")
          adapter.provider.publicKey = f.owners[1].publicKey;
        if (change === "standard account") adapter.setAccounts([]);
        return output;
      });
      await expect(
        signFrozenTransaction(
          await connectWallet(adapter.wallet),
          unsignedWire(f.plan),
          f.plan,
          f.terms,
        ),
      ).rejects.toThrow(/account changed/);
    });

  it("preserves a cancellation or unsupported-method error without a second prompt", async () => {
    const f = fixture();
    const adapter = fakeSolflare(f.owners[0]);
    const error = new Error("Transaction cancelled");
    adapter.provider.request.mockRejectedValueOnce(error);
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        unsignedWire(f.plan),
        f.plan,
        f.terms,
      ),
    ).rejects.toBe(error);
    expect(adapter.provider.request).toHaveBeenCalledOnce();
    expect(adapter.signTransaction).not.toHaveBeenCalled();
    expect(adapter.signMessage).not.toHaveBeenCalled();
  });

  it("rejects unapproved terms before requesting a Solflare signature", async () => {
    const f = fixture();
    const adapter = fakeSolflare(f.owners[0]);
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        unsignedWire(f.plan),
        f.plan,
        { ...f.terms, version: 2 },
      ),
    ).rejects.toThrow(/accepted terms/);
    expect(adapter.provider.request).not.toHaveBeenCalled();
  });

  it("keeps other selected wallets on Wallet Standard even when Solflare is installed", async () => {
    const f = fixture();
    const solflare = fakeSolflare(f.owners[0]);
    const adapter = fakeWallet(f.owners[0]);
    await signFrozenTransaction(
      await connectWallet(adapter.wallet),
      unsignedWire(f.plan),
      f.plan,
      f.terms,
    );
    expect(solflare.provider.request).not.toHaveBeenCalled();
    expect(adapter.signTransaction).toHaveBeenCalledOnce();
  });
});

describe("account changes (fake adapters only, not extension evidence)", () => {
  it("refuses to silently select one of multiple returned devnet accounts", async () => {
    const first = fakeWallet(Keypair.generate()),
      second = fakeWallet(Keypair.generate());
    first.setAccounts([first.account, second.account]);
    first.connect.mockResolvedValueOnce({
      accounts: [first.account, second.account],
    });
    await expect(connectWallet(first.wallet)).rejects.toThrow(
      /multiple devnet accounts/,
    );
    expect(first.signMessage).not.toHaveBeenCalled();
    expect(first.signTransaction).not.toHaveBeenCalled();
  });
  it("invalidates reordered accounts even when the original account remains authorized", async () => {
    const first = fakeWallet(Keypair.generate()),
      second = fakeWallet(Keypair.generate());
    first.setAccounts([first.account, second.account]);
    const connection = await connectWallet(first.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    first.setAccounts([second.account, first.account]);
    first.setAccounts([first.account, second.account]);
    expect(invalidated).toHaveBeenCalledOnce();
    expect(connectionIsCurrent(connection)).toBe(false);
    await expect(
      signWalletMessage(connection, "Do not retry old consent"),
    ).rejects.toThrow(/account changed/);
    expect(first.signMessage).not.toHaveBeenCalled();
    unwatch();
  });
  it("invalidates added authorization and only reconnects to the uniquely returned account", async () => {
    const first = fakeWallet(Keypair.generate()),
      second = fakeWallet(Keypair.generate());
    const previous = await connectWallet(first.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(previous, invalidated);
    first.setAccounts([first.account, second.account]);
    expect(connectionIsCurrent(previous)).toBe(false);
    first.connect.mockResolvedValueOnce({ accounts: [second.account] });
    const reconnected = await connectWallet(first.wallet);
    expect(reconnected.account.address).toBe(second.account.address);
    expect(previous.account.address).toBe(first.account.address);
    expect(connectionIsCurrent(reconnected)).toBe(true);
    expect(connectionIsCurrent(previous)).toBe(false);
    expect(first.signMessage).not.toHaveBeenCalled();
    unwatch();
  });
  it("detects an in-place identity change rather than trusting wallet-owned references", async () => {
    const first = fakeWallet(Keypair.generate()),
      second = fakeWallet(Keypair.generate());
    const connection = await connectWallet(first.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    Object.assign(first.account, second.account);
    first.setAccounts([first.account]);
    expect(invalidated).toHaveBeenCalledOnce();
    expect(connectionIsCurrent(connection)).toBe(false);
    await expect(
      signWalletMessage(connection, "Old challenge"),
    ).rejects.toThrow(/account changed/);
    expect(first.signMessage).not.toHaveBeenCalled();
    unwatch();
  });
  it("discards a transaction signed across an account-order change even if the order is restored", async () => {
    const f = fixture();
    const first = fakeWallet(f.owners[0]),
      second = fakeWallet(f.owners[1]);
    first.setAccounts([first.account, second.account]);
    const connection = await connectWallet(first.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    const original = first.signTransaction.getMockImplementation()!;
    first.signTransaction.mockImplementationOnce(async (input) => {
      first.setAccounts([second.account, first.account]);
      const output = await original(input);
      first.setAccounts([first.account, second.account]);
      return output;
    });
    await expect(
      signFrozenTransaction(connection, unsignedWire(f.plan), f.plan, f.terms),
    ).rejects.toThrow(/account changed/);
    expect(first.signTransaction).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    unwatch();
  });
  it("surfaces a declined transaction once and does not retry it after an account event", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[0]);
    const connection = await connectWallet(adapter.wallet);
    const declined = new Error("User declined transaction approval");
    adapter.signTransaction.mockRejectedValueOnce(declined);
    const originalWire = unsignedWire(f.plan);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    await expect(
      signFrozenTransaction(connection, originalWire, f.plan, f.terms),
    ).rejects.toBe(declined);
    adapter.setAccounts([]);
    adapter.setAccounts([adapter.account]);
    expect(invalidated).toHaveBeenCalledOnce();
    expect(adapter.signTransaction).toHaveBeenCalledOnce();
    expect(
      wireParts(unb64(originalWire)).signatures.every(
        (signature) => !signature.some(Boolean),
      ),
    ).toBe(true);
    unwatch();
  });
  it("invalidates a removed account once and never prompts it again", async () => {
    const adapter = fakeWallet(Keypair.generate());
    const connection = await connectWallet(adapter.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    adapter.setAccounts([]);
    adapter.setAccounts([]);
    expect(connectionIsCurrent(connection)).toBe(false);
    expect(invalidated).toHaveBeenCalledOnce();
    await expect(
      signWalletMessage(connection, "New challenge"),
    ).rejects.toThrow(/account changed/);
    expect(adapter.signMessage).not.toHaveBeenCalled();
    unwatch();
  });
  it("invalidates loss of devnet permissions even when the address remains", async () => {
    const adapter = fakeWallet(Keypair.generate());
    const connection = await connectWallet(adapter.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    adapter.setAccounts([{ ...adapter.account, chains: ["solana:mainnet"] }]);
    expect(connectionIsCurrent(connection)).toBe(false);
    expect(invalidated).toHaveBeenCalledOnce();
    unwatch();
  });
  it("ignores ordinary wallet events and unsubscribes cleanly", async () => {
    const adapter = fakeWallet(Keypair.generate());
    const connection = await connectWallet(adapter.wallet);
    const invalidated = vi.fn();
    const unwatch = watchWalletConnection(connection, invalidated);
    adapter.setAccounts([adapter.account]);
    expect(connectionIsCurrent(connection)).toBe(true);
    expect(invalidated).not.toHaveBeenCalled();
    unwatch();
    adapter.setAccounts([]);
    expect(invalidated).not.toHaveBeenCalled();
  });
  it("discards an authentication signature if the account changes during the prompt", async () => {
    const adapter = fakeWallet(Keypair.generate());
    const connection = await connectWallet(adapter.wallet);
    const original = adapter.signMessage.getMockImplementation()!;
    adapter.signMessage.mockImplementationOnce(async (input) => {
      const output = await original(input);
      adapter.setAccounts([]);
      return output;
    });
    await expect(
      signWalletMessage(connection, "Bound challenge"),
    ).rejects.toThrow(/account changed/);
  });
  it("discards transaction output when the signing wallet disconnects during its prompt", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[0]);
    const connection = await connectWallet(adapter.wallet);
    const original = adapter.signTransaction.getMockImplementation()!;
    adapter.signTransaction.mockImplementationOnce(async (input) => {
      const output = await original(input);
      adapter.setAccounts([]);
      return output;
    });
    await expect(
      signFrozenTransaction(connection, unsignedWire(f.plan), f.plan, f.terms),
    ).rejects.toThrow(/account changed/);
  });
});

describe("browser signing boundary (fake Wallet Standard adapters only)", () => {
  for (const count of [2, 3])
    it(`preserves all ${count} owners' signatures and immutable message`, async () => {
      const f = fixture(count);
      let wire = unsignedWire(f.plan);
      const original = wireParts(unb64(wire)).message;
      for (const owner of f.owners) {
        const adapter = fakeWallet(owner);
        wire = await signFrozenTransaction(
          await connectWallet(adapter.wallet),
          wire,
          f.plan,
          f.terms,
        );
        expect(adapter.signTransaction).toHaveBeenCalledOnce();
        expect(equalBytes(wireParts(unb64(wire)).message, original)).toBe(true);
      }
      await verifyWireSignatures(unb64(wire), f.plan, true);
    });

  it("rejects extra transfer instructions before opening a wallet prompt", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[0]);
    const tx = buildTransaction(f.plan);
    tx.add(
      SystemProgram.transfer({
        fromPubkey: f.owners[0].publicKey,
        toPubkey: f.owners[1].publicKey,
        lamports: 1,
      }),
    );
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        b64(
          tx.serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          }),
        ),
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/altered|unapproved/);
    expect(adapter.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects a terms revision and mainnet before opening a wallet prompt", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[0]);
    const connected = await connectWallet(adapter.wallet);
    await expect(
      signFrozenTransaction(connected, unsignedWire(f.plan), f.plan, {
        ...f.terms,
        version: 2,
      }),
    ).rejects.toThrow(/accepted terms/);
    await expect(
      signFrozenTransaction(connected, unsignedWire(f.plan), f.plan, {
        ...f.terms,
        cluster: "mainnet-beta",
      }),
    ).rejects.toThrow(/devnet/);
    expect(adapter.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects corrupt earlier signatures before opening a wallet prompt", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[1]);
    const bytes = unb64(unsignedWire(f.plan));
    bytes[1] = 1;
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        b64(bytes),
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/Invalid transaction signature/);
    expect(adapter.signTransaction).not.toHaveBeenCalled();
  });

  it("rejects a wallet that drops a prior signature", async () => {
    const f = fixture();
    const first = fakeWallet(f.owners[0]);
    const partial = await signFrozenTransaction(
      await connectWallet(first.wallet),
      unsignedWire(f.plan),
      f.plan,
      f.terms,
    );
    const next = fakeWallet(f.owners[1], (bytes) => {
      bytes.fill(0, 1, 65);
      return bytes;
    });
    await expect(
      signFrozenTransaction(
        await connectWallet(next.wallet),
        partial,
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/earlier signature/);
  });

  it("rejects a wallet that changes the blockhash", async () => {
    const f = fixture();
    const adapter = fakeWallet(f.owners[0], (bytes) => {
      const tx = Transaction.from(bytes);
      tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
      tx.partialSign(f.owners[0]);
      return new Uint8Array(
        tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      );
    });
    await expect(
      signFrozenTransaction(
        await connectWallet(adapter.wallet),
        unsignedWire(f.plan),
        f.plan,
        f.terms,
      ),
    ).rejects.toThrow(/altered|unapproved/);
  });

  it("verifies exact message signatures and rejects altered signed text", async () => {
    const adapter = fakeWallet(Keypair.generate());
    const connected = await connectWallet(adapter.wallet);
    expect(
      unb64(
        await signWalletMessage(
          connected,
          "Origin: https://barterbook.example\nCluster: devnet",
        ),
      ).length,
    ).toBe(64);
    adapter.signMessage.mockImplementationOnce(async () => ({}) as never);
    await expect(
      signWalletMessage(connected, "A new challenge"),
    ).rejects.toThrow(/invalid|altered/);
  });
});
