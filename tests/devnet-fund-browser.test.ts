import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  SystemProgram,
  Transaction,
  type TransactionResponse,
} from "@solana/web3.js";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildBrowserFundingTransaction,
  createBrowserFundingIntent,
  executeBrowserFunding,
  requireBrowserFundingBudget,
  selectBrowserRecipients,
  verifyBrowserFundingMessage,
  verifyBrowserFundingReceipt,
  type BrowserFundingIntent,
} from "../scripts/devnet-fund-browser";
import {
  connection,
  fixtureKey,
  journalPath,
  openRun,
  readJson,
  type Journal,
  type Participant,
} from "../scripts/devnet-common";

const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bb-browser-funding-test-"));
  directories.push(directory);
  const run = openRun(
    new Map([
      ["--run", "funding-test"],
      ["--execute", "true"],
      ["--resume", "true"],
    ]),
    directory,
  );
  const roster: Participant[] = [0, 1, 2].map((i) => ({
    id: `browser-${i}`,
    label: `Browser ${i + 1}`,
    publicKey: Keypair.generate().publicKey.toBase58(),
    kind: "browser",
    signingEvidence: "not-yet-proven",
  }));
  const intent = createBrowserFundingIntent(run, "browser-01", roster);
  return { run, roster, intent };
}
function receiptFor(
  transaction: Transaction,
  intent: BrowserFundingIntent,
): TransactionResponse {
  const message = transaction.compileMessage(),
    keys = message.accountKeys.map((key) => key.toBase58());
  const preBalances = keys.map((_, i) => (i === 0 ? 500_000_000 : 1));
  const postBalances = preBalances.map((value, i) =>
    i === 0
      ? value -
        intent.recipients.reduce(
          (sum, recipient) => sum + Number(recipient.lamportsRaw),
          5000,
        )
      : value +
        Number(
          intent.recipients.find((recipient) => recipient.publicKey === keys[i])
            ?.lamportsRaw ?? 0,
        ),
  );
  return {
    slot: 50,
    blockTime: 1_700_000_000,
    transaction: { message, signatures: [] },
    meta: {
      err: null,
      fee: 5000,
      preBalances,
      postBalances,
      preTokenBalances: [],
      postTokenBalances: [],
    },
  };
}

describe("isolated browser setup SOL funding", () => {
  it("allows only one to three distinct recorded browser recipients, never arbitrary addresses or the payer", () => {
    const { run, roster } = setup(),
      payer = fixtureKey(run, "wallet-0").publicKey.toBase58();
    expect(selectBrowserRecipients(roster, payer)).toHaveLength(3);
    expect(() =>
      selectBrowserRecipients(roster, payer, [
        Keypair.generate().publicKey.toBase58(),
      ]),
    ).toThrow(/recorded/);
    expect(() =>
      selectBrowserRecipients(roster, payer, [
        roster[0].publicKey,
        roster[0].publicKey,
      ]),
    ).toThrow(/distinct/);
    expect(() => selectBrowserRecipients(roster, payer, [])).toThrow(
      /one to three/,
    );
    expect(() =>
      selectBrowserRecipients(
        [
          ...roster,
          { ...roster[0], publicKey: Keypair.generate().publicKey.toBase58() },
        ],
        payer,
      ),
    ).toThrow(/one to three/);
    expect(() =>
      selectBrowserRecipients([{ ...roster[0], publicKey: payer }], payer),
    ).toThrow(/payer cannot/);
    expect(() =>
      selectBrowserRecipients(
        [{ ...roster[0], kind: "sdk-disposable" }],
        payer,
        [roster[0].publicKey],
      ),
    ).toThrow(/recorded/);
  });
  it("keeps the payer reserve plus a conservative fee cap and freezes each batch's exact recipients/amount", () => {
    const { run, roster, intent } = setup();
    expect(intent.recipients.map((recipient) => recipient.lamportsRaw)).toEqual(
      ["50000000", "50000000", "50000000"],
    );
    expect(() =>
      requireBrowserFundingBudget("250010000", intent),
    ).not.toThrow();
    expect(() => requireBrowserFundingBudget("250009999", intent)).toThrow(
      /preserved payer reserve/,
    );
    expect(
      createBrowserFundingIntent(run, "browser-01", [...roster].reverse()),
    ).toEqual(intent);
    expect(() =>
      createBrowserFundingIntent(run, "browser-01", roster, "50000001"),
    ).toThrow(/immutable/);
    expect(() =>
      createBrowserFundingIntent(run, "browser-01", roster, "50000000", [
        roster[0].publicKey,
      ]),
    ).toThrow(/immutable/);
    expect(() => createBrowserFundingIntent(run, "zero", roster, "0")).toThrow(
      /positive/,
    );
    expect(() =>
      createBrowserFundingIntent(run, "noncanonical", roster, "050000000"),
    ).toThrow();
  });
  it("verifies the complete setup message and exact recipient, payer and remaining-account SOL deltas", () => {
    const { intent } = setup(),
      transaction = buildBrowserFundingTransaction(
        intent,
        Keypair.generate().publicKey.toBase58(),
      );
    expect(() =>
      verifyBrowserFundingMessage(transaction, intent),
    ).not.toThrow();
    const receipt = receiptFor(transaction, intent);
    expect(verifyBrowserFundingReceipt(receipt, intent)).toMatchObject({
      verified: true,
      networkFeeLamports: "5000",
      totalRecipientLamports: "150000000",
    });
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: new Keypair().publicKey,
        toPubkey: Keypair.generate().publicKey,
        lamports: 1,
      }),
    );
    expect(() => verifyBrowserFundingMessage(transaction, intent)).toThrow(
      /differs/,
    );
  });
  it.each([
    "recipient amount",
    "payer debit",
    "unrelated account",
    "unsafe integer",
    "fee cap",
    "reserve",
    "metadata length",
    "failed transaction",
  ])("rejects %s violations in finalized SOL metadata", (attack) => {
    const { intent } = setup(),
      transaction = buildBrowserFundingTransaction(
        intent,
        Keypair.generate().publicKey.toBase58(),
      ),
      receipt = receiptFor(transaction, intent),
      meta = receipt.meta!;
    const index = receipt.transaction.message.accountKeys.findIndex(
      (key) => key.toBase58() === intent.recipients[0].publicKey,
    );
    const unrelated = receipt.transaction.message.accountKeys.findIndex((key) =>
      key.equals(SystemProgram.programId),
    );
    switch (attack) {
      case "recipient amount":
        meta.postBalances[index]++;
        break;
      case "payer debit":
        meta.postBalances[0]++;
        break;
      case "unrelated account":
        meta.postBalances[unrelated]++;
        break;
      case "unsafe integer":
        meta.preBalances[index] = Number.MAX_SAFE_INTEGER + 1;
        break;
      case "fee cap":
        meta.fee = 10001;
        meta.postBalances[0] -= 5001;
        break;
      case "reserve":
        meta.preBalances[0] = 200_000_000;
        meta.postBalances[0] = 49_995_000;
        break;
      case "metadata length":
        meta.postBalances.pop();
        break;
      case "failed transaction":
        meta.err = { InstructionError: [0, "InsufficientFunds"] };
        break;
    }
    expect(() => verifyBrowserFundingReceipt(receipt, intent)).toThrow();
  });
  it("persists before a send timeout and reconciles original success without duplicate funding even when current payer balance is zero", async () => {
    const { run, intent } = setup(),
      blockhash = Keypair.generate().publicKey.toBase58();
    const latest = vi
      .spyOn(connection, "getLatestBlockhash")
      .mockResolvedValue({ blockhash, lastValidBlockHeight: 100 });
    const balance = vi
      .spyOn(connection, "getBalance")
      .mockResolvedValue(500_000_000);
    vi.spyOn(connection, "getFeeForMessage").mockResolvedValue({
      context: { slot: 40 },
      value: 5000,
    });
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 40 },
      value: { err: null, logs: [] },
    });
    let receipt: TransactionResponse;
    const sender = vi
      .spyOn(connection, "sendRawTransaction")
      .mockImplementation(async (bytes) => {
        const journal = readJson<Journal>(journalPath(run, intent.operation));
        expect(journal.wireBase64).toBe(Buffer.from(bytes).toString("base64"));
        const events = readdirSync(
          join(run.privateRoot, "transactions", intent.operation, "events"),
        ).map((file) =>
          readJson<{ state: string }>(
            join(
              run.privateRoot,
              "transactions",
              intent.operation,
              "events",
              file,
            ),
          ),
        );
        expect(
          events.some((event) => event.state === "SUBMISSION_STARTED"),
        ).toBe(true);
        receipt = receiptFor(Transaction.from(bytes), intent);
        receipt.transaction.signatures = [journal.txid];
        throw new Error("Response lost after acceptance");
      });
    vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 51 },
      value: [null],
    });
    vi.spyOn(connection, "getTransaction").mockImplementation(
      async () => receipt,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                slot: receipt.slot,
                blockTime: receipt.blockTime,
                meta: receipt.meta,
                transaction: [
                  readJson<Journal>(journalPath(run, intent.operation))
                    .wireBase64,
                  "base64",
                ],
              },
            }),
          ),
      ),
    );
    const first = await executeBrowserFunding(run, intent),
      frozen = readFileSync(journalPath(run, intent.operation), "utf8");
    balance.mockResolvedValue(0);
    const second = await executeBrowserFunding(run, intent);
    expect(first.transaction.signatures).toEqual(second.transaction.signatures);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(balance).toHaveBeenCalledTimes(1);
    expect(readFileSync(journalPath(run, intent.operation), "utf8")).toBe(
      frozen,
    );
    expect(
      existsSync(join(run.evidenceRoot, `${intent.operation}-receipt.json`)),
    ).toBe(true);
  });
  it("concurrent starts with different blockhashes retain one immutable attempt and reject the competing executable message", async () => {
    const { run, intent } = setup();
    const blockhashes = [
      Keypair.generate().publicKey.toBase58(),
      Keypair.generate().publicKey.toBase58(),
    ];
    const path = journalPath(run, intent.operation);
    const latest = vi
      .spyOn(connection, "getLatestBlockhash")
      .mockResolvedValueOnce({
        blockhash: blockhashes[0],
        lastValidBlockHeight: 100,
      })
      .mockResolvedValueOnce({
        blockhash: blockhashes[1],
        lastValidBlockHeight: 101,
      });
    vi.spyOn(connection, "getBalance").mockResolvedValue(500_000_000);
    let releaseBothBuilds!: () => void;
    const bothBuildsEntered = new Promise<void>((resolve) => {
      releaseBothBuilds = resolve;
    });
    const candidateMessages: string[] = [];
    vi.spyOn(connection, "getFeeForMessage").mockImplementation(
      async (message) => {
        // Neither concurrent builder may freeze or send before both observed an absent journal.
        expect(existsSync(path)).toBe(false);
        candidateMessages.push(
          Buffer.from(message.serialize()).toString("base64"),
        );
        if (candidateMessages.length === 2) releaseBothBuilds();
        await bothBuildsEntered;
        return { context: { slot: 40 }, value: 5000 };
      },
    );
    vi.spyOn(connection, "simulateTransaction").mockResolvedValue({
      context: { slot: 40 },
      value: { err: null, logs: [] },
    });
    let receipt!: TransactionResponse;
    let frozenAtSend = "";
    const sentMessages: string[] = [];
    const sender = vi
      .spyOn(connection, "sendRawTransaction")
      .mockImplementation(async (bytes) => {
        const journal = readJson<Journal>(path);
        frozenAtSend = readFileSync(path, "utf8");
        expect(journal.wireBase64).toBe(Buffer.from(bytes).toString("base64"));
        sentMessages.push(
          Buffer.from(Transaction.from(bytes).serializeMessage()).toString(
            "base64",
          ),
        );
        receipt = receiptFor(Transaction.from(bytes), intent);
        receipt.transaction.signatures = [journal.txid];
        return journal.txid;
      });
    vi.spyOn(connection, "getSignatureStatuses").mockResolvedValue({
      context: { slot: 51 },
      value: [null],
    });
    vi.spyOn(connection, "getTransaction").mockImplementation(
      async () => receipt,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              result: {
                slot: receipt.slot,
                blockTime: receipt.blockTime,
                meta: receipt.meta,
                transaction: [readJson<Journal>(path).wireBase64, "base64"],
              },
            }),
          ),
      ),
    );
    const outcomes = await Promise.allSettled([
      executeBrowserFunding(run, intent),
      executeBrowserFunding(run, intent),
    ]);
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(
      /Immutable record already exists/,
    );
    expect(new Set(candidateMessages).size).toBe(2);
    expect(latest).toHaveBeenCalledTimes(2);
    expect(sender).toHaveBeenCalledTimes(1);
    const saved = readJson<Journal>(path);
    expect(candidateMessages).toContain(saved.messageBase64);
    expect(sentMessages).toEqual([saved.messageBase64]);
    expect(readFileSync(path, "utf8")).toBe(frozenAtSend);
    expect(fulfilled[0].value.transaction.signatures).toEqual([saved.txid]);
    expect(
      readJson<{
        txid: string;
        verified: boolean;
        totalRecipientLamports: string;
      }>(join(run.evidenceRoot, `${intent.operation}-receipt.json`)),
    ).toMatchObject({
      txid: saved.txid,
      verified: true,
      totalRecipientLamports: "150000000",
    });
    expect(
      readdirSync(
        join(run.privateRoot, "transactions", intent.operation),
      ).filter((file) => file === "attempt.json"),
    ).toHaveLength(1);
  });
  it("refuses to build or send when the current balance cannot preserve the reserve", async () => {
    const { run, intent } = setup();
    vi.spyOn(connection, "getBalance").mockResolvedValue(250_009_999);
    const latest = vi.spyOn(connection, "getLatestBlockhash"),
      sender = vi.spyOn(connection, "sendRawTransaction");
    await expect(executeBrowserFunding(run, intent)).rejects.toThrow(
      /Insufficient finalized/,
    );
    expect(latest).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
    expect(existsSync(journalPath(run, intent.operation))).toBe(false);
  });
});
