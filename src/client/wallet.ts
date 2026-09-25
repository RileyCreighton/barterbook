import { getWallets } from "@wallet-standard/app";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { b64, equalBytes, unb64, verifyEd25519 } from "../shared/crypto";
import { verifyWireSignatures } from "../shared/transactions";
import type { FrozenPlan, Terms } from "../shared/types";

export type BrowserWallet = ReturnType<
  ReturnType<typeof getWallets>["get"]
>[number];
export type BrowserAccount = BrowserWallet["accounts"][number];
export interface WalletConnection {
  readonly wallet: BrowserWallet;
  readonly account: BrowserAccount;
}
interface AccountSnapshot {
  selected: string;
  authorized: string;
  invalidated: boolean;
}
// Keep consent identity separate from wallet-owned account objects, which an
// adapter can replace or mutate while a prompt is open.
const accountSnapshots = new WeakMap<WalletConnection, AccountSnapshot>();
function accountIdentity(account: BrowserAccount): string {
  return JSON.stringify({
    address: account.address,
    publicKey: b64(new Uint8Array(account.publicKey)),
    chains: [...account.chains],
    features: [...account.features],
  });
}
function authorizedAccounts(wallet: BrowserWallet): string {
  return JSON.stringify(wallet.accounts.map(accountIdentity));
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

interface SolflareTransactionProvider {
  readonly isSolflare: boolean;
  readonly isConnected: boolean;
  readonly publicKey: { toBase58(): string } | null;
  request(input: {
    method: "signTransaction";
    params: { message: string };
  }): Promise<{ signature: string; publicKey: string }>;
}

function injectedSolflare(): SolflareTransactionProvider | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as Window & { solflare?: SolflareTransactionProvider }).solflare;
}

export function walletSigningDiagnostics(connection: WalletConnection | null) {
  const provider = injectedSolflare();
  return {
    walletName: connection?.wallet.name ?? null,
    signingPath: connection
      ? connection.wallet.name === "Solflare"
        ? "solflare-transaction-message"
        : "wallet-standard-transaction"
      : "not-connected",
    connectionCurrent: connection ? connectionIsCurrent(connection) : false,
    solflareAvailable: !!provider && provider.isSolflare === true,
    solflareConnected: provider?.isConnected === true,
    solflareAccountMatches:
      !!connection &&
      provider?.publicKey?.toBase58() === connection.account.address,
    registeredWalletNames: availableWallets().map((wallet) => wallet.name),
  };
}

function assertSolflareAccount(
  provider: SolflareTransactionProvider,
  connection: WalletConnection,
): void {
  assertConnected(connection);
  if (
    injectedSolflare() !== provider ||
    provider.isSolflare !== true ||
    provider.isConnected !== true ||
    provider.publicKey?.toBase58() !== connection.account.address ||
    typeof provider.request !== "function"
  )
    throw new Error(
      "Solflare account changed or is unavailable. Reconnect the intended wallet and review the terms again.",
    );
}

/** Solflare's exposed transaction-message RPC retains transaction simulation
 * and approval, but signs the original compiled message. Its Wallet Standard
 * wire-transaction path can instead sign the simulation service's enrichedTx.
 * This is transaction signing, never solana:signMessage. See the public-package
 * analysis in docs/solflare-transaction-signing.md.
 */
async function signSolflareTransaction(
  connection: WalletConnection,
  originalWire: Uint8Array,
  message: Uint8Array,
  ownSlot: number,
): Promise<Uint8Array> {
  const provider = injectedSolflare();
  if (!provider)
    throw new Error(
      "Solflare's transaction signing connection is unavailable. Reconnect the Solflare extension and review the terms again.",
    );
  assertSolflareAccount(provider, connection);
  const output = await provider.request({
    method: "signTransaction",
    params: { message: bs58.encode(message) },
  });
  assertSolflareAccount(provider, connection);
  if (
    !output ||
    output.publicKey !== connection.account.address ||
    typeof output.signature !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(output.signature)
  )
    throw new Error("Solflare returned an invalid transaction signature.");
  const signature = bs58.decode(output.signature);
  if (!(await verifyEd25519(connection.account.address, signature, message)))
    throw new Error(
      "Solflare signed a different transaction or returned an invalid signature. This signature was not saved.",
    );
  assertSolflareAccount(provider, connection);
  // Only the selected owner's slot is filled. Earlier signatures and all
  // message bytes stay local and unchanged; never give the wallet a full wire.
  const signedWire = new Uint8Array(originalWire);
  signedWire.set(signature, 1 + ownSlot * 64);
  return signedWire;
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
  const compatible = result.accounts.filter(validAccount);
  if (compatible.length > 1)
    throw new Error(
      "The wallet returned multiple devnet accounts. Choose one account in your wallet and reconnect; BarterBook will not choose an account for you.",
    );
  const account = compatible[0];
  if (!account)
    throw new Error("The wallet did not provide a compatible devnet account.");
  const connection = Object.freeze({ wallet, account });
  accountSnapshots.set(connection, {
    selected: accountIdentity(account),
    authorized: authorizedAccounts(wallet),
    invalidated: false,
  });
  assertConnected(connection);
  return connection;
}

export async function disconnectWallet(
  connection: WalletConnection,
): Promise<void> {
  const snapshot = accountSnapshots.get(connection);
  if (snapshot) snapshot.invalidated = true;
  const feature = connection.wallet.features["standard:disconnect"] as
    { disconnect(): Promise<void> } | undefined;
  if (feature) await feature.disconnect();
}

export function connectionIsCurrent(connection: WalletConnection): boolean {
  const snapshot = accountSnapshots.get(connection);
  if (!snapshot || snapshot.invalidated) return false;
  try {
    const current =
      isCompatible(connection.wallet) &&
      validAccount(connection.account) &&
      accountIdentity(connection.account) === snapshot.selected &&
      authorizedAccounts(connection.wallet) === snapshot.authorized &&
      connection.wallet.accounts.some(
        (account) =>
          validAccount(account) &&
          accountIdentity(account) === snapshot.selected,
      );
    if (!current) snapshot.invalidated = true;
    return current;
  } catch {
    snapshot.invalidated = true;
    return false;
  }
}

/** Any observed account-list, order, identity or permission change ends consent. */
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
  let before: Awaited<ReturnType<typeof verifyWireSignatures>>;
  try {
    before = await verifyWireSignatures(originalWire, plan, false, terms);
  } catch (cause) {
    throw new Error(
      `Before opening the wallet: ${cause instanceof Error ? cause.message : "Transaction verification failed"}. Use “Check transaction without signing” in this room.`,
    );
  }
  const ownSlot = before.signers.indexOf(connection.account.address);
  if (ownSlot < 0)
    throw new Error("Connected wallet is not a participant in these terms.");
  const feature = capability<SignTransactionFeature>(
    connection.wallet,
    "solana:signTransaction",
  );
  if (!feature.supportedTransactionVersions.includes("legacy"))
    throw new Error("Wallet does not support the required legacy transaction.");
  // Signature verification above is asynchronous: check the same authorized
  // account snapshot again immediately before opening the wallet prompt.
  assertConnected(connection);
  let signedWire: Uint8Array;
  if (connection.wallet.name === "Solflare") {
    signedWire = await signSolflareTransaction(
      connection,
      originalWire,
      before.message,
      ownSlot,
    );
  } else {
    const outputs = await feature.signTransaction({
      account: connection.account,
      chain: "solana:devnet",
      transaction: new Uint8Array(originalWire),
    });
    const result = outputs[0]?.signedTransaction;
    if (outputs.length !== 1 || !result)
      throw new Error("Wallet returned no unique signed transaction.");
    signedWire = new Uint8Array(result);
  }
  let after: Awaited<ReturnType<typeof verifyWireSignatures>>;
  try {
    after = await verifyWireSignatures(signedWire, plan, false, terms);
  } catch (cause) {
    throw new Error(
      `After wallet approval: ${cause instanceof Error ? cause.message : "Transaction verification failed"}. This signature was not uploaded.`,
    );
  }
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
  assertConnected(connection);
  return b64(signedWire);
}
