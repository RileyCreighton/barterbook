import { createPrivateKey, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
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
  signWalletMessage,
  watchWalletConnection,
} from "../src/client/wallet";
import type { BrowserAccount, BrowserWallet } from "../src/client/wallet";
import { fixture } from "./fixtures";

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
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(key.secretKey.slice(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    return [
      {
        signedMessage: input.message,
        signature: new Uint8Array(sign(null, input.message, privateKey)),
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
