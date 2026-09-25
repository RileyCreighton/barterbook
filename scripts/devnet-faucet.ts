/** One explicit faucet request; rate-limit retries apply only to reads. */
import { PublicKey } from "@solana/web3.js";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  args,
  assertDevnet,
  connection,
  fixtureKey,
  immutableJson,
  openRun,
  participants,
  pause,
  readJson,
  readRpc,
  recordEvent,
  safeName,
  type Run,
} from "./devnet-common";

export type FundingInspection = {
  checkedAt: string;
  wallet: string;
  finalizedLamports: string;
  history: Array<{
    signature: string;
    slot: number;
    err: unknown;
    confirmationStatus?: string;
    blockTime: number | null | undefined;
  }>;
  priorRequests: Array<{ at: string; txid?: string; state: string }>;
};
export async function inspectFunding(run: Run): Promise<FundingInspection> {
  const wallet = fixtureKey(run, "wallet-0").publicKey;
  const legacy = join(run.walletRoot, "faucet-request.json");
  const priorRequests: FundingInspection["priorRequests"] = [];
  if (existsSync(legacy)) {
    const previous = readJson<{
      wallet: string;
      createdAt: string;
      state: string;
      txid?: string;
    }>(legacy);
    if (previous.wallet !== wallet.toBase58())
      throw new Error("Original faucet journal belongs to another wallet");
    priorRequests.push({
      at: previous.createdAt,
      state: previous.state,
      ...(previous.txid ? { txid: previous.txid } : {}),
    });
  }
  const directory = join(run.privateRoot, "faucet");
  if (existsSync(directory))
    for (const name of readdirSync(directory)) {
      const file = join(directory, name, "request.json");
      if (!existsSync(file)) continue;
      const request = readJson<{ at: string; wallet: string }>(file);
      if (request.wallet !== wallet.toBase58())
        throw new Error("Faucet request identity mismatch");
      const resultPath = join(directory, name, "result.json");
      const result = existsSync(resultPath)
        ? readJson<{ state: string; txid?: string }>(resultPath)
        : { state: "REQUEST_STARTED" };
      priorRequests.push({ at: request.at, ...result });
    }
  const balance = await readRpc(() =>
    connection.getBalance(wallet, "finalized"),
  );
  if (!Number.isSafeInteger(balance))
    throw new Error("Unsafe RPC balance integer");
  const signatures = await readRpc(() =>
    connection.getSignaturesForAddress(wallet, { limit: 20 }, "finalized"),
  );
  const inspection: FundingInspection = {
    checkedAt: new Date().toISOString(),
    wallet: wallet.toBase58(),
    finalizedLamports: String(balance),
    history: signatures.map((s) => ({
      signature: s.signature,
      slot: s.slot,
      err: s.err,
      confirmationStatus: s.confirmationStatus,
      blockTime: s.blockTime,
    })),
    priorRequests,
  };
  recordEvent(join(run.evidenceRoot, "funding-checks"), {
    cluster: "devnet",
    runId: run.runId,
    existingUserFundsUsed: false,
    ...inspection,
  });
  return inspection;
}
export function allowFaucetRequest(
  inspection: FundingInspection,
  retry: boolean,
  now = Date.now(),
): void {
  if (BigInt(inspection.finalizedLamports) !== 0n)
    throw new Error(
      "Wallet already has finalized SOL; no repeat faucet request was made",
    );
  if (inspection.history.length)
    throw new Error(
      "Wallet has finalized history; inspect its funding and spending before requesting more SOL",
    );
  if (
    now - Date.parse(inspection.checkedAt) > 60_000 ||
    now < Date.parse(inspection.checkedAt)
  )
    throw new Error("Fresh finalized funding/history inspection is required");
  if (inspection.priorRequests.length && !retry)
    throw new Error(
      "Prior faucet request exists. Use --retry only after reviewing the fresh funding/history check",
    );
  for (const prior of inspection.priorRequests) {
    if (
      !Number.isFinite(Date.parse(prior.at)) ||
      now - Date.parse(prior.at) < 15 * 60_000
    )
      throw new Error(
        "Wait at least 15 minutes after a previous request; no automatic faucet retry",
      );
    if (prior.txid && prior.state !== "FAILED_ONCHAIN_FINALIZED")
      throw new Error(
        "A prior faucet signature is unresolved; reconcile that original signature before another request",
      );
  }
}
export async function requireFunding(run: Run): Promise<void> {
  const current = await inspectFunding(run);
  if (BigInt(current.finalizedLamports) < 100_000_000n)
    throw new Error(
      "At least 0.1 finalized faucet SOL is needed; run the funding check/request commands explicitly. No request was made by this command.",
    );
}
export async function main(): Promise<void> {
  const options = args();
  await assertDevnet();
  const run = openRun(options);
  participants(run, options.get("--browser-participants"));
  const inspection = await inspectFunding(run);
  console.log(
    JSON.stringify({
      runId: run.runId,
      wallet: inspection.wallet,
      finalizedLamports: inspection.finalizedLamports,
      finalizedHistoryEntries: inspection.history.length,
      previousFaucetRequests: inspection.priorRequests.length,
    }),
  );
  if (!options.has("--request") && !options.has("--retry")) return;
  const requestId = safeName(options.get("--request-id") ?? "");
  const directory = join(run.privateRoot, "faucet", requestId);
  if (existsSync(join(directory, "request.json"))) {
    console.log(
      "This faucet request ID is already recorded. Only the original funding/status check ran; no second request was made.",
    );
    return;
  }
  // Query known returned signatures before classifying any request as failed.
  for (const previous of inspection.priorRequests)
    if (previous.txid) {
      const status = (
        await readRpc(() =>
          connection.getSignatureStatuses([previous.txid!], {
            searchTransactionHistory: true,
          }),
        )
      ).value[0];
      if (status?.confirmationStatus === "finalized" && status.err)
        previous.state = "FAILED_ONCHAIN_FINALIZED";
    }
  allowFaucetRequest(inspection, options.has("--retry"));
  // Wallet-scoped permanent time bucket blocks concurrent command invocations, even across runs.
  const guardRoot = dirname(dirname(run.privateRoot));
  immutableJson(
    join(
      guardRoot,
      "faucet-request-slots",
      inspection.wallet,
      `${Math.floor(Date.now() / 900_000)}.json`,
    ),
    { runId: run.runId, requestId, at: new Date().toISOString() },
    true,
  );
  immutableJson(
    join(directory, "request.json"),
    {
      state: "REQUEST_STARTED",
      at: new Date().toISOString(),
      wallet: inspection.wallet,
      lamports: "1000000000",
      inspection,
    },
    true,
  );
  let txid: string;
  try {
    // Deliberately no requestAirdrop retry loop, even after network timeout or HTTP 429.
    txid = await connection.requestAirdrop(
      new PublicKey(inspection.wallet),
      1_000_000_000,
    );
    immutableJson(
      join(directory, "result.json"),
      { state: "REQUEST_ACCEPTED", txid },
      true,
    );
  } catch {
    immutableJson(
      join(directory, "result.json"),
      {
        state: "BLOCKED_OR_UNCERTAIN",
        reason:
          "The faucet returned an error or timed out. Inspect finalized funding/history before any later explicit retry.",
      },
      true,
    );
    recordEvent(join(run.evidenceRoot, "faucet-results"), {
      requestId,
      wallet: inspection.wallet,
      state: "BLOCKED_OR_UNCERTAIN",
      at: new Date().toISOString(),
      existingUserFundsUsed: false,
    });
    throw new Error(
      "Faucet request failed or is uncertain. No request retry occurred; the original request record is preserved.",
    );
  }
  recordEvent(join(run.evidenceRoot, "faucet-results"), {
    requestId,
    wallet: inspection.wallet,
    state: "REQUEST_ACCEPTED",
    txid,
    explorer: `https://explorer.solana.com/tx/${txid}?cluster=devnet`,
    at: new Date().toISOString(),
  });
  for (let i = 0; i < 20; i++) {
    await pause(2000);
    const current = await inspectFunding(run);
    if (BigInt(current.finalizedLamports) >= 100_000_000n) {
      console.log(
        `Faucet funding finalized for run ${run.runId}; public evidence is under ${run.evidenceRoot}.`,
      );
      return;
    }
  }
  throw new Error(
    "Faucet returned a signature but finalized funding is still pending; use the read-only funding check, not another request.",
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
        : "Devnet faucet check failed",
    );
    process.exitCode = 1;
  });
