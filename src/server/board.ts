import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Asset, Env, Holding, Terms } from "../shared/types";
import { raw } from "../shared/amounts";
import { canonical, sha256 } from "../shared/crypto";
import {
  checkRateLimit,
  jsonObject,
  requireAuth,
  requireMutationOrigin,
  walletAddress,
  type AppContext,
} from "./auth";
import {
  createRoom,
  getListing,
  getRoom,
  listingFromRow,
  releaseAttemptLocks,
  requireRoomMember,
  reviseRoom,
  type ListingRow,
} from "./db";

export interface BoardDependencies {
  getAssets(env: Env): Promise<Asset[]>;
  getHoldings(env: Env, wallet: string): Promise<Holding[]>;
  validateTerms(terms: Terms, assets: Asset[]): void;
  hashTerms?(terms: Terms): Promise<string>;
}
interface OfferRow {
  id: string;
  room_id: string;
  proposer: string;
  recipient: string;
  version: number;
  previous_offer_id: string | null;
  status: string;
  created_at: number;
  terms_json?: string;
}
function offerFromRow(o: OfferRow) {
  return {
    id: o.id,
    roomId: o.room_id,
    proposer: o.proposer,
    recipient: o.recipient,
    version: o.version,
    previousOfferId: o.previous_offer_id,
    status: o.status,
    createdAt: o.created_at,
    ...(o.terms_json ? { terms: JSON.parse(o.terms_json) as Terms } : {}),
  };
}
function amount(value: unknown): string {
  try {
    if (typeof value !== "string") throw new Error();
    raw(value, false);
    return value;
  } catch {
    throw new HTTPException(400, {
      message: "Amounts must be positive canonical u64 integer strings",
    });
  }
}
function expiry(value: unknown): number {
  const now = Date.now();
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= now + 60_000 ||
    value > now + 7 * 86_400_000
  )
    throw new HTTPException(400, {
      message: "Expiry must be between one minute and seven days from now",
    });
  return value;
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new HTTPException(400, {
      message: "A positive terms version is required",
    });
  return value;
}
function ids(value: unknown): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 3 ||
    value.some((v) => typeof v !== "string" || v.length > 100) ||
    new Set(value).size !== value.length
  )
    throw new HTTPException(400, { message: "Invalid source listing IDs" });
  return value as string[];
}
async function stableId(
  key: string | undefined,
  wallet: string,
  action: string,
): Promise<string> {
  if (!key) return crypto.randomUUID();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
    throw new HTTPException(400, { message: "Invalid Idempotency-Key" });
  return (await sha256(`${wallet}:${action}:${key}`)).slice(0, 48);
}
function unavailable(): never {
  throw new HTTPException(409, {
    message: "Terms changed or an execution attempt is already frozen",
  });
}

export function createBoardRouter(deps: BoardDependencies): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use("*", requireMutationOrigin);
  const hashTerms =
    deps.hashTerms ?? ((terms: Terms) => sha256(canonical(terms)));
  async function checkedTerms(
    input: unknown,
    env: Env,
    wallet: string,
    allowRing = false,
  ): Promise<{ terms: Terms; termsHash: string }> {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new HTTPException(400, {
        message: "Complete exact terms are required",
      });
    const terms = input as Terms;
    const permittedMode =
      terms.mode === "BASKET" || (allowRing && terms.mode === "RING");
    const ownerCount = terms.mode === "RING" ? 3 : 2;
    if (
      terms.cluster !== env.SOLANA_CLUSTER ||
      !permittedMode ||
      !Array.isArray(terms.owners) ||
      terms.owners.length !== ownerCount ||
      !terms.owners.includes(wallet)
    )
      throw new HTTPException(400, {
        message: allowRing
          ? "Require two basket owners or three ring owners on this deployment network"
          : "A basket needs exactly two participants on this deployment network",
      });
    terms.owners.forEach(walletAddress);
    expiry(terms.expiresAt);
    version(terms.version);
    try {
      deps.validateTerms(terms, await deps.getAssets(env));
    } catch (e) {
      throw new HTTPException(400, {
        message: e instanceof Error ? e.message : "Invalid terms",
      });
    }
    for (const owner of terms.owners) {
      const holdings = await deps.getHoldings(env, owner);
      const totals = new Map<string, bigint>();
      for (const leg of terms.legs.filter((l) => l.fromOwner === owner))
        totals.set(leg.mint, (totals.get(leg.mint) ?? 0n) + raw(leg.grossRaw));
      for (const [mint, total] of totals) {
        const holding = holdings.find(
          (h) => h.asset.mint === mint && h.supported,
        );
        if (
          !holding ||
          raw(holding.amountRaw) < total ||
          terms.legs.some(
            (l) =>
              l.fromOwner === owner &&
              l.mint === mint &&
              l.sourceAccount !== holding.account,
          )
        )
          throw new HTTPException(409, {
            message:
              "A participant cannot fund the exact gross basket from their supported source ATA",
          });
      }
    }
    return { terms, termsHash: await hashTerms(terms) };
  }
  app.get("/listings", async (c) => {
    const mine = c.req.query("owner");
    const give = c.req.query("giveMint");
    const want = c.req.query("wantMint");
    const clauses = ["l.cluster=?", "l.status='OPEN'", "l.expires_at>?"];
    const params: (string | number)[] = [c.env.SOLANA_CLUSTER, Date.now()];
    if (mine) {
      clauses.push("l.owner=?");
      params.push(walletAddress(mine));
    }
    if (give) {
      clauses.push("l.give_mint=?");
      params.push(give);
    }
    if (want) {
      clauses.push("l.want_mint=?");
      params.push(want);
    }
    const rows = await c.env.DB.prepare(
      `SELECT l.*,EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||l.id OR lock_key='wallet:'||l.cluster||':'||l.owner) AS locked FROM listings l WHERE ${clauses.join(" AND ")} ORDER BY l.created_at DESC,l.id LIMIT 50`,
    )
      .bind(...params)
      .all<ListingRow>();
    return c.json({ listings: rows.results.map(listingFromRow), limit: 50 });
  });
  app.post("/listings", requireAuth, async (c) => {
    const body = await jsonObject(c);
    const wallet = c.get("wallet");
    await checkRateLimit(c.env.DB, `listing:${wallet}`, 20, 60_000);
    const giveMint = typeof body.giveMint === "string" ? body.giveMint : "";
    const wantMint = typeof body.wantMint === "string" ? body.wantMint : "";
    const grossRaw = amount(body.grossRaw),
      minReceiveNetRaw = amount(body.minReceiveNetRaw),
      expiresAt = expiry(body.expiresAt);
    const assets = await deps.getAssets(c.env);
    if (
      giveMint === wantMint ||
      ![giveMint, wantMint].every((mint) =>
        assets.some(
          (a) =>
            a.mint === mint && a.cluster === c.env.SOLANA_CLUSTER && a.tested,
        ),
      )
    )
      throw new HTTPException(400, {
        message: "Select two different validated assets on this network",
      });
    const id = await stableId(
      c.req.header("Idempotency-Key"),
      wallet,
      "listing",
    );
    const existing = await getListing(c.env.DB, id);
    if (existing) {
      if (
        existing.owner !== wallet ||
        existing.giveMint !== giveMint ||
        existing.wantMint !== wantMint ||
        existing.grossRaw !== grossRaw ||
        existing.minReceiveNetRaw !== minReceiveNetRaw ||
        existing.expiresAt !== expiresAt
      )
        throw new HTTPException(409, {
          message:
            "Idempotency key was already used for different listing terms",
        });
      return c.json({ listing: existing });
    }
    const holding = (await deps.getHoldings(c.env, wallet)).find(
      (h) => h.asset.mint === giveMint && h.supported,
    );
    if (!holding || raw(holding.amountRaw) < raw(grossRaw))
      throw new HTTPException(409, {
        message: "The supported source ATA cannot fund this exact gross lot",
      });
    const count = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM listings WHERE owner=? AND cluster=? AND status='OPEN' AND expires_at>?",
    )
      .bind(wallet, c.env.SOLANA_CLUSTER, Date.now())
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 20)
      throw new HTTPException(429, {
        message: "Withdraw an existing listing before posting more",
      });
    await c.env.DB.prepare(
      `INSERT INTO listings(id,owner,cluster,give_mint,want_mint,gross_raw,min_receive_net_raw,expires_at,created_at,balance_raw,balance_checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id,
        wallet,
        c.env.SOLANA_CLUSTER,
        giveMint,
        wantMint,
        grossRaw,
        minReceiveNetRaw,
        expiresAt,
        Date.now(),
        holding.amountRaw,
        holding.checkedAt,
      )
      .run();
    return c.json({ listing: await getListing(c.env.DB, id) }, 201);
  });
  app.post("/listings/:id/withdraw", requireAuth, async (c) => {
    const body = await jsonObject(c),
      expectedVersion = version(body.version);
    const listing = await getListing(c.env.DB, c.req.param("id"));
    if (!listing || listing.owner !== c.get("wallet"))
      throw new HTTPException(404, { message: "Listing not found" });
    if (
      listing.status === "WITHDRAWN" &&
      listing.version === expectedVersion + 1
    )
      return c.json({ listing });
    const result = await c.env.DB.prepare(
      "UPDATE listings SET status='WITHDRAWN',version=version+1 WHERE id=? AND owner=? AND version=? AND status='OPEN' AND NOT EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||listings.id)",
    )
      .bind(listing.id, c.get("wallet"), expectedVersion)
      .run();
    if (result.meta.changes !== 1) unavailable();
    return c.json({ listing: await getListing(c.env.DB, listing.id) });
  });
  app.get("/offers", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT o.*,r.terms_json FROM offers o JOIN room_revisions r ON r.room_id=o.room_id AND r.version=o.version
      WHERE o.proposer=? OR o.recipient=? ORDER BY o.created_at DESC LIMIT 50`,
    )
      .bind(c.get("wallet"), c.get("wallet"))
      .all<OfferRow>();
    c.header("Cache-Control", "no-store");
    return c.json({ offers: rows.results.map(offerFromRow) });
  });
  app.post("/offers", requireAuth, async (c) => {
    const body = await jsonObject(c),
      wallet = c.get("wallet");
    await checkRateLimit(c.env.DB, `offer:${wallet}`, 20, 60_000);
    const { terms, termsHash } = await checkedTerms(body.terms, c.env, wallet);
    if (terms.version !== 1)
      throw new HTTPException(400, {
        message: "New offers start at version 1",
      });
    const roomId = await stableId(
      c.req.header("Idempotency-Key"),
      wallet,
      "basket-room",
    );
    const listingIds = ids(body.listingIds);
    let room = await getRoom(c.env.DB, roomId);
    if (room) {
      if (
        !room.terms.owners.includes(wallet) ||
        room.termsHash !== termsHash ||
        canonical(room.listingIds) !== canonical(listingIds)
      )
        throw new HTTPException(409, {
          message:
            "Idempotency key was already used for different basket terms",
        });
    } else
      room = await createRoom(c.env.DB, {
        id: roomId,
        terms,
        termsHash,
        listingIds,
        proposer: wallet,
      });
    const id = `${roomId}-1`,
      recipient = terms.owners.find((o) => o !== wallet)!;
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO offers(id,room_id,proposer,recipient,version,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(id, room.id, wallet, recipient, 1, room.createdAt)
      .run();
    return c.json(
      {
        offer: offerFromRow(
          (await c.env.DB.prepare("SELECT * FROM offers WHERE id=?")
            .bind(id)
            .first<OfferRow>())!,
        ),
        room,
      },
      201,
    );
  });
  app.post("/offers/:id/counter", requireAuth, async (c) => {
    const body = await jsonObject(c),
      wallet = c.get("wallet");
    await checkRateLimit(c.env.DB, `offer:${wallet}`, 20, 60_000);
    const previous = await c.env.DB.prepare(
      "SELECT * FROM offers WHERE id=? AND (proposer=? OR recipient=?)",
    )
      .bind(c.req.param("id"), wallet, wallet)
      .first<OfferRow>();
    if (!previous) throw new HTTPException(404, { message: "Offer not found" });
    const room = await requireRoomMember(c.env.DB, previous.room_id, wallet);
    const expectedVersion = version(body.expectedVersion);
    const { terms, termsHash } = await checkedTerms(body.terms, c.env, wallet);
    if (
      canonical([...terms.owners].sort()) !==
        canonical([...room.terms.owners].sort()) ||
      terms.mode !== room.terms.mode
    )
      throw new HTTPException(400, {
        message: "Counteroffers must keep the same participants and mode",
      });
    const id = `${room.id}-${terms.version}`;
    if (
      room.terms.version === expectedVersion + 1 &&
      room.termsHash === termsHash
    ) {
      const existing = await c.env.DB.prepare(
        "SELECT * FROM offers WHERE id=? AND proposer=?",
      )
        .bind(id, wallet)
        .first<OfferRow>();
      if (existing) return c.json({ offer: offerFromRow(existing), room });
    }
    if (
      room.terms.version !== expectedVersion ||
      previous.version !== expectedVersion ||
      !["OPEN", "ACCEPTED"].includes(previous.status) ||
      terms.version !== expectedVersion + 1
    )
      unavailable();
    const updated = await reviseRoom(c.env.DB, room, terms, termsHash, wallet, {
      id,
      recipient: terms.owners.find((o) => o !== wallet)!,
      previousOfferId: previous.id,
    });
    return c.json(
      {
        offer: offerFromRow(
          (await c.env.DB.prepare("SELECT * FROM offers WHERE id=?")
            .bind(id)
            .first<OfferRow>())!,
        ),
        room: updated,
      },
      201,
    );
  });
  app.post("/offers/:id/reject", requireAuth, async (c) => {
    const body = await jsonObject(c),
      expectedVersion = version(body.version),
      wallet = c.get("wallet");
    const offer = await c.env.DB.prepare(
      "SELECT * FROM offers WHERE id=? AND (proposer=? OR recipient=?)",
    )
      .bind(c.req.param("id"), wallet, wallet)
      .first<OfferRow>();
    if (!offer) throw new HTTPException(404, { message: "Offer not found" });
    const room = await requireRoomMember(c.env.DB, offer.room_id, wallet);
    if (
      room.terms.version !== expectedVersion ||
      offer.version !== expectedVersion ||
      room.attempt
    )
      unavailable();
    try {
      await c.env.DB.prepare(
        "INSERT INTO events(id,room_id,kind,detail_json,created_at) VALUES(?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          room.id,
          "ROOM_REJECTED",
          JSON.stringify({
            version: expectedVersion,
            termsHash: room.termsHash,
            wallet,
          }),
          Date.now(),
        )
        .run();
    } catch {
      unavailable();
    }
    return c.json({ ok: true });
  });
  app.get("/rooms", requireAuth, async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT r.id FROM rooms r JOIN room_members m ON m.room_id=r.id WHERE m.wallet=? ORDER BY r.created_at DESC LIMIT 30`,
    )
      .bind(c.get("wallet"))
      .all<{ id: string }>();
    const rooms = await Promise.all(
      rows.results.map((r) => getRoom(c.env.DB, r.id)),
    );
    c.header("Cache-Control", "no-store");
    return c.json({ rooms });
  });
  app.get("/rooms/:id", requireAuth, async (c) => {
    const room = await requireRoomMember(
      c.env.DB,
      c.req.param("id"),
      c.get("wallet"),
    );
    c.header("Cache-Control", "no-store");
    return c.json({ room });
  });
  app.post("/rooms/:id/renew", requireAuth, async (c) => {
    const body = await jsonObject(c),
      wallet = c.get("wallet");
    const expectedVersion = version(body.expectedVersion);
    const room = await requireRoomMember(c.env.DB, c.req.param("id"), wallet);
    const old = room.attempt;
    if (
      room.terms.version !== expectedVersion ||
      !old ||
      body.attemptId !== old.id ||
      !old.safeToRetry ||
      old.successObserved ||
      !["FAILED_ONCHAIN", "EXPIRED_UNLANDED"].includes(old.state)
    )
      throw new HTTPException(409, {
        message:
          "Renewal requires the original attempt to have a reconciled finalized failure or authoritative expiry",
      });
    await checkRateLimit(c.env.DB, `renew:${wallet}`, 6, 60_000);
    const { terms, termsHash } = await checkedTerms(
      body.terms,
      c.env,
      wallet,
      true,
    );
    if (
      terms.version !== expectedVersion + 1 ||
      terms.mode !== room.terms.mode ||
      canonical([...terms.owners].sort()) !==
        canonical([...room.terms.owners].sort())
    )
      throw new HTTPException(400, {
        message:
          "Renewal must keep participants and mode and use the next terms version",
      });
    // Exact input terms are freshly checked, never repriced or resized silently.
    // reviseRoom's transaction guards recheck old outcome and version after RPC reads.
    // Recover a crash after safeToRetry was stored but before old-lock cleanup.
    // The DELETE guard checks the durable attempt again before releasing anything.
    try {
      await releaseAttemptLocks(c.env.DB, old.id);
    } catch {
      unavailable();
    }
    const updated = await reviseRoom(c.env.DB, room, terms, termsHash, wallet);
    return c.json({ room: updated }, 201);
  });
  app.post("/rooms/:id/accept", requireAuth, async (c) => {
    const body = await jsonObject(c),
      expectedVersion = version(body.version);
    const room = await requireRoomMember(
      c.env.DB,
      c.req.param("id"),
      c.get("wallet"),
    );
    if (
      room.terms.version !== expectedVersion ||
      room.termsHash !== body.termsHash ||
      room.terms.expiresAt <= Date.now() ||
      room.state === "REJECTED"
    )
      unavailable();
    if (
      room.members.find((m) => m.wallet === c.get("wallet"))
        ?.acceptedVersion === expectedVersion
    )
      return c.json({ room });
    try {
      const result = await c.env.DB.prepare(
        "UPDATE room_members SET accepted_version=? WHERE room_id=? AND wallet=?",
      )
        .bind(expectedVersion, room.id, c.get("wallet"))
        .run();
      if (result.meta.changes !== 1) unavailable();
    } catch {
      unavailable();
    }
    await c.env.DB.prepare(
      `UPDATE rooms SET state='ACCEPTED' WHERE id=? AND terms_version=? AND current_attempt_id IS NULL AND state<>'REJECTED' AND NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND accepted_version IS NOT rooms.terms_version)`,
    )
      .bind(room.id, expectedVersion)
      .run();
    await c.env.DB.prepare(
      `UPDATE offers SET status='ACCEPTED' WHERE room_id=? AND version=? AND NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=? AND accepted_version IS NOT ?)`,
    )
      .bind(room.id, expectedVersion, room.id, expectedVersion)
      .run();
    return c.json({ room: await getRoom(c.env.DB, room.id) });
  });
  app.post("/rooms/:id/ready", requireAuth, async (c) => {
    const body = await jsonObject(c),
      expectedVersion = version(body.version);
    if (typeof body.ready !== "boolean")
      throw new HTTPException(400, {
        message: "Readiness must be true or false",
      });
    const room = await requireRoomMember(
      c.env.DB,
      c.req.param("id"),
      c.get("wallet"),
    );
    if (
      room.terms.version !== expectedVersion ||
      room.terms.expiresAt <= Date.now() ||
      room.state === "REJECTED"
    )
      unavailable();
    const member = room.members.find((m) => m.wallet === c.get("wallet"));
    if (
      member?.acceptedVersion === expectedVersion &&
      member.ready === body.ready
    )
      return c.json({ room });
    try {
      const result = await c.env.DB.prepare(
        "UPDATE room_members SET ready=? WHERE room_id=? AND wallet=? AND accepted_version=?",
      )
        .bind(body.ready ? 1 : 0, room.id, c.get("wallet"), expectedVersion)
        .run();
      if (result.meta.changes !== 1) unavailable();
    } catch {
      unavailable();
    }
    await c.env.DB.prepare(
      `UPDATE rooms SET state=CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=rooms.id AND ready=0) THEN 'READY' ELSE 'ACCEPTED' END WHERE id=? AND terms_version=? AND current_attempt_id IS NULL AND state<>'REJECTED'`,
    )
      .bind(room.id, expectedVersion)
      .run();
    return c.json({ room: await getRoom(c.env.DB, room.id) });
  });
  return app;
}
