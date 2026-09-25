import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { NONCE_ACCOUNT_LENGTH } from "@solana/web3.js";
import bs58 from "bs58";
import { b64, unb64 } from "../shared/crypto";
import {
  nonceAddress,
  nonceOperationWire,
  verifyNonceOperation,
  MAX_NONCE_RENT,
  type NonceOperation,
  type NonceOperationPlan,
} from "../shared/nonce";
import type { Env } from "../shared/types";
import {
  requireAuth,
  requireMutationOrigin,
  jsonObject,
  checkRateLimit,
  type AppContext,
} from "./auth";
import { assertDevnet, integer, readSigningNonce, rpcFor, Rpc } from "./chain";
import { getMemberAttempt, saveAttempt } from "./db";
import { reconcileAttempt } from "./settlement";

type OperationRow = {
  id: string;
  wallet: string;
  kind: "setup" | "cancel";
  binding: string;
  state: NonceOperation["state"];
  plan_json: string;
  wire_base64: string;
  signed_wire_base64: string | null;
  txid: string | null;
  created_at: number;
  error: string | null;
};
function operation(row: OperationRow): NonceOperation {
  return {
    id: row.id,
    plan: JSON.parse(row.plan_json),
    wireBase64: row.wire_base64,
    signedWireBase64: row.signed_wire_base64,
    txid: row.txid,
    state: row.state,
    createdAt: row.created_at,
    error: row.error,
  };
}
async function owned(env: Env, id: string, wallet: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM nonce_operations WHERE id=? AND wallet=?",
  )
    .bind(id, wallet)
    .first<OperationRow>();
  if (!row)
    throw new HTTPException(404, { message: "Signing operation not found" });
  return operation(row);
}
async function current(env: Env, wallet: string, binding: string) {
  const row = await env.DB.prepare(
    "SELECT * FROM nonce_operations WHERE wallet=? AND binding=? AND state IN ('PREPARED','SUBMISSION_STARTED') ORDER BY created_at DESC LIMIT 1",
  )
    .bind(wallet, binding)
    .first<OperationRow>();
  return row ? operation(row) : null;
}
async function saveState(
  env: Env,
  old: NonceOperation,
  state: NonceOperation["state"],
  error: string | null,
) {
  await env.DB.prepare(
    "UPDATE nonce_operations SET state=?,error=? WHERE id=? AND state=?",
  )
    .bind(state, error, old.id, old.state)
    .run();
  return owned(env, old.id, old.plan.wallet);
}
async function createOperation(
  env: Env,
  plan: NonceOperationPlan,
  binding: string,
) {
  const wire = await nonceOperationWire(plan);
  const op: NonceOperation = {
    id: crypto.randomUUID(),
    plan,
    wireBase64: wire,
    signedWireBase64: null,
    txid: null,
    state: "PREPARED",
    createdAt: Date.now(),
    error: null,
  };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO nonce_operations(id,wallet,kind,binding,state,plan_json,wire_base64,created_at) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      op.id,
      plan.wallet,
      plan.kind,
      binding,
      op.state,
      JSON.stringify(plan),
      wire,
      op.createdAt,
    )
    .run();
  const saved = await current(env, plan.wallet, binding);
  if (!saved) throw new Error("Signing operation could not be saved.");
  return saved;
}

export async function reconcileNonceOperation(
  env: Env,
  op: NonceOperation,
): Promise<NonceOperation> {
  if (["FINALIZED", "FAILED", "EXPIRED"].includes(op.state)) return op;
  await assertDevnet(env);
  const rpc = rpcFor(env);
  if (op.txid && op.signedWireBase64) {
    const tx = await rpc.call("getTransaction", [
      op.txid,
      {
        encoding: "base64",
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      },
    ]);
    if (tx?.meta) {
      if (
        tx.transaction?.[1] !== "base64" ||
        tx.transaction[0] !== op.signedWireBase64
      )
        throw new Error(
          "Signing operation history does not match the original bytes.",
        );
      const parts = await verifyNonceOperation(
        unb64(tx.transaction[0]),
        op.plan,
        true,
      );
      if (bs58.encode(parts.signatures[0]) !== op.txid)
        throw new Error("Signing operation identity mismatch.");
      return saveState(
        env,
        op,
        tx.meta.err === null ? "FINALIZED" : "FAILED",
        tx.meta.err === null
          ? null
          : "Signing account operation failed on chain; a network fee may have been charged.",
      );
    }
  }
  const nonce = await readSigningNonce(
    rpc,
    op.plan.wallet,
    "finalized",
    Number(op.plan.contextSlot),
  );
  if (op.plan.kind === "setup" && nonce.account?.authority === op.plan.wallet) {
    // The deterministic account is the setup's complete desired effect, even
    // when a wallet sent its single-signature setup before its upload finished.
    return saveState(
      env,
      op,
      "FINALIZED",
      op.txid
        ? null
        : "Signing account is ready. No transaction receipt was recovered for this setup.",
    );
  }
  if (op.plan.kind === "cancel") {
    const attempt = await getMemberAttempt(
      env.DB,
      op.plan.attemptId!,
      op.plan.wallet,
    );
    if (!attempt) throw new Error("Original exchange is unavailable.");
    const reconciled = await reconcileAttempt(env, attempt);
    if (reconciled.safeToRetry || reconciled.state === "FINALIZED")
      return saveState(
        env,
        op,
        "EXPIRED",
        "The original exchange authorization is resolved. Check its room for the outcome.",
      );
    return op;
  }
  // A retry of account creation is safe only after the old signing window has
  // ended and both providers show the deterministic account still absent. This
  // makes no assertion about fees on a possibly failed original setup.
  const endpoints = [env.SOLANA_RPC_URL, env.SOLANA_RPC_FALLBACK_URL].filter(
    (s): s is string => !!s,
  );
  if (nonce.account || new Set(endpoints.map((s) => new URL(s).host)).size < 2)
    return op;
  for (const url of endpoints) {
    const provider = new Rpc(url, env.DB);
    if (
      (await provider.call("getGenesisHash")) !==
      "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
    )
      return op;
    const bank = await provider.call("getEpochInfo", [
      { commitment: "finalized" },
    ]);
    if (
      BigInt(integer(bank.blockHeight)) <= BigInt(op.plan.lastValidBlockHeight)
    )
      return op;
    const valid = await provider.call("isBlockhashValid", [
      op.plan.blockhash,
      {
        commitment: "finalized",
        minContextSlot: Number(integer(bank.absoluteSlot)),
      },
    ]);
    if (
      valid.value !== false ||
      BigInt(integer(valid.context?.slot)) < BigInt(integer(bank.absoluteSlot))
    )
      return op;
    if (
      (
        await readSigningNonce(
          provider,
          op.plan.wallet,
          "finalized",
          Number(integer(bank.absoluteSlot)),
        )
      ).account
    )
      return op;
  }
  return saveState(
    env,
    op,
    "EXPIRED",
    "Setup signing window ended and no signing account was found. You may review a new setup. Any prior network fees are undetermined.",
  );
}

export function createNonceRouter() {
  const app = new Hono<AppContext>();
  app.use("*", requireMutationOrigin);
  app.get("/nonce/status", requireAuth, async (c) => {
    await assertDevnet(c.env);
    const wallet = c.get("wallet");
    const nonce = await readSigningNonce(rpcFor(c.env), wallet, "finalized");
    if (nonce.account && nonce.account.authority !== wallet)
      throw new Error(
        "The signing account's authority changed. Restore it in your wallet before using this flow.",
      );
    const attemptId = c.req.query("attemptId");
    if (attemptId && !(await getMemberAttempt(c.env.DB, attemptId, wallet)))
      throw new HTTPException(404, { message: "Original exchange not found" });
    return c.json({
      ready: !!nonce.account,
      address: nonce.address,
      operation: await current(c.env, wallet, attemptId ?? "setup"),
    });
  });
  app.post("/nonce/setup", requireAuth, async (c) => {
    const wallet = c.get("wallet");
    await assertDevnet(c.env);
    await checkRateLimit(c.env.DB, `nonce-setup:${wallet}`, 6, 60000);
    const existing = await current(c.env, wallet, "setup");
    if (existing)
      return c.json({
        operation: await reconcileNonceOperation(c.env, existing),
      });
    const rpc = rpcFor(c.env),
      nonce = await readSigningNonce(rpc, wallet, "finalized");
    if (nonce.account) {
      if (nonce.account.authority !== wallet)
        throw new Error("The signing account has a different authority.");
      return c.json({ ready: true, address: nonce.address });
    }
    const rent = integer(
      await rpc.call("getMinimumBalanceForRentExemption", [
        NONCE_ACCOUNT_LENGTH,
      ]),
    );
    if (BigInt(rent) > BigInt(MAX_NONCE_RENT))
      throw new Error("Signing setup rent exceeds the permitted limit.");
    const latest = await rpc.call("getLatestBlockhash", [
      { commitment: "confirmed" },
    ]);
    const plan: NonceOperationPlan = {
      kind: "setup",
      wallet,
      nonceAccount: nonce.address,
      blockhash: latest.value.blockhash,
      contextSlot: integer(latest.context.slot),
      lastValidBlockHeight: integer(latest.value.lastValidBlockHeight),
      rentLamports: rent,
      networkFeeLamports: "5000",
    };
    const wire = await nonceOperationWire(plan);
    const parts = await verifyNonceOperation(unb64(wire), plan, false);
    const fee = await rpc.call("getFeeForMessage", [
      b64(parts.message),
      { commitment: "confirmed" },
    ]);
    plan.networkFeeLamports = integer(fee.value);
    return c.json(
      { operation: await createOperation(c.env, plan, "setup") },
      201,
    );
  });
  app.post("/attempts/:id/cancel-onchain", requireAuth, async (c) => {
    const wallet = c.get("wallet"),
      attempt = await getMemberAttempt(c.env.DB, c.req.param("id"), wallet);
    if (
      !attempt ||
      attempt.plan.terms.feePayer !== wallet ||
      !attempt.plan.terms.nonceAccount
    )
      throw new HTTPException(403, {
        message:
          "Only the fee payer can cancel this durable signing authorization.",
      });
    if (attempt.safeToRetry || attempt.state === "FINALIZED")
      throw new Error("Original exchange is already resolved.");
    await assertDevnet(c.env);
    const existing = await current(c.env, wallet, attempt.id);
    if (existing)
      return c.json({
        operation: await reconcileNonceOperation(c.env, existing),
      });
    const nonce = await readSigningNonce(
      rpcFor(c.env),
      wallet,
      "confirmed",
      Number(attempt.plan.contextSlot),
    );
    if (
      !nonce.account ||
      nonce.address !== attempt.plan.terms.nonceAccount ||
      nonce.account.value !== attempt.plan.blockhash ||
      nonce.account.authority !== wallet
    )
      throw new Error(
        "Original signing authorization has changed. Reconcile its outcome first.",
      );
    if (!attempt.stopRequested)
      await saveAttempt(
        c.env.DB,
        {
          ...attempt,
          stopRequested: true,
          error:
            "Cancellation requested. Existing signatures remain valid until on-chain cancellation is finalized.",
        },
        attempt.state,
        attempt,
      );
    const plan: NonceOperationPlan = {
      kind: "cancel",
      wallet,
      nonceAccount: nonce.address,
      blockhash: attempt.plan.blockhash,
      contextSlot: attempt.plan.contextSlot,
      lastValidBlockHeight: "0",
      rentLamports: "0",
      networkFeeLamports: String(nonce.account.lamportsPerSignature),
      attemptId: attempt.id,
    };
    return c.json(
      { operation: await createOperation(c.env, plan, attempt.id) },
      201,
    );
  });
  app.post("/nonce/operations/:id/reconcile", requireAuth, async (c) => {
    const op = await owned(c.env, c.req.param("id"), c.get("wallet"));
    await checkRateLimit(c.env.DB, `nonce-check:${op.id}`, 20, 60000);
    return c.json({ operation: await reconcileNonceOperation(c.env, op) });
  });
  app.post("/nonce/operations/:id/submit", requireAuth, async (c) => {
    const op = await owned(c.env, c.req.param("id"), c.get("wallet"));
    if (op.state !== "PREPARED")
      return c.json({ operation: await reconcileNonceOperation(c.env, op) });
    const body = await jsonObject(c);
    if (typeof body.wireBase64 !== "string")
      throw new Error("Signed setup or cancellation required.");
    const wire = unb64(body.wireBase64),
      parts = await verifyNonceOperation(wire, op.plan, true);
    await assertDevnet(c.env);
    const rpc = rpcFor(c.env);
    if (
      op.plan.kind === "setup" &&
      BigInt(
        integer(
          await rpc.call("getBlockHeight", [{ commitment: "confirmed" }]),
        ),
      ) > BigInt(op.plan.lastValidBlockHeight)
    )
      throw new Error(
        "Setup signing window ended. Check its status before reviewing another setup.",
      );
    if (op.plan.kind === "cancel") {
      const nonce = await readSigningNonce(
        rpc,
        op.plan.wallet,
        "confirmed",
        Number(op.plan.contextSlot),
      );
      if (
        !nonce.account ||
        nonce.account.value !== op.plan.blockhash ||
        nonce.account.authority !== op.plan.wallet
      )
        return c.json({ operation: await reconcileNonceOperation(c.env, op) });
    }
    const signed = b64(wire),
      txid = bs58.encode(parts.signatures[0]);
    const saved = await c.env.DB.prepare(
      "UPDATE nonce_operations SET signed_wire_base64=?,txid=?,state='SUBMISSION_STARTED',error=NULL WHERE id=? AND state='PREPARED'",
    )
      .bind(signed, txid, op.id)
      .run();
    if (saved.meta.changes !== 1)
      return c.json({ operation: await owned(c.env, op.id, op.plan.wallet) });
    // This committed journal precedes every broadcast; retries inspect its
    // original identity and never open another wallet or replace its bytes.
    try {
      const result = await rpc.call("sendTransaction", [
        signed,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 2,
          minContextSlot: Number(op.plan.contextSlot),
        },
      ]);
      if (result !== txid)
        throw new Error("Unexpected signing operation identifier.");
    } catch {
      await c.env.DB.prepare(
        "UPDATE nonce_operations SET error=? WHERE id=? AND state='SUBMISSION_STARTED'",
      )
        .bind(
          "Submission outcome needs checking. Check this original operation before another wallet approval.",
          op.id,
        )
        .run();
    }
    return c.json({
      operation: await reconcileNonceOperation(
        c.env,
        await owned(c.env, op.id, op.plan.wallet),
      ),
    });
  });
  app.post("/nonce/operations/:id/rebroadcast", requireAuth, async (c) => {
    const op = await reconcileNonceOperation(
      c.env,
      await owned(c.env, c.req.param("id"), c.get("wallet")),
    );
    if (op.state !== "SUBMISSION_STARTED" || !op.signedWireBase64)
      return c.json({ operation: op });
    await checkRateLimit(c.env.DB, `nonce-send:${op.id}`, 2, 60000);
    try {
      await rpcFor(c.env).call("sendTransaction", [
        op.signedWireBase64,
        {
          encoding: "base64",
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 2,
        },
      ]);
    } catch {
      /* Keep the original identity; the next check resolves its outcome. */
    }
    return c.json({ operation: await reconcileNonceOperation(c.env, op) });
  });
  return app;
}
