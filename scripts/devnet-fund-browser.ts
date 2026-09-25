/** Isolated devnet SETUP utility. Never imported by the application transfer verifier. */
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type TransactionResponse,
} from "@solana/web3.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { raw } from "../src/shared/amounts";
import { canonical } from "../src/shared/crypto";
import {
  args,
  assertDevnet,
  connection,
  fixtureKey,
  immutableJson,
  journalPath,
  openRun,
  participants,
  publicEvidence,
  readJson,
  readRpc,
  safeName,
  sendFixtureTransaction,
  validateJournal,
  type Journal,
  type Participant,
  type Run,
} from "./devnet-common";

export const DEFAULT_BROWSER_LAMPORTS = "50000000";
export const PAYER_RESERVE_LAMPORTS = "100000000";
export const FUNDING_FEE_CAP_LAMPORTS = "10000";
export interface BrowserFundingIntent {
  schemaVersion: 1;
  runId: string;
  batch: string;
  operation: string;
  buildId: string;
  createdAt: string;
  payer: string;
  recipients: Array<{ publicKey: string; label: string; lamportsRaw: string }>;
  reserveLamports: string;
  maxNetworkFeeLamports: string;
}
function address(value: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    throw new Error("Invalid public wallet address");
  const key = new PublicKey(value);
  if (key.toBase58() !== value || !PublicKey.isOnCurve(key.toBytes()))
    throw new Error(
      "Browser funding requires an ordinary signing wallet address",
    );
  return value;
}
export function selectBrowserRecipients(
  roster: Participant[],
  payer: string,
  requested?: string[],
): Participant[] {
  address(payer);
  const browser = roster.filter(
    (participant) => participant.kind === "browser",
  );
  const addresses =
    requested ?? browser.map((participant) => participant.publicKey);
  if (
    addresses.length < 1 ||
    addresses.length > 3 ||
    new Set(addresses).size !== addresses.length
  )
    throw new Error(
      "Select one to three distinct recorded browser participants",
    );
  return addresses
    .map((publicKey) => {
      address(publicKey);
      if (publicKey === payer)
        throw new Error("The SDK payer cannot be a browser funding recipient");
      const matches = browser.filter(
        (participant) => participant.publicKey === publicKey,
      );
      if (matches.length !== 1)
        throw new Error(
          "Recipient must be one uniquely recorded browser participant in this run",
        );
      return matches[0];
    })
    .sort((a, b) => a.publicKey.localeCompare(b.publicKey));
}
export function createBrowserFundingIntent(
  run: Run,
  batch: string,
  roster: Participant[],
  lamportsRaw = DEFAULT_BROWSER_LAMPORTS,
  requested?: string[],
): BrowserFundingIntent {
  safeName(batch);
  const operation = safeName(`browser-sol-${batch}`);
  const amount = raw(lamportsRaw);
  if (amount === 0n) throw new Error("Browser funding amount must be positive");
  const payer = fixtureKey(run, "wallet-0").publicKey.toBase58();
  const selected = selectBrowserRecipients(roster, payer, requested);
  const identity = {
    schemaVersion: 1 as const,
    runId: run.runId,
    batch,
    operation,
    payer,
    recipients: selected.map((participant) => ({
      publicKey: participant.publicKey,
      label: participant.label,
      lamportsRaw,
    })),
    reserveLamports: PAYER_RESERVE_LAMPORTS,
    maxNetworkFeeLamports: FUNDING_FEE_CAP_LAMPORTS,
  };
  // Reject impossible totals before reading balances or building a transaction.
  raw(
    (
      amount * BigInt(selected.length) +
      BigInt(PAYER_RESERVE_LAMPORTS) +
      BigInt(FUNDING_FEE_CAP_LAMPORTS)
    ).toString(),
  );
  const path = join(run.privateRoot, "browser-funding", `${batch}-intent.json`);
  if (existsSync(path)) {
    const previous = readJson<BrowserFundingIntent>(path);
    const {
      buildId: _build,
      createdAt: _created,
      ...previousIdentity
    } = previous;
    if (canonical(previousIdentity) !== canonical(identity))
      throw new Error(
        "Funding batch is immutable; its original amount and recipients cannot change",
      );
    return previous;
  }
  const intent: BrowserFundingIntent = {
    ...identity,
    buildId: run.buildId,
    createdAt: new Date().toISOString(),
  };
  immutableJson(path, intent, true);
  return intent;
}
export function requireBrowserFundingBudget(
  balanceRaw: string,
  intent: BrowserFundingIntent,
): void {
  const total = intent.recipients.reduce(
    (sum, recipient) => sum + raw(recipient.lamportsRaw),
    0n,
  );
  const required =
    total + raw(intent.reserveLamports) + raw(intent.maxNetworkFeeLamports);
  if (raw(balanceRaw) < required)
    throw new Error(
      `Insufficient finalized faucet SOL: this batch requires ${required} lamports including the preserved payer reserve and maximum fee`,
    );
}
export function buildBrowserFundingTransaction(
  intent: BrowserFundingIntent,
  blockhash: string,
): Transaction {
  const payer = new PublicKey(intent.payer);
  return new Transaction({ feePayer: payer, recentBlockhash: blockhash }).add(
    ...intent.recipients.map((recipient) =>
      SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(recipient.publicKey),
        lamports: raw(recipient.lamportsRaw),
      }),
    ),
  );
}
export function verifyBrowserFundingMessage(
  transaction: Transaction,
  intent: BrowserFundingIntent,
): void {
  if (!transaction.recentBlockhash)
    throw new Error("Funding lifetime is missing");
  const expected = buildBrowserFundingTransaction(
    intent,
    transaction.recentBlockhash,
  );
  if (
    !Buffer.from(expected.serializeMessage()).equals(
      Buffer.from(transaction.serializeMessage()),
    )
  )
    throw new Error("Funding message differs from its immutable setup intent");
}
function metadataRaw(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Unsafe SOL metadata integer");
  return raw(String(value));
}
export function verifyBrowserFundingReceipt(
  receipt: TransactionResponse,
  intent: BrowserFundingIntent,
) {
  const meta = receipt.meta;
  if (!meta || meta.err !== null)
    throw new Error(
      "Finalized metadata does not show successful browser setup funding",
    );
  const keys = receipt.transaction.message.accountKeys.map((key) =>
    key.toBase58(),
  );
  if (
    keys[0] !== intent.payer ||
    new Set(keys).size !== keys.length ||
    meta.preBalances.length !== keys.length ||
    meta.postBalances.length !== keys.length
  )
    throw new Error("Funding SOL account metadata does not match the message");
  const fee = metadataRaw(meta.fee);
  if (fee > raw(intent.maxNetworkFeeLamports))
    throw new Error("Actual funding network fee exceeds its cap");
  const recipients = new Map(
    intent.recipients.map((recipient) => [
      recipient.publicKey,
      raw(recipient.lamportsRaw),
    ]),
  );
  if (
    recipients.size !== intent.recipients.length ||
    [...recipients.keys()].some((key) => !keys.includes(key))
  )
    throw new Error("Funding recipient metadata is missing or duplicated");
  const total = [...recipients.values()].reduce(
    (sum, amount) => sum + amount,
    0n,
  );
  const deltas = keys.map((account, index) => {
    const pre = metadataRaw(meta.preBalances[index]),
      post = metadataRaw(meta.postBalances[index]);
    const delta = post - pre;
    const expected =
      account === intent.payer
        ? -(total + fee)
        : (recipients.get(account) ?? 0n);
    if (delta !== expected)
      throw new Error(
        "Finalized SOL delta differs from the exact setup funding intent",
      );
    if (index === 0 && post < raw(intent.reserveLamports))
      throw new Error(
        "Finalized funding receipt does not preserve the payer reserve",
      );
    return {
      account,
      preLamports: pre.toString(),
      postLamports: post.toString(),
      deltaLamports: delta.toString(),
    };
  });
  return {
    networkFeeLamports: fee.toString(),
    totalRecipientLamports: total.toString(),
    payerReserveLamports: intent.reserveLamports,
    deltas,
    verified: true as const,
  };
}
export async function executeBrowserFunding(
  run: Run,
  intent: BrowserFundingIntent,
): Promise<TransactionResponse> {
  const wallet = fixtureKey(run, "wallet-0");
  if (wallet.publicKey.toBase58() !== intent.payer)
    throw new Error("Funding payer differs from this run's disposable key");
  const existingPath = journalPath(run, intent.operation);
  if (existsSync(existingPath))
    verifyBrowserFundingMessage(
      Transaction.from(validateJournal(readJson<Journal>(existingPath))),
      intent,
    );
  const quoteFee = async (transaction: Transaction) => {
    const quote = await readRpc(() =>
      connection.getFeeForMessage(transaction.compileMessage(), "confirmed"),
    );
    if (
      quote.value === null ||
      metadataRaw(quote.value) > raw(intent.maxNetworkFeeLamports)
    )
      throw new Error(
        "Original funding lifetime has no usable fee quote within the fixed cap",
      );
  };
  run.beforeBroadcast = async () => {
    const balance = await readRpc(() =>
      connection.getBalance(wallet.publicKey, "finalized"),
    );
    requireBrowserFundingBudget(metadataRaw(balance).toString(), intent);
    if (existsSync(existingPath))
      await quoteFee(
        Transaction.from(validateJournal(readJson<Journal>(existingPath))),
      );
  };
  const receipt = await sendFixtureTransaction(
    run,
    intent.operation,
    async (blockhash) => {
      const transaction = buildBrowserFundingTransaction(intent, blockhash);
      verifyBrowserFundingMessage(transaction, intent);
      await quoteFee(transaction);
      return transaction;
    },
    [wallet],
  );
  const journal = readJson<Journal>(existingPath);
  verifyBrowserFundingMessage(
    Transaction.from(validateJournal(journal)),
    intent,
  );
  const verified = verifyBrowserFundingReceipt(receipt, intent);
  publicEvidence(run, `${intent.operation}-receipt.json`, {
    schemaVersion: 1,
    runId: run.runId,
    buildId: journal.buildId,
    cluster: "devnet",
    scope:
      "Disposable SDK payer distributes already faucet-funded SOL to recorded new browser test wallets. Setup only; not an application barter or browser signing proof.",
    batch: intent.batch,
    txid: journal.txid,
    explorer: `https://explorer.solana.com/tx/${journal.txid}?cluster=devnet`,
    commitment: "finalized",
    slot: String(receipt.slot),
    blockTime: receipt.blockTime ?? null,
    payer: intent.payer,
    recipients: intent.recipients,
    ...verified,
  });
  return receipt;
}
export async function main(): Promise<void> {
  const options = args();
  for (const name of options.keys())
    if (
      ![
        "--run",
        "--batch",
        "--lamports",
        "--addresses",
        "--execute",
        "--resume",
      ].includes(name)
    )
      throw new Error(`Unknown funding option ${name}`);
  for (const name of ["--execute", "--resume"])
    if (options.has(name) && options.get(name) !== "true")
      throw new Error(`Use ${name} as a flag without a value`);
  await assertDevnet();
  const run = openRun(options);
  const intent = createBrowserFundingIntent(
    run,
    options.get("--batch") ?? "browser-01",
    participants(run),
    options.get("--lamports") ?? DEFAULT_BROWSER_LAMPORTS,
    options.get("--addresses")?.split(","),
  );
  if (!run.execute && !run.resume) {
    console.log(
      JSON.stringify({
        scope: "Setup preview only; no broadcast",
        runId: run.runId,
        batch: intent.batch,
        payer: intent.payer,
        recipients: intent.recipients,
        reserveLamports: intent.reserveLamports,
        maxNetworkFeeLamports: intent.maxNetworkFeeLamports,
      }),
    );
    return;
  }
  await executeBrowserFunding(run, intent);
  console.log(
    `Original browser-funding batch ${intent.batch} finalized; exact SOL metadata verified. No faucet request was made.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message.replace(/https?:\/\/\S+/g, "[endpoint]")
        : "Browser setup funding failed",
    );
    process.exitCode = 1;
  });
