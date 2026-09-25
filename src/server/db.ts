import { HTTPException } from "hono/http-exception";
import type {
  Attempt,
  AttemptState,
  Listing,
  Room,
  RoomMember,
  Terms,
} from "../shared/types";

export interface RoomRow {
  id: string;
  cluster: string;
  mode: string;
  terms_version: number;
  terms_hash: string;
  terms_json: string;
  state: string;
  current_attempt_id: string | null;
  listing_ids_json: string;
  created_at: number;
}
export interface ListingRow {
  id: string;
  owner: string;
  cluster: Listing["cluster"];
  give_mint: string;
  want_mint: string;
  gross_raw: string;
  min_receive_net_raw: string;
  expires_at: number;
  version: number;
  status: Listing["status"];
  created_at: number;
  balance_raw: string;
  balance_checked_at: number;
  locked?: number;
}
export function listingFromRow(row: ListingRow): Listing {
  return {
    id: row.id,
    owner: row.owner,
    cluster: row.cluster,
    giveMint: row.give_mint,
    wantMint: row.want_mint,
    grossRaw: row.gross_raw,
    minReceiveNetRaw: row.min_receive_net_raw,
    expiresAt: row.expires_at,
    version: row.version,
    status: row.status,
    createdAt: row.created_at,
    balanceRaw: row.balance_raw,
    balanceCheckedAt: row.balance_checked_at,
    locked: Boolean(row.locked),
  };
}
export async function getListing(
  db: D1Database,
  id: string,
): Promise<Listing | null> {
  const row = await db
    .prepare(
      `SELECT l.*,EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||l.id OR lock_key='wallet:'||l.cluster||':'||l.owner) AS locked FROM listings l WHERE l.id=?`,
    )
    .bind(id)
    .first<ListingRow>();
  return row ? listingFromRow(row) : null;
}
export async function getAttempt(
  db: D1Database,
  id: string,
): Promise<Attempt | null> {
  const row = await db
    .prepare("SELECT payload_json FROM attempts WHERE id=?")
    .bind(id)
    .first<{ payload_json: string }>();
  return row ? (JSON.parse(row.payload_json) as Attempt) : null;
}
export async function getRoom(
  db: D1Database,
  id: string,
): Promise<Room | null> {
  const row = await db
    .prepare("SELECT * FROM rooms WHERE id=?")
    .bind(id)
    .first<RoomRow>();
  if (!row) return null;
  const members = await db
    .prepare(
      "SELECT wallet,accepted_version,ready FROM room_members WHERE room_id=? ORDER BY wallet",
    )
    .bind(id)
    .all<{ wallet: string; accepted_version: number | null; ready: number }>();
  const roomMembers: RoomMember[] = members.results.map((m) => ({
    wallet: m.wallet,
    acceptedVersion: m.accepted_version,
    ready: Boolean(m.ready),
  }));
  return {
    id: row.id,
    terms: JSON.parse(row.terms_json) as Terms,
    termsHash: row.terms_hash,
    state: row.state,
    members: roomMembers,
    attempt: row.current_attempt_id
      ? await getAttempt(db, row.current_attempt_id)
      : null,
    listingIds: JSON.parse(row.listing_ids_json) as string[],
    createdAt: row.created_at,
  };
}
export async function requireRoomMember(
  db: D1Database,
  id: string,
  wallet: string,
): Promise<Room> {
  // Membership check first avoids reading or returning another room's signed bytes.
  const membership = await db
    .prepare("SELECT 1 AS found FROM room_members WHERE room_id=? AND wallet=?")
    .bind(id, wallet)
    .first();
  if (!membership) throw new HTTPException(404, { message: "Room not found" });
  const room = await getRoom(db, id);
  if (!room) throw new HTTPException(404, { message: "Room not found" });
  return room;
}

export async function createRoom(
  db: D1Database,
  input: {
    id?: string;
    terms: Terms;
    termsHash: string;
    listingIds?: string[];
    proposer?: string;
  },
): Promise<Room> {
  const id = input.id ?? crypto.randomUUID();
  const { terms, termsHash } = input;
  if (terms.version !== 1)
    throw new HTTPException(400, {
      message: "New rooms start at terms version 1",
    });
  const listingIds = [...new Set(input.listingIds ?? [])];
  if (listingIds.length > 3)
    throw new HTTPException(400, { message: "Too many source listings" });
  const createdAt = Date.now();
  const statements = [
    db
      .prepare(
        `INSERT INTO rooms(id,cluster,mode,terms_json,listing_ids_json,created_at) VALUES(?,?,?,?,?,?)`,
      )
      .bind(
        id,
        terms.cluster,
        terms.mode,
        JSON.stringify(terms),
        JSON.stringify(listingIds),
        createdAt,
      ),
  ];
  for (const wallet of terms.owners)
    statements.push(
      db
        .prepare("INSERT INTO room_members(room_id,wallet) VALUES(?,?)")
        .bind(id, wallet),
    );
  statements.push(
    db
      .prepare(
        "INSERT INTO room_revisions(room_id,version,terms_json,terms_hash,proposer,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        id,
        1,
        JSON.stringify(terms),
        termsHash,
        input.proposer ?? terms.owners[0],
        createdAt,
      ),
  );
  for (const listingId of listingIds) {
    const listing = await getListing(db, listingId);
    if (!listing || listing.locked)
      throw new HTTPException(409, {
        message: "Source listing is unavailable",
      });
    statements.push(
      db
        .prepare(
          "INSERT INTO room_listing_refs(room_id,listing_id,listing_version) VALUES(?,?,?)",
        )
        .bind(id, listingId, listing.version),
    );
  }
  try {
    await db.batch(statements);
  } catch {
    throw new HTTPException(409, {
      message: "Could not create room; source listings or terms changed",
    });
  }
  return (await getRoom(db, id))!;
}

export async function reviseRoom(
  db: D1Database,
  room: Room,
  terms: Terms,
  termsHash: string,
  proposer: string,
  offer?: { id: string; recipient: string; previousOfferId: string },
): Promise<Room> {
  if (terms.version !== room.terms.version + 1)
    throw new HTTPException(409, {
      message: "Counteroffer must use the next terms version",
    });
  const now = Date.now();
  const statements = [
    db
      .prepare(
        "INSERT INTO room_revisions(room_id,version,terms_json,terms_hash,proposer,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        room.id,
        terms.version,
        JSON.stringify(terms),
        termsHash,
        proposer,
        now,
      ),
  ];
  if (offer)
    statements.push(
      db
        .prepare(
          `INSERT INTO offers(id,room_id,proposer,recipient,version,previous_offer_id,created_at) VALUES(?,?,?,?,?,?,?)`,
        )
        .bind(
          offer.id,
          room.id,
          proposer,
          offer.recipient,
          terms.version,
          offer.previousOfferId,
          now,
        ),
    );
  try {
    await db.batch(statements);
  } catch {
    throw new HTTPException(409, {
      message: "Terms changed or an attempt is already frozen; reload the room",
    });
  }
  return (await getRoom(db, room.id))!;
}

export async function acquireAttemptLocks(
  db: D1Database,
  room: Room,
  attempt: Attempt,
): Promise<void> {
  const now = Date.now();
  if (attempt.roomId !== room.id || attempt.termsHash !== room.termsHash)
    throw new HTTPException(409, {
      message: "Attempt belongs to different room terms",
    });
  const statements = [
    db
      .prepare(
        `INSERT INTO attempts(id,room_id,terms_hash,state,payload_json,txid,safe_to_retry,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        attempt.id,
        room.id,
        attempt.termsHash,
        attempt.state,
        JSON.stringify(attempt),
        attempt.txid,
        attempt.safeToRetry ? 1 : 0,
        attempt.createdAt,
        now,
      ),
  ];
  const keys = [
    ...room.terms.owners.map(
      (wallet) => `wallet:${room.terms.cluster}:${wallet}`,
    ),
    ...room.listingIds.map((id) => `listing:${id}`),
  ];
  for (const key of keys)
    statements.push(
      db
        .prepare(
          "INSERT INTO active_locks(lock_key,attempt_id,room_id,created_at) VALUES(?,?,?,?)",
        )
        .bind(key, attempt.id, room.id, now),
    );
  statements.push(
    db
      .prepare(
        "UPDATE rooms SET current_attempt_id=?,state='SIGNING' WHERE id=?",
      )
      .bind(attempt.id, room.id),
  );
  try {
    await db.batch(statements);
  } catch {
    throw new HTTPException(409, {
      message:
        "Readiness or source listings changed, or a participant already has an active attempt",
    });
  }
}

export async function saveAttempt(
  db: D1Database,
  attempt: Attempt,
  expectedState?: AttemptState,
  expectedPayload?: Attempt,
): Promise<void> {
  let sql =
    "UPDATE attempts SET state=?,payload_json=?,txid=?,safe_to_retry=?,updated_at=? WHERE id=?";
  const args: (string | number | null)[] = [
    attempt.state,
    JSON.stringify(attempt),
    attempt.txid,
    attempt.safeToRetry ? 1 : 0,
    Date.now(),
    attempt.id,
  ];
  if (expectedState) {
    sql += " AND state=?";
    args.push(expectedState);
  }
  if (expectedPayload) {
    sql += " AND payload_json=?";
    args.push(JSON.stringify(expectedPayload));
  }
  const result = await db
    .prepare(sql)
    .bind(...args)
    .run();
  if (result.meta.changes !== 1)
    throw new HTTPException(409, {
      message: "Attempt changed concurrently; reload its original status",
    });
}

export async function releaseAttemptLocks(
  db: D1Database,
  attemptId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM active_locks WHERE attempt_id=?")
    .bind(attemptId)
    .run();
}
