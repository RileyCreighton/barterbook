import { getWallets } from "@wallet-standard/app";
import { PublicKey } from "@solana/web3.js";
import { b64, equalBytes, unb64, verifyEd25519 } from "../shared/crypto";
import {
  verifyTransaction,
  verifyWireSignatures,
} from "../shared/transactions";
import type { FrozenPlan, Terms } from "../shared/types";

export type BrowserWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];
export type BrowserAccount = BrowserWallet["accounts"][number];
export interface WalletConnection {
  wallet: BrowserWallet;
  account: BrowserAccount;
}

// These are the narrow Wallet Standard capabilities this application uses. In
// particular, signAndSendTransaction is deliberately not an available pathway.
interface ConnectFeature {
  connect(): Promise<{ accounts: readonly BrowserAccount[] }>;
}
interface SignMessageFeature {
  signMessage(input: { account: BrowserAccount; message: Uint8Array }): Promise<
    readonly {
      signedMessage: Uint8Array;
      signature: Uint8Array;
      signatureType?: string;
    }[]
  >;
}
interface SignTransactionFeature {
  supportedTransactionVersions: readonly (number | "legacy")[];
  signTransaction(input: {
    account: BrowserAccount;
    chain: "solana:devnet";
    transaction: Uint8Array;
  }): Promise<readonly { signedTransaction: Uint8Array }[]>;
}

function capability<T>(wallet: BrowserWallet, name: `${string}:${string}`): T {
  const feature = wallet.features[name];
  if (!feature) throw new Error(`${wallet.name} does not support ${name}`);
  return feature as T;
}

function isCompatible(wallet: BrowserWallet): boolean {
  const signing = wallet.features["solana:signTransaction"] as
    SignTransactionFeature | undefined;
  return (
    wallet.chains.includes("solana:devnet") &&
    Boolean(
      wallet.features["standard:connect"] &&
      wallet.features["solana:signMessage"],
    ) &&
    Boolean(signing?.supportedTransactionVersions?.includes("legacy"))
  );
}

export function availableWallets(): readonly BrowserWallet[] {
  return getWallets().get().filter(isCompatible);
}

export function watchWallets(changed: () => void): () => void {
  const registry = getWallets();
  const registered = registry.on("register", changed);
  const unregistered = registry.on("unregister", changed);
  return () => {
    registered();
    unregistered();
  };
}

function validAccount(account: BrowserAccount): boolean {
  try {
    return (
      account.chains.includes("solana:devnet") &&
      account.features.includes("solana:signMessage") &&
      account.features.includes("solana:signTransaction") &&
      equalBytes(
        new PublicKey(account.address).toBytes(),
        new Uint8Array(account.publicKey),
      )
    );
  } catch {
    return false;
  }
}

export async function connectWallet(
  wallet: BrowserWallet,
): Promise<WalletConnection> {
  if (!isCompatible(wallet))
    throw new Error(
      "Choose a devnet wallet supporting message and legacy transaction signing without broadcast.",
    );
  const result = await capability<ConnectFeature>(
    wallet,
    "standard:connect",
  ).connect();
  const account = result.accounts.find(validAccount);
  if (!account)
    throw new Error("The wallet did not provide a compatible devnet account.");
  const connection = { wallet, account };
  assertConnected(connection);
  return connection;
}

export async function disconnectWallet(
  connection: WalletConnection,
): Promise<void> {
  const feature = connection.wallet.features["standard:disconnect"] as
    { disconnect(): Promise<void> } | undefined;
  if (feature) await feature.disconnect();
}

export function connectionIsCurrent(connection: WalletConnection): boolean {
  return (
    isCompatible(connection.wallet) &&
    validAccount(connection.account) &&
    connection.wallet.accounts.some(
      (account) =>
        validAccount(account) &&
        account.address === connection.account.address &&
        equalBytes(
          new Uint8Array(account.publicKey),
          new Uint8Array(connection.account.publicKey),
        ),
    )
  );
}

/** Account removal, disconnection or loss of devnet signing invalidates consent. */
export function watchWalletConnection(
  connection: WalletConnection,
  invalidated: () => void,
): () => void {
  const events = connection.wallet.features["standard:events"] as
    { on: (event: "change", changed: () => void) => () => void } | undefined;
  let ended = false;
  const changed = () => {
    if (!ended && !connectionIsCurrent(connection)) {
      ended = true;
      invalidated();
    }
  };
  const unwatch = events?.on("change", changed);
  changed();
  return () => {
    ended = true;
    unwatch?.();
  };
}

function assertConnected(connection: WalletConnection): void {
  if (!connectionIsCurrent(connection)) {
    throw new Error(
      "Wallet account changed. Reconnect and review the terms again.",
    );
  }
}

export async function signWalletMessage(
  connection: WalletConnection,
  message: string,
): Promise<string> {
  assertConnected(connection);
  const bytes = new TextEncoder().encode(message);
  const outputs = await capability<SignMessageFeature>(
    connection.wallet,
    "solana:signMessage",
  ).signMessage({
    account: connection.account,
    message: new Uint8Array(bytes),
  });
  const output = outputs[0];
  if (
    outputs.length !== 1 ||
    !output ||
    !equalBytes(output.signedMessage, bytes) ||
    (output.signatureType && output.signatureType !== "ed25519") ||
    !(await verifyEd25519(connection.account.address, output.signature, bytes))
  ) {
    throw new Error("Wallet returned an invalid or altered message signature.");
  }
  assertConnected(connection);
  return b64(output.signature);
}

/** Independently validate accepted terms before opening the wallet prompt. */
export async function signFrozenTransaction(
  connection: WalletConnection,
  wireBase64: string,
  proposedPlan: FrozenPlan,
  locallyAcceptedTerms: Terms,
): Promise<string> {
  assertConnected(connection);
  // An async wallet prompt must not let a room poll, caller, or adapter mutate
  // the reference against which the eventual signed message is checked.
  const plan: FrozenPlan = structuredClone(proposedPlan);
  const terms: Terms = structuredClone(locallyAcceptedTerms);
  if (plan.terms.cluster !== "devnet" || terms.cluster !== "devnet")
    throw new Error("This release signs devnet transactions only.");
  if (terms.expiresAt <= Date.now())
    throw new Error("Accepted terms expired. Review new terms before signing.");
  const originalWire = unb64(wireBase64);
  const before = verifyTransaction(originalWire, plan, terms);
  const ownSlot = before.signers.indexOf(connection.account.address);
  if (ownSlot < 0)
    throw new Error("Connected wallet is not a participant in these terms.");
  await verifyWireSignatures(originalWire, plan);
  const feature = capability<SignTransactionFeature>(
    connection.wallet,
    "solana:signTransaction",
  );
  if (!feature.supportedTransactionVersions.includes("legacy"))
    throw new Error("Wallet does not support the required legacy transaction.");
  const outputs = await feature.signTransaction({
    account: connection.account,
    chain: "solana:devnet",
    transaction: new Uint8Array(originalWire),
  });
  const result = outputs[0]?.signedTransaction;
  if (outputs.length !== 1 || !result)
    throw new Error("Wallet returned no unique signed transaction.");
  const signedWire = new Uint8Array(result);
  const after = verifyTransaction(signedWire, plan, terms);
  if (!equalBytes(before.message, after.message))
    throw new Error(
      "Wallet changed the frozen transaction message. All participants must approve a new attempt.",
    );
  for (let i = 0; i < before.signatures.length; i++) {
    if (
      before.signatures[i].some(Boolean) &&
      !equalBytes(before.signatures[i], after.signatures[i])
    ) {
      throw new Error("Wallet removed or altered an earlier signature.");
    }
    if (
      i !== ownSlot &&
      !equalBytes(before.signatures[i], after.signatures[i])
    ) {
      throw new Error("Wallet changed another participant signature slot.");
    }
  }
  if (!after.signatures[ownSlot].some(Boolean))
    throw new Error("Wallet did not sign its required slot.");
  await verifyWireSignatures(signedWire, plan);
  assertConnected(connection);
  return b64(signedWire);
}
