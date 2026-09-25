/** Disposable devnet SDK fixtures only; never load a user's wallet. */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  type TransactionResponse,
} from "@solana/web3.js";
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import bs58 from "bs58";
import { raw } from "../src/shared/amounts";
import { canonical, sha256 } from "../src/shared/crypto";
import { verifyTransaction, wireParts } from "../src/shared/transactions";
import type { FrozenPlan } from "../src/shared/types";

export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PURPOSE = "barterbook-disposable-devnet-only";
const RPC_URL = process.env.DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
export const connection = new Connection(RPC_URL, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
});
export const pause = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));
export const json = (value: unknown) =>
  JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n";
export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
export function safeName(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value))
    throw new Error(
      "Use a run/operation name with 1–80 letters, numbers, underscores or hyphens",
    );
  return value;
}
/** Atomic create-if-absent, with fsync. Existing data is never replaced. */
export function immutableJson(
  path: string,
  value: unknown,
  secret = false,
): void {
  mkdirSync(dirname(path), { recursive: true, mode: secret ? 0o700 : 0o755 });
  const content = json(value);
  if (existsSync(path)) {
    if (readFileSync(path, "utf8") !== content)
      throw new Error(`Immutable record already exists: ${path}`);
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", secret ? 0o600 : 0o644);
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temporary, path);
  } catch (error) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== content)
      throw error;
  } finally {
    unlinkSync(temporary);
  }
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function recordEvent(
  directory: string,
  value: unknown,
  secret = false,
): string {
  const name = `${Date.now()}-${randomUUID()}.json`;
  immutableJson(join(directory, name), value, secret);
  return name;
}
export type Participant = {
  id: string;
  label: string;
  publicKey: string;
  kind: "sdk-disposable" | "browser";
  signingEvidence: "SDK-only" | "not-yet-proven";
};
export type Run = {
  runId: string;
  privateRoot: string;
  evidenceRoot: string;
  walletRoot: string;
  buildId: string;
  execute: boolean;
  resume: boolean;
  beforeBroadcast?: () => Promise<void>;
};
export function buildId(): string {
  const hash = createHash("sha256");
  for (const directory of ["scripts", "src/shared"])
    for (const name of readdirSync(directory)
      .filter((n) => n.endsWith(".ts"))
      .sort()) {
      hash.update(`${directory}/${name}\n`);
      hash.update(readFileSync(join(directory, name)));
    }
  hash.update(readFileSync("package-lock.json"));
  return `sha256:${hash.digest("hex")}`;
}
export function args(argv = process.argv.slice(2)): Map<string, string> {
  const result = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || result.has(arg))
      throw new Error("Use each named --option once");
    result.set(
      arg,
      argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true",
    );
  }
  return result;
}
export function openRun(options = args(), base = process.cwd()): Run {
  const runId = safeName(options.get("--run") ?? "");
  const privateRoot = join(base, ".test-wallets", "runs", runId);
  const evidenceRoot = join(base, "evidence", "devnet", runId);
  const path = join(privateRoot, "run.json");
  const previous = existsSync(path)
    ? readJson<{ runId: string; purpose: string; legacyWallets: boolean }>(path)
    : null;
  const legacyWallets =
    previous?.legacyWallets ?? options.has("--reuse-original-wallets");
  if (previous && (previous.runId !== runId || previous.purpose !== PURPOSE))
    throw new Error("Invalid existing run manifest");
  if (legacyWallets && !previous) {
    const oldRoot = join(base, ".test-wallets");
    if (readdirSync(oldRoot).some((name) => name.endsWith("-attempt.json")))
      throw new Error(
        "Original executable journals exist; reconcile those before migrating wallets",
      );
  }
  const fingerprint = buildId();
  if (!previous)
    immutableJson(
      path,
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        cluster: "devnet",
        runId,
        legacyWallets,
        createdAt: new Date().toISOString(),
        buildId: fingerprint,
      },
      true,
    );
  mkdirSync(evidenceRoot, { recursive: true });
  return {
    runId,
    privateRoot,
    evidenceRoot,
    walletRoot: legacyWallets ? join(base, ".test-wallets") : privateRoot,
    buildId: fingerprint,
    execute: options.has("--execute"),
    resume: options.has("--resume"),
  };
}
export async function readRpc<T>(
  operation: () => Promise<T>,
  sleep = pause,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= 3 || !/429|too many requests|rate.?limit/i.test(message))
        throw error;
      await sleep(1000 * 2 ** attempt);
    }
  }
}
export async function assertDevnet(): Promise<void> {
  if ((await readRpc(() => connection.getGenesisHash())) !== DEVNET_GENESIS)
    throw new Error("REFUSED: RPC is not Solana devnet");
}
export function fixtureKey(run: Run, name: string): Keypair {
  if (!/^(wallet|mint)-[0-2]$/.test(name))
    throw new Error("Unexpected disposable fixture key name");
  const path = join(
    name.startsWith("wallet") ? run.walletRoot : run.privateRoot,
    `${name}.json`,
  );
  if (existsSync(path)) {
    const saved = readJson<{ purpose: string; secretKey: number[] }>(path);
    if (saved.purpose !== PURPOSE)
      throw new Error("Refusing an unrecognized key file");
    return Keypair.fromSecretKey(Uint8Array.from(saved.secretKey));
  }
  if (run.walletRoot !== run.privateRoot && name.startsWith("wallet"))
    throw new Error(
      "Original disposable key is missing; it will not be replaced",
    );
  const key = Keypair.generate();
  immutableJson(
    path,
    {
      purpose: PURPOSE,
      createdAt: new Date().toISOString(),
      publicKey: key.publicKey.toBase58(),
      secretKey: [...key.secretKey],
    },
    true,
  );
  return key;
}
export function participants(run: Run, browserFile?: string): Participant[] {
  const path = join(run.evidenceRoot, "participants.json");
  const sdk: Participant[] = [0, 1, 2].map((i) => ({
    id: `sdk-${i}`,
    label: `Disposable SDK participant ${i + 1}`,
    publicKey: fixtureKey(run, `wallet-${i}`).publicKey.toBase58(),
    kind: "sdk-disposable",
    signingEvidence: "SDK-only",
  }));
  if (!existsSync(path))
    immutableJson(path, {
      schemaVersion: 1,
      runId: run.runId,
      cluster: "devnet",
      assetKind: "mock tokens, not PRE",
      participants: sdk,
    });
  const all = readJson<{ participants: Participant[] }>(path).participants;
  if (json(all) !== json(sdk))
    throw new Error(
      "SDK participant manifest differs from the disposable keys",
    );
  for (const name of readdirSync(run.evidenceRoot)
    .filter((n) => /^participants-browser-[a-f0-9]+\.json$/.test(n))
    .sort())
    all.push(
      ...readJson<{ participants: Participant[] }>(join(run.evidenceRoot, name))
        .participants,
    );
  if (browserFile) {
    const browser = readJson<Array<{ address: string; label: string }>>(
      resolve(browserFile),
    ).map((entry) => {
      const key = new PublicKey(entry.address);
      if (
        !PublicKey.isOnCurve(key.toBytes()) ||
        key.toBase58() !== entry.address ||
        typeof entry.label !== "string" ||
        entry.label.length > 60
      )
        throw new Error("Invalid browser participant public address or label");
      const id = `browser-${createHash("sha256").update(entry.address).digest("hex").slice(0, 12)}`;
      return {
        id,
        label: entry.label,
        publicKey: entry.address,
        kind: "browser",
        signingEvidence: "not-yet-proven",
      } as Participant;
    });
    if (
      !browser.length ||
      browser.length > 3 ||
      new Set(browser.map((p) => p.publicKey)).size !== browser.length
    )
      throw new Error("Use one to three distinct browser public addresses");
    const additions = browser.filter(
      (p) => !all.some((old) => old.publicKey === p.publicKey),
    );
    if (
      browser.some((p) =>
        all.some(
          (old) => old.publicKey === p.publicKey && json(old) !== json(p),
        ),
      )
    )
      throw new Error("A participant's existing kind/label is immutable");
    if (all.length + additions.length > 6)
      throw new Error("Use at most three browser participants per run");
    if (additions.length) {
      const key = createHash("sha256")
        .update(json(additions))
        .digest("hex")
        .slice(0, 16);
      immutableJson(
        join(run.evidenceRoot, `participants-browser-${key}.json`),
        {
          schemaVersion: 1,
          runId: run.runId,
          cluster: "devnet",
          assetKind: "mock tokens, not PRE",
          participants: additions,
        },
      );
      all.push(...additions);
    }
  }
  return all;
}
export function publicEvidence<T>(run: Run, name: string, value: T): T {
  if (!/^[a-zA-Z0-9_-]+\.json$/.test(name))
    throw new Error("Invalid evidence filename");
  immutableJson(join(run.evidenceRoot, name), value);
  return value;
}
export type Journal = {
  schemaVersion: 1;
  name: string;
  runId: string;
  buildId: string;
  cluster: "devnet";
  txid: string;
  wireBase64: string;
  messageBase64: string;
  blockhash: string;
  lastValidBlockHeight: number;
  createdAt: string;
  expectedFailure: boolean;
  sdkSigning?: { plan: FrozenPlan; messageHashesAfterEachSignature: string[] };
};
export const journalPath = (run: Run, name: string) =>
  join(run.privateRoot, "transactions", safeName(name), "attempt.json");
function journalEvent(
  run: Run,
  journal: Journal,
  state: string,
  extra: object = {},
) {
  recordEvent(
    join(run.privateRoot, "transactions", journal.name, "events"),
    { state, txid: journal.txid, at: new Date().toISOString(), ...extra },
    true,
  );
}
export function validateJournal(journal: Journal): Uint8Array {
  const bytes = Buffer.from(journal.wireBase64, "base64");
  const tx = Transaction.from(bytes);
  if (
    !tx.verifySignatures() ||
    !tx.signature ||
    bs58.encode(tx.signature) !== journal.txid ||
    Buffer.from(tx.serializeMessage()).toString("base64") !==
      journal.messageBase64 ||
    tx.recentBlockhash !== journal.blockhash ||
    !Number.isSafeInteger(journal.lastValidBlockHeight)
  )
    throw new Error(
      "Invalid durable transaction bytes, signatures or identity",
    );
  return bytes;
}
async function rawTransaction(txid: string): Promise<unknown> {
  return readRpc(async () => {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: txid,
        method: "getTransaction",
        params: [
          txid,
          {
            commitment: "finalized",
            encoding: "base64",
            maxSupportedTransactionVersion: 0,
          },
        ],
      }),
    });
    if (!response.ok) throw new Error(`RPC archive HTTP ${response.status}`);
    const payload = (await response.json()) as {
      error?: { code: number };
      result?: { transaction: [string, string] };
    };
    if (payload.error || !payload.result)
      throw new Error(
        `Finalized raw archive unavailable (${payload.error?.code ?? "missing"})`,
      );
    return payload;
  });
}
type RawFinalizedTransaction = {
  slot: number;
  blockTime?: number | null;
  meta: TransactionResponse["meta"];
  transaction: [string, string];
};
function responseFromRaw(
  journal: Journal,
  data: RawFinalizedTransaction,
): TransactionResponse {
  if (
    !data?.meta ||
    data.transaction?.[1] !== "base64" ||
    data.transaction[0] !== journal.wireBase64 ||
    !Number.isSafeInteger(data.slot) ||
    data.slot < 0 ||
    !Number.isSafeInteger(data.meta.fee) ||
    data.meta.fee < 0
  )
    throw new Error("Raw finalized metadata/wire differs from durable bytes");
  const tx = Transaction.from(validateJournal(journal));
  return {
    slot: data.slot,
    blockTime: data.blockTime ?? null,
    meta: data.meta,
    transaction: {
      signatures: tx.signatures.map((s) => bs58.encode(s.signature!)),
      message: tx.compileMessage(),
    },
  };
}
function expectedOutcome(
  journal: Journal,
  receipt: TransactionResponse,
): TransactionResponse {
  if (Boolean(receipt.meta!.err) !== journal.expectedFailure)
    throw new Error(
      `Unexpected finalized outcome for ${journal.name}; inspect immutable receipt`,
    );
  return receipt;
}
async function finalizedReceipt(
  run: Run,
  journal: Journal,
): Promise<TransactionResponse | null> {
  const archivePath = join(
    run.evidenceRoot,
    `${journal.name}-transaction.json`,
  );
  if (existsSync(archivePath)) {
    const archive = readJson<{
      txid: string;
      cluster: string;
      commitment: string;
      signedWireBase64: string;
      messageBase64: string;
      rawGetTransaction: { result: RawFinalizedTransaction };
    }>(archivePath);
    if (
      archive.txid !== journal.txid ||
      archive.cluster !== "devnet" ||
      archive.commitment !== "finalized" ||
      archive.signedWireBase64 !== journal.wireBase64 ||
      archive.messageBase64 !== journal.messageBase64
    )
      throw new Error("Evidence identity conflict");
    // Prior validated finalized evidence remains usable when an RPC later prunes history.
    return expectedOutcome(
      journal,
      responseFromRaw(journal, archive.rawGetTransaction.result),
    );
  }
  // Status and metadata are independent: status-cache absence/errors do not prove absence onchain.
  const statusResult = await readRpc(() =>
    connection.getSignatureStatuses([journal.txid], {
      searchTransactionHistory: true,
    }),
  ).catch(() => null);
  const status = statusResult?.value[0];
  const receipt = await readRpc(() =>
    connection.getTransaction(journal.txid, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
  );
  if (!receipt) {
    if (status?.confirmationStatus === "finalized")
      throw new Error(
        "Finalized original status has no metadata; retain the original journal",
      );
    return null;
  }
  if (
    !receipt.meta ||
    receipt.transaction.signatures[0] !== journal.txid ||
    Buffer.from(receipt.transaction.message.serialize()).toString("base64") !==
      journal.messageBase64
  )
    throw new Error(
      "Finalized metadata does not match the persisted signed message",
    );
  if (
    status?.confirmationStatus === "finalized" &&
    canonical(status.err) !== canonical(receipt.meta.err)
  )
    throw new Error(
      "Finalized status and metadata conflict; retain original journal",
    );
  const rpcArchive = (await rawTransaction(journal.txid)) as {
    result: RawFinalizedTransaction;
  };
  const rawReceipt = responseFromRaw(journal, rpcArchive.result);
  if (
    rawReceipt.slot !== receipt.slot ||
    canonical(rawReceipt.meta) !== canonical(receipt.meta)
  )
    throw new Error("Finalized metadata responses disagree");
  publicEvidence(run, `${journal.name}-transaction.json`, {
    schemaVersion: 1,
    runId: run.runId,
    buildId: journal.buildId,
    cluster: "devnet",
    scope:
      "Actual devnet SDK test; not browser-wallet proof; mock tokens, not PRE",
    txid: journal.txid,
    explorer: `https://explorer.solana.com/tx/${journal.txid}?cluster=devnet`,
    commitment: "finalized",
    slot: String(receipt.slot),
    blockTime: receipt.blockTime ?? null,
    capturedAt: new Date().toISOString(),
    networkFeeLamports: String(receipt.meta.fee),
    messageBase64: journal.messageBase64,
    signedWireBase64: journal.wireBase64,
    rawGetTransaction: rpcArchive,
    transaction: receipt,
  });
  journalEvent(
    run,
    journal,
    receipt.meta.err ? "FAILED_ONCHAIN_FINALIZED" : "FINALIZED",
  );
  return expectedOutcome(journal, receipt as TransactionResponse);
}
export async function publishJournalSigningEvidence(
  run: Run,
  journal: Journal,
): Promise<void> {
  if (!journal.sdkSigning) return;
  const bytes = validateJournal(journal),
    proof = journal.sdkSigning;
  verifyTransaction(bytes, proof.plan, proof.plan.terms);
  const messageHash = await sha256(wireParts(bytes).message);
  if (
    proof.messageHashesAfterEachSignature.length !==
      proof.plan.terms.owners.length ||
    proof.messageHashesAfterEachSignature.some((hash) => hash !== messageHash)
  )
    throw new Error(
      "Stored SDK signing observations do not preserve the frozen message",
    );
  publicEvidence(run, `${journal.name}-sdk-signing.json`, {
    runId: run.runId,
    buildId: journal.buildId,
    txid: journal.txid,
    scope:
      "Sequential SDK signing by disposable test wallets only. Browser-wallet compatibility remains unproven.",
    owners: proof.plan.terms.owners.length,
    messageHash,
    messageHashesAfterEachSignature: proof.messageHashesAfterEachSignature,
    wireBytes: bytes.length,
    allSignaturesVerified: true,
    terms: proof.plan.terms,
  });
}
export type BuiltFixtureTransaction =
  | Transaction
  | {
      transaction: Transaction;
      sdkSigning: NonNullable<Journal["sdkSigning"]>;
    };
export async function reconcileJournal(
  run: Run,
  journal: Journal,
): Promise<TransactionResponse> {
  validateJournal(journal);
  for (let count = 0; count < 20; count++) {
    const receipt = await finalizedReceipt(run, journal);
    if (receipt) return receipt;
    if (
      (await readRpc(() => connection.getBlockHeight("finalized"))) >
      journal.lastValidBlockHeight
    ) {
      journalEvent(run, journal, "EXPIRED_NEEDS_AUTHORITATIVE_RECONCILIATION");
      throw new Error(
        "Expired original transaction is unresolved. A single endpoint's absence does not authorize a replacement; keep all journals.",
      );
    }
    await pause(2000);
  }
  journalEvent(run, journal, "STATUS_UNKNOWN");
  throw new Error(
    `Original transaction remains unresolved: ${journal.txid}. Re-run with --resume to reconcile identical bytes, never delete the journal.`,
  );
}
export async function sendFixtureTransaction(
  run: Run,
  name: string,
  build: (
    blockhash: string,
    lifetime: { blockhash: string; lastValidBlockHeight: number },
  ) => Promise<BuiltFixtureTransaction> | BuiltFixtureTransaction,
  signers: Keypair[],
  expectedFailure = false,
): Promise<TransactionResponse> {
  const path = journalPath(run, name);
  let journal: Journal;
  if (existsSync(path)) {
    journal = readJson<Journal>(path);
    if (
      journal.name !== name ||
      journal.runId !== run.runId ||
      journal.expectedFailure !== expectedFailure
    )
      throw new Error("Operation differs from its immutable journal");
    validateJournal(journal);
    await publishJournalSigningEvidence(run, journal);
    const receipt = await finalizedReceipt(run, journal);
    if (receipt) return receipt;
    if (!run.resume)
      throw new Error(
        "Existing unresolved transaction: use --resume to reconcile/rebroadcast its identical bytes; never replace its journal",
      );
    if (
      (await readRpc(() => connection.getBlockHeight("finalized"))) >
      journal.lastValidBlockHeight
    )
      return reconcileJournal(run, journal);
    await run.beforeBroadcast?.();
  } else {
    if (!run.execute)
      throw new Error(
        "No transaction sent. Explicit --execute is required after checking faucet funding",
      );
    await run.beforeBroadcast?.();
    const life = await readRpc(() =>
      connection.getLatestBlockhash("confirmed"),
    );
    const built = await build(life.blockhash, life);
    const tx = built instanceof Transaction ? built : built.transaction;
    tx.recentBlockhash = life.blockhash;
    tx.partialSign(...signers);
    const bytes = tx.serialize();
    journal = {
      schemaVersion: 1,
      name,
      runId: run.runId,
      buildId: run.buildId,
      cluster: "devnet",
      txid: bs58.encode(tx.signature!),
      wireBase64: Buffer.from(bytes).toString("base64"),
      messageBase64: Buffer.from(tx.serializeMessage()).toString("base64"),
      blockhash: life.blockhash,
      lastValidBlockHeight: life.lastValidBlockHeight,
      createdAt: new Date().toISOString(),
      expectedFailure,
      ...(built instanceof Transaction ? {} : { sdkSigning: built.sdkSigning }),
    };
    immutableJson(path, journal, true);
    journalEvent(run, journal, "FULLY_SIGNED");
    await publishJournalSigningEvidence(run, journal);
  }
  const bytes = validateJournal(journal);
  const simulation = await readRpc(() =>
    connection.simulateTransaction(VersionedTransaction.deserialize(bytes), {
      sigVerify: true,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    }),
  );
  recordEvent(join(run.evidenceRoot, `${name}-simulations`), {
    cluster: "devnet",
    runId: run.runId,
    txid: journal.txid,
    buildId: journal.buildId,
    scope: "Simulation only, not execution",
    simulation,
  });
  if (Boolean(simulation.value.err) !== expectedFailure)
    throw new Error(
      "Unexpected simulation outcome; original signed bytes retained, no replacement",
    );
  journalEvent(run, journal, "SUBMISSION_STARTED");
  try {
    const returned = await connection.sendRawTransaction(bytes, {
      skipPreflight: expectedFailure,
      preflightCommitment: "confirmed",
      maxRetries: 0,
    });
    if (returned !== journal.txid)
      throw new Error("RPC returned another identifier");
    journalEvent(run, journal, "SUBMITTED");
  } catch {
    journalEvent(run, journal, "BROADCAST_UNKNOWN");
  }
  return reconcileJournal(run, journal);
}
export function tokenDelta(
  transaction: TransactionResponse,
  account: string,
  mint: string,
  expected: { owner: string; programId: string; decimals: number },
): bigint {
  const keys = transaction.transaction.message.accountKeys.map((key) =>
    key.toBase58(),
  );
  const index = keys.indexOf(account);
  if (index < 0 || keys.lastIndexOf(account) !== index)
    throw new Error("Receipt account missing or duplicated");
  for (const balances of [
    transaction.meta?.preTokenBalances,
    transaction.meta?.postTokenBalances,
  ]) {
    if (!balances) throw new Error("Fixture token metadata is missing");
    if (new Set(balances.map((b) => b.accountIndex)).size !== balances.length)
      throw new Error("Duplicate receipt metadata account index");
    for (const balance of balances) {
      if (
        !Number.isSafeInteger(balance.accountIndex) ||
        balance.accountIndex < 0 ||
        balance.accountIndex >= keys.length ||
        !Number.isSafeInteger(balance.uiTokenAmount.decimals) ||
        balance.uiTokenAmount.decimals < 0 ||
        balance.uiTokenAmount.decimals > 255
      )
        throw new Error("Invalid receipt metadata account index or decimals");
      raw(balance.uiTokenAmount.amount);
    }
  }
  const pre = transaction.meta!.preTokenBalances!.find(
    (b) => b.accountIndex === index,
  );
  const post = transaction.meta!.postTokenBalances!.find(
    (b) => b.accountIndex === index,
  );
  if (!pre || !post)
    throw new Error("Fixture receipt is missing existing-account balances");
  for (const entry of [pre, post])
    if (
      entry.mint !== mint ||
      entry.owner !== expected.owner ||
      entry.programId !== expected.programId ||
      entry.uiTokenAmount.decimals !== expected.decimals
    )
      throw new Error("Receipt token identity mismatch");
  return raw(post.uiTokenAmount.amount) - raw(pre.uiTokenAmount.amount);
}
