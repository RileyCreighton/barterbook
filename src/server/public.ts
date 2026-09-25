import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Attempt, Env, Receipt } from "../shared/types";
import { walletAddress, type AppContext } from "./auth";

export function demoParticipants(
  env: Env,
): { address: string; label: string }[] {
  const data: unknown = JSON.parse(env.DEMO_PARTICIPANTS_JSON || "[]");
  if (!Array.isArray(data) || data.length > 3)
    throw new Error(
      "Demo configuration must contain up to three public addresses",
    );
  const participants = data.map((item, index) => ({
    address: walletAddress(typeof item === "string" ? item : item?.address),
    label: `Demo wallet ${index + 1}`,
  }));
  if (new Set(participants.map((p) => p.address)).size !== participants.length)
    throw new Error("Duplicate demo participant");
  return participants;
}
function publicUrl(value?: string, githubOnly = false): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (githubOnly && url.hostname !== "github.com")
    )
      return null;
    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}
// Explicit projection keeps private attempt data out of unauthenticated responses.
function publicReceipt(input: Receipt): Receipt {
  return {
    txid: input.txid,
    cluster: input.cluster,
    slot: input.slot,
    blockTime: input.blockTime ?? null,
    status: input.status,
    networkFeeLamports: input.networkFeeLamports,
    accountRentLamports: input.accountRentLamports,
    issuerFees: input.issuerFees.map(({ mint, feeRaw }) => ({ mint, feeRaw })),
    deltas: input.deltas.map(
      ({ account, owner, mint, preRaw, postRaw, deltaRaw }) => ({
        account,
        owner,
        mint,
        preRaw,
        postRaw,
        deltaRaw,
      }),
    ),
    verified: true,
  };
}
const eligible = `a.state IN ('CONFIRMED','FINALIZED') AND r.cluster=?
  AND json_extract(a.payload_json,'$.receipt.verified')=1
  AND json_extract(a.payload_json,'$.receipt.cluster')=r.cluster
  AND json_extract(a.payload_json,'$.receipt.txid')=a.txid`;
export function createPublicRouter() {
  const app = new Hono<AppContext>();
  app.get("/demo", (c) =>
    c.json({
      cluster: c.env.SOLANA_CLUSTER,
      participants: demoParticipants(c.env),
      faucetUrl: "https://faucet.solana.com",
      siteUrl: publicUrl(c.env.SITE_URL),
      repoUrl: publicUrl(c.env.REPOSITORY_URL, true),
      buildId:
        c.env.BUILD_ID && /^[a-f0-9]{7,64}$/.test(c.env.BUILD_ID)
          ? c.env.BUILD_ID
          : null,
      settlementEnabled:
        c.env.SETTLEMENT_ENABLED === "true" &&
        c.env.SOLANA_CLUSTER === "devnet",
    }),
  );
  app.get("/history", async (c) => {
    const cursor = c.req.query("cursor");
    let before: { createdAt: number; txid: string } | null = null;
    if (cursor) {
      try {
        if (cursor.length > 300) throw new Error();
        before = JSON.parse(atob(cursor));
        if (
          !before ||
          !Number.isSafeInteger(before.createdAt) ||
          before.createdAt < 0 ||
          !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(before.txid)
        )
          throw new Error();
      } catch {
        throw new HTTPException(400, { message: "Invalid history cursor" });
      }
    }
    const args: (string | number)[] = [c.env.SOLANA_CLUSTER];
    let where = eligible;
    if (before) {
      where += " AND (a.created_at<? OR (a.created_at=? AND a.txid<?))";
      args.push(before.createdAt, before.createdAt, before.txid);
    }
    const rows = await c.env.DB.prepare(
      `SELECT a.txid,a.created_at,r.mode,
      json_extract(a.payload_json,'$.receipt') AS receipt_json,
      (a.state='FINALIZED' AND json_type(a.payload_json,'$.publicEvidence')='object') AS evidence_available
      FROM attempts a JOIN rooms r ON r.id=a.room_id WHERE ${where}
      ORDER BY a.created_at DESC,a.txid DESC LIMIT 31`,
    )
      .bind(...args)
      .all<{
        txid: string;
        created_at: number;
        mode: "BASKET" | "RING";
        receipt_json: string;
        evidence_available: number;
      }>();
    const demo = new Set(demoParticipants(c.env).map((p) => p.address));
    const shown = rows.results.slice(0, 30);
    const receipts = shown.map((row) => {
      const receipt = publicReceipt(JSON.parse(row.receipt_json));
      const owners = [...new Set(receipt.deltas.map((d) => d.owner))];
      return {
        ...receipt,
        mode: row.mode,
        owners: owners.length,
        transfers: receipt.issuerFees.length,
        createdAt: row.created_at,
        demo: owners.length > 0 && owners.every((o) => demo.has(o)),
        evidenceAvailable: Boolean(row.evidence_available),
      };
    });
    const last = shown.at(-1);
    return c.json({
      receipts,
      limit: 30,
      nextCursor:
        rows.results.length > 30 && last
          ? btoa(
              JSON.stringify({ createdAt: last.created_at, txid: last.txid }),
            )
          : null,
    });
  });
  app.get("/receipts/:txid", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT json_extract(a.payload_json,'$.receipt') AS receipt_json,
      (a.state='FINALIZED' AND json_type(a.payload_json,'$.publicEvidence')='object') AS evidence_available
      FROM attempts a JOIN rooms r ON r.id=a.room_id WHERE ${eligible} AND a.txid=? LIMIT 1`,
    )
      .bind(c.env.SOLANA_CLUSTER, c.req.param("txid"))
      .first<{ receipt_json: string; evidence_available: number }>();
    if (!row)
      throw new HTTPException(404, {
        message: "Verified transaction receipt not available",
      });
    return c.json({
      receipt: {
        ...publicReceipt(JSON.parse(row.receipt_json)),
        evidenceAvailable: Boolean(row.evidence_available),
      },
    });
  });
  app.get("/receipts/:txid/evidence", async (c) => {
    const row = await c.env.DB.prepare(
      `SELECT a.payload_json FROM attempts a
      JOIN rooms r ON r.id=a.room_id WHERE ${eligible} AND a.state='FINALIZED' AND a.txid=? LIMIT 1`,
    )
      .bind(c.env.SOLANA_CLUSTER, c.req.param("txid"))
      .first<{ payload_json: string }>();
    if (!row)
      throw new HTTPException(404, {
        message: "Finalized transaction evidence not available",
      });
    const attempt = JSON.parse(row.payload_json) as Attempt;
    if (!attempt.publicEvidence || !attempt.receipt || !attempt.fullWireBase64)
      throw new HTTPException(404, {
        message:
          "Raw metadata was not archived for this historical transaction",
      });
    // These bytes are already finalized public chain data. Never expose a live
    // partially signed or executable attempt through this unauthenticated route.
    c.header(
      "Content-Disposition",
      `attachment; filename="devnet-${attempt.txid}.json"`,
    );
    return c.json({
      schema: "barterbook-public-evidence-v1",
      cluster: attempt.plan.terms.cluster,
      source: "application settlement; signing-client type is not inferred",
      observedAt: attempt.publicEvidence.observedAt,
      buildId: attempt.publicEvidence.buildId,
      receipt: publicReceipt(attempt.receipt),
      mode: attempt.plan.terms.mode,
      feePayer: attempt.plan.terms.feePayer,
      transfers: attempt.plan.terms.legs.map(
        ({
          fromOwner,
          toOwner,
          mint,
          tokenProgram,
          decimals,
          sourceAccount,
          destinationATA,
          grossRaw,
          expectedFeeRaw,
          netRaw,
        }) => ({
          fromOwner,
          toOwner,
          mint,
          tokenProgram,
          decimals,
          sourceAccount,
          destinationATA,
          grossRaw,
          expectedFeeRaw,
          netRaw,
        }),
      ),
      termsHash: attempt.termsHash,
      messageHash: attempt.messageHash,
      messageBase64: attempt.messageBase64,
      fullWireBase64: attempt.fullWireBase64,
      requiredSigners: attempt.plan.terms.owners,
      transaction: attempt.publicEvidence.transaction,
    });
  });
  return app;
}
