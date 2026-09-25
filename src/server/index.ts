import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import {
  createAuthRouter,
  requireAuth,
  requireMutationOrigin,
  jsonObject,
  checkRateLimit,
  type AppContext,
} from "./auth";
import { createBoardRouter } from "./board";
import { createSettlementRouter } from "./settlement";
import { getAssets, getPublicAssets, getHoldings } from "./chain";
import { createPublicRouter } from "./public";
import { createRoom, getListing, listingFromRow, type ListingRow } from "./db";
import { findMatches } from "../shared/matcher";
import { hashTerms, validateTerms } from "../shared/transactions";
import { raw } from "../shared/amounts";
import type { Terms } from "../shared/types";
const app = new Hono<AppContext>();
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 32768,
    onError: (c) => c.json({ error: "Request is too large" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  await next();
});
app.onError((err, c) => {
  if (err instanceof HTTPException)
    return c.json({ error: err.message }, err.status);
  // Never surface endpoint URLs, bindings, request bodies or database SQL errors.
  const message = err instanceof Error ? err.message : "Request failed";
  const safe =
    !/https?:|sql|d1_|select |insert |secret|api-key/i.test(message) &&
    message.length < 250
      ? message
      : "Request could not be completed; reload original state";
  return c.json({ error: safe }, 400);
});
app.get("/api/health", (c) =>
  c.json({
    name: "BarterBook",
    cluster: c.env.SOLANA_CLUSTER,
    settlementEnabled:
      c.env.SETTLEMENT_ENABLED === "true" && c.env.SOLANA_CLUSTER === "devnet",
    rpcConfigured: !!c.env.SOLANA_RPC_URL,
  }),
);
app.get("/api/assets", async (c) =>
  c.json({
    assets: await getPublicAssets(c.env),
    cluster: c.env.SOLANA_CLUSTER,
    settlementEnabled:
      c.env.SETTLEMENT_ENABLED === "true" && c.env.SOLANA_CLUSTER === "devnet",
    rpcConfigured: !!c.env.SOLANA_RPC_URL,
  }),
);
app.route("/api/auth", createAuthRouter());
app.route(
  "/api",
  createBoardRouter({ getAssets, getHoldings, validateTerms, hashTerms }),
);
app.route("/api", createSettlementRouter());
app.route("/api", createPublicRouter());
app.get("/api/assets/fresh", requireAuth, async (c) => {
  await checkRateLimit(c.env.DB, `fresh-assets:${c.get("wallet")}`, 12, 60000);
  return c.json({ assets: await getAssets(c.env) });
});
app.get("/api/holdings", requireAuth, async (c) =>
  c.json({ holdings: await getHoldings(c.env, c.get("wallet")) }),
);
app.get("/api/matches", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT l.*,EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||l.id OR lock_key='wallet:'||l.cluster||':'||l.owner) AS locked FROM listings l WHERE cluster=? AND status='OPEN' AND expires_at>? ORDER BY created_at DESC,id LIMIT 50",
  )
    .bind(c.env.SOLANA_CLUSTER, Date.now())
    .all<ListingRow>();
  const matches = findMatches(
    rows.results.map(listingFromRow),
    await getPublicAssets(c.env),
    c.env.SOLANA_CLUSTER,
    Date.now(),
    c.req.query("listingId"),
  );
  return c.json({
    matches,
    bounded: true,
    scanned: rows.results.length,
    maximumCandidatePairs: 625,
  });
});
app.post("/api/matches/room", requireMutationOrigin, requireAuth, async (c) => {
  const body = await jsonObject(c);
  const ids = body.listingIds;
  if (
    !Array.isArray(ids) ||
    ![2, 3].includes(ids.length) ||
    new Set(ids).size !== ids.length ||
    ids.some((i) => typeof i !== "string")
  )
    throw new HTTPException(400, {
      message: "Choose exactly two or three source listings",
    });
  await checkRateLimit(c.env.DB, `match-room:${c.get("wallet")}`, 6, 60000);
  const listings = await Promise.all(
    (ids as string[]).map((id) => getListing(c.env.DB, id)),
  );
  if (listings.some((l) => !l))
    throw new HTTPException(409, {
      message: "A source listing is unavailable",
    });
  const present = listings.filter((l) => l !== null);
  if (!present.some((l) => l.owner === c.get("wallet")))
    throw new HTTPException(403, {
      message: "Only a participating listing owner can open this room",
    });
  const assets = await getAssets(c.env);
  for (const listing of present) {
    const holding = (await getHoldings(c.env, listing.owner)).find(
      (h) => h.asset.mint === listing.giveMint && h.supported,
    );
    if (!holding) throw new Error("Source inventory unavailable");
    listing.balanceRaw = holding.amountRaw;
  }
  const match = findMatches(present, assets, c.env.SOLANA_CLUSTER).find(
    (m) => m.listings.length === ids.length,
  );
  if (!match)
    throw new HTTPException(409, {
      message: "The current exact lots do not satisfy every net receipt",
    });
  const owners = match.listings.map((l) => l.owner);
  if (
    typeof body.feePayer !== "string" ||
    !owners.includes(body.feePayer) ||
    typeof body.maxNetworkFeeLamports !== "string" ||
    typeof body.maxAccountRentLamports !== "string"
  )
    throw new Error("Choose participant fee payer and exact SOL caps");
  raw(body.maxNetworkFeeLamports);
  raw(body.maxAccountRentLamports);
  const terms: Terms = {
    cluster: c.env.SOLANA_CLUSTER,
    version: 1,
    mode: match.mode,
    owners,
    feePayer: body.feePayer,
    maxNetworkFeeLamports: body.maxNetworkFeeLamports,
    maxAccountRentLamports: body.maxAccountRentLamports,
    legs: match.legs,
    minima: match.minima,
    expiresAt: Math.min(...present.map((l) => l.expiresAt)),
  };
  validateTerms(terms, assets);
  const room = await createRoom(c.env.DB, {
    terms,
    termsHash: await hashTerms(terms),
    listingIds: ids as string[],
    proposer: c.get("wallet"),
  });
  return c.json({ room }, 201);
});
app.notFound((c) => c.json({ error: "Not found" }, 404));
export default app;
