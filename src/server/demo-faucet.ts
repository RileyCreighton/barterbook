import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Keypair } from "@solana/web3.js";
import {
  requireAuth,
  requireMutationOrigin,
  checkRateLimit,
  jsonObject,
  type AppContext,
} from "./auth";
import { assertDevnet, rpcFor, registry, Rpc } from "./chain";
import { b64, unb64 } from "../shared/crypto";
import { transactionId } from "../shared/transactions";
import {
  buildFaucetTransaction,
  verifyFaucetWire,
  FAUCET_AUTHORITY,
  DEMO_MINTS,
  type FaucetPlan,
  type FaucetClaim,
} from "../shared/demo-faucet";
interface Row {
  id: string;
  wallet: string;
  plan_json: string;
  wire_base64: string;
  signed_wire_base64: string | null;
  txid: string | null;
  state: string;
}
const publicClaim = (row: Row): FaucetClaim => ({
  id: row.id,
  plan: JSON.parse(row.plan_json),
  wireBase64: row.wire_base64,
  state: row.state,
  txid: row.txid,
});
export function createDemoFaucetRouter() {
  const app = new Hono<AppContext>();
  app.use("/demo/faucet/*", requireAuth);
  app.post("/demo/faucet/prepare", requireMutationOrigin, async (c) => {
    if (c.env.SOLANA_CLUSTER !== "devnet" || !c.env.DEMO_FAUCET_MINT_SECRET)
      throw new HTTPException(503, {
        message: "Test-token faucet is unavailable",
      });
    const wallet = c.get("wallet");
    await checkRateLimit(c.env.DB, `faucet-wallet:${wallet}`, 8, 86400000);
    await checkRateLimit(c.env.DB, "faucet-global", 200, 3600000);
    await checkRateLimit(
      c.env.DB,
      `faucet-ip:${c.req.header("CF-Connecting-IP") ?? "unknown"}`,
      24,
      3600000,
    );
    const configured = registry(c.env);
    if (
      configured.length !== 3 ||
      DEMO_MINTS.some(
        (m) => !configured.some((a) => a.mint === m && a.mock && a.tested),
      )
    )
      throw new Error("Test-token configuration mismatch");
    await assertDevnet(c.env);
    const rpc = rpcFor(c.env);
    if (
      Number(
        (await rpc.call("getBalance", [wallet, { commitment: "confirmed" }]))
          .value,
      ) < 10_000_000
    )
      throw new Error(
        "Get at least 0.01 Devnet SOL from the linked Solana faucet first",
      );
    const lifetime = (
      await rpc.call("getLatestBlockhash", [{ commitment: "confirmed" }])
    ).value;
    const plan: FaucetPlan = {
      wallet,
      cluster: "devnet",
      blockhash: lifetime.blockhash,
      lastValidBlockHeight: lifetime.lastValidBlockHeight,
    };
    const tx = buildFaucetTransaction(plan);
    const authority = Keypair.fromSecretKey(
      unb64(c.env.DEMO_FAUCET_MINT_SECRET),
    );
    if (authority.publicKey.toBase58() !== FAUCET_AUTHORITY)
      throw new Error("Test-token authority mismatch");
    tx.partialSign(authority);
    const fee = (
      await rpc.call("getFeeForMessage", [
        b64(tx.serializeMessage()),
        { commitment: "confirmed" },
      ])
    ).value;
    const rent = await rpc.call<number>("getMinimumBalanceForRentExemption", [
      178,
      { commitment: "confirmed" },
    ]);
    if (!Number.isSafeInteger(rent) || rent * 3 + fee >= 10_000_000)
      throw new Error("Test-token setup rent exceeds its cap");
    if (!Number.isSafeInteger(fee) || fee < 0 || fee > 10000)
      throw new Error("Test-token network fee exceeds its cap");
    const wire = b64(tx.serialize({ requireAllSignatures: false })),
      id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO demo_faucet_claims(id,wallet,plan_json,wire_base64,created_at) VALUES(?,?,?,?,?)",
    )
      .bind(id, wallet, JSON.stringify(plan), wire, Date.now())
      .run();
    return c.json({
      claim: {
        id,
        plan,
        wireBase64: wire,
        state: "PREPARED",
        txid: null,
      } satisfies FaucetClaim,
    });
  });
  app.get("/demo/faucet/latest", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT * FROM demo_faucet_claims WHERE wallet=? ORDER BY created_at DESC LIMIT 1",
    )
      .bind(c.get("wallet"))
      .first<Row>();
    return c.json({ claim: row ? publicClaim(row) : null });
  });
  app.get("/demo/faucet/:id", async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT * FROM demo_faucet_claims WHERE id=? AND wallet=?",
    )
      .bind(c.req.param("id"), c.get("wallet"))
      .first<Row>();
    if (!row)
      throw new HTTPException(404, { message: "Test-token request not found" });
    await assertDevnet(c.env);
    const rpc = rpcFor(c.env);
    if (row.txid && row.state !== "FINALIZED" && row.state !== "FAILED") {
      const status = (
        await rpc.call("getSignatureStatuses", [
          [row.txid],
          { searchTransactionHistory: true },
        ])
      ).value[0];
      if (status?.confirmationStatus === "finalized") {
        const tx = await rpc.call("getTransaction", [
          row.txid,
          {
            encoding: "base64",
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          },
        ]);
        if (!tx?.meta || tx.transaction[0] !== row.signed_wire_base64)
          throw new Error(
            "Original test-token transaction metadata unavailable",
          );
        row.state = tx.meta.err === null ? "FINALIZED" : "FAILED";
        await c.env.DB.prepare(
          "UPDATE demo_faucet_claims SET state=? WHERE id=?",
        )
          .bind(row.state, row.id)
          .run();
      }
    }
    if (
      row.state === "SUBMITTED" &&
      row.txid &&
      c.env.SOLANA_RPC_FALLBACK_URL
    ) {
      const plan = JSON.parse(row.plan_json) as FaucetPlan;
      const backup = new Rpc(c.env.SOLANA_RPC_FALLBACK_URL, c.env.DB);
      let absent = true;
      for (const provider of [rpc, backup]) {
        if (
          (await provider.call("getGenesisHash")) !==
          "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
        )
          throw new Error("Faucet recovery network mismatch");
        const height = await provider.call<number>("getBlockHeight", [
          { commitment: "finalized" },
        ]);
        if (height <= plan.lastValidBlockHeight) {
          absent = false;
          break;
        }
        const status = (
          await provider.call("getSignatureStatuses", [
            [row.txid],
            { searchTransactionHistory: true },
          ])
        ).value[0];
        if (status !== null) {
          absent = false;
          break;
        }
      }
      if (absent) {
        row.state = "EXPIRED";
        await c.env.DB.prepare(
          "UPDATE demo_faucet_claims SET state='EXPIRED' WHERE id=?",
        )
          .bind(row.id)
          .run();
      }
    }
    if (
      row.state === "PREPARED" &&
      (await rpc.call("getBlockHeight", [{ commitment: "confirmed" }])) >
        JSON.parse(row.plan_json).lastValidBlockHeight
    )
      row.state = "EXPIRED";
    return c.json({ claim: publicClaim(row) });
  });
  app.post("/demo/faucet/:id/submit", requireMutationOrigin, async (c) => {
    const row = await c.env.DB.prepare(
      "SELECT * FROM demo_faucet_claims WHERE id=? AND wallet=?",
    )
      .bind(c.req.param("id"), c.get("wallet"))
      .first<Row>();
    if (!row)
      throw new HTTPException(404, { message: "Test-token request not found" });
    if (["FINALIZED", "FAILED", "EXPIRED"].includes(row.state))
      return c.json({ claim: publicClaim(row) });
    await checkRateLimit(
      c.env.DB,
      `faucet-submit:${c.get("wallet")}`,
      12,
      60000,
    );
    const body = await jsonObject(c),
      plan = JSON.parse(row.plan_json) as FaucetPlan;
    const wire = row.signed_wire_base64 ?? body.wireBase64;
    if (typeof wire !== "string")
      throw new Error("Wallet approval is required");
    const bytes = unb64(wire);
    await verifyFaucetWire(bytes, plan, true);
    const txid = transactionId(bytes);
    await assertDevnet(c.env);
    // Persist exact executable bytes and identifier before the only broadcast path.
    await c.env.DB.prepare(
      "UPDATE demo_faucet_claims SET signed_wire_base64=?,txid=?,state='SUBMITTED' WHERE id=? AND txid IS NULL",
    )
      .bind(wire, txid, row.id)
      .run();
    const stored = await c.env.DB.prepare(
      "SELECT * FROM demo_faucet_claims WHERE id=?",
    )
      .bind(row.id)
      .first<Row>();
    if (stored?.signed_wire_base64 !== wire || stored.txid !== txid)
      throw new Error("Original test-token request changed");
    await rpcFor(c.env).call("sendTransaction", [
      wire,
      {
        encoding: "base64",
        skipPreflight: false,
        maxRetries: 0,
        preflightCommitment: "confirmed",
      },
    ]);
    return c.json({ claim: publicClaim(stored) });
  });
  return app;
}
