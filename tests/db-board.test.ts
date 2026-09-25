import { afterEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { createBoardRouter } from "../src/server/board";
import {
  acquireAttemptLocks,
  createRoom,
  getRoom,
  releaseAttemptLocks,
  saveAttempt,
} from "../src/server/db";
import { sha256, b64 } from "../src/shared/crypto";
import {
  ata,
  buildTransaction,
  hashTerms,
  legFor,
  transactionId,
  validateTerms,
} from "../src/shared/transactions";
import type { Attempt, AttemptState, Env, Room } from "../src/shared/types";
import { fixture } from "./fixtures";
import { testDatabase } from "./db-fixture";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
async function setup(ownersCount = 2) {
  const db = testDatabase();
  databases.push(db);
  const f = fixture(ownersCount),
    origin = "https://barterbook.test";
  const app = createBoardRouter({
    getAssets: async () => f.assets,
    getHoldings: async (_env, wallet) =>
      f.assets.map((asset) => ({
        asset,
        account: ata(wallet, asset.mint, asset.tokenProgram),
        amountRaw: "18446744073709551615",
        supported: true,
        checkedAt: Date.now(),
      })),
    validateTerms,
  });
  const env = {
    DB: db,
    APP_ORIGIN: origin,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "false",
  } as unknown as Env;
  const tokens = new Map<string, string>();
  async function login(wallet: string) {
    const token = b64(crypto.getRandomValues(new Uint8Array(32)))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_"),
      id = crypto.randomUUID(),
      now = Date.now();
    await db.batch([
      db
        .prepare(
          "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          wallet,
          origin,
          "devnet",
          "test-only session fixture",
          now + 60_000,
          now,
        ),
      db
        .prepare(
          "INSERT INTO sessions(token_hash,challenge_id,wallet,origin,cluster,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
        )
        .bind(
          await sha256(token),
          id,
          wallet,
          origin,
          "devnet",
          now + 3600_000,
          now,
        ),
    ]);
    tokens.set(wallet, token);
  }
  for (const wallet of f.terms.owners) await login(wallet);
  const outsider = Keypair.generate().publicKey.toBase58();
  await login(outsider);
  function request(
    path: string,
    wallet?: string,
    body?: unknown,
    key?: string,
  ) {
    return app.request(
      path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(wallet
            ? { Cookie: `__Host-bb_session=${tokens.get(wallet)}` }
            : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  }
  return { db, f, request, outsider };
}
describe("persistent authenticated board workflow", () => {
  it("posts only selected inventory with exact integer strings; rejects unauthorized withdrawal", async () => {
    const { f, request, outsider } = await setup(),
      owner = f.terms.owners[0];
    const body = {
      giveMint: f.assets[0].mint,
      wantMint: f.assets[1].mint,
      grossRaw: "18446744073709551615",
      minReceiveNetRaw: "1",
      expiresAt: Date.now() + 3600_000,
    };
    expect((await request("/listings", undefined, body)).status).toBe(401);
    const created = await request(
      "/listings",
      owner,
      body,
      "listing-create-key",
    );
    expect(created.status).toBe(201);
    const { listing } = (await created.json()) as {
      listing: { id: string; grossRaw: string; version: number };
    };
    expect(listing.grossRaw).toBe("18446744073709551615");
    const replay = await request(
      "/listings",
      owner,
      body,
      "listing-create-key",
    );
    expect(replay.status).toBe(200);
    expect(
      (
        await request(
          "/listings",
          owner,
          { ...body, grossRaw: "1" },
          "listing-create-key",
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/listings/${listing.id}/withdraw`, outsider, {
          version: 1,
        })
      ).status,
    ).toBe(404);
    expect(
      (await request(`/listings/${listing.id}/withdraw`, owner, { version: 2 }))
        .status,
    ).toBe(409);
    expect(
      (await request(`/listings/${listing.id}/withdraw`, owner, { version: 1 }))
        .status,
    ).toBe(200);
    const publicBoard = (await (await request("/listings")).json()) as {
      listings: unknown[];
    };
    expect(publicBoard.listings).toHaveLength(0);
  });
  it("persists exact two-for-one offers, isolates rooms and invalidates both acceptances on a counteroffer", async () => {
    const { f, request, outsider } = await setup(),
      [alice, bob] = f.terms.owners;
    const created = await request(
      "/offers",
      alice,
      { terms: f.terms },
      "basket-create-key",
    );
    expect(created.status).toBe(201);
    const initial = (await created.json()) as {
      room: Room;
      offer: { id: string };
    };
    expect(initial.room.terms.legs).toHaveLength(3);
    expect((await request(`/rooms/${initial.room.id}`, outsider)).status).toBe(
      404,
    );
    for (const wallet of [alice, bob])
      expect(
        (
          await request(`/rooms/${initial.room.id}/accept`, wallet, {
            version: 1,
            termsHash: initial.room.termsHash,
          })
        ).status,
      ).toBe(200);
    const firstLeg = legFor(alice, bob, f.assets[0], "11000000");
    const newTerms = {
      ...f.terms,
      version: 2,
      legs: [firstLeg, ...f.terms.legs.slice(1)],
      minima: [
        { owner: bob, mint: firstLeg.mint, minNetRaw: firstLeg.netRaw },
        ...f.terms.minima.slice(1),
      ],
    };
    const counter = await request(`/offers/${initial.offer.id}/counter`, bob, {
      expectedVersion: 1,
      terms: newTerms,
    });
    expect(counter.status).toBe(201);
    const revised = (await counter.json()) as { room: Room };
    expect(revised.room.terms.version).toBe(2);
    expect(
      revised.room.members.every((m) => m.acceptedVersion === null && !m.ready),
    ).toBe(true);
    expect(
      (
        await request(`/rooms/${initial.room.id}/accept`, alice, {
          version: 1,
          termsHash: initial.room.termsHash,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(`/rooms/${initial.room.id}/ready`, alice, {
          version: 2,
          ready: true,
        })
      ).status,
    ).toBe(409);
    for (const wallet of [alice, bob]) {
      expect(
        (
          await request(`/rooms/${initial.room.id}/accept`, wallet, {
            version: 2,
            termsHash: revised.room.termsHash,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(`/rooms/${initial.room.id}/ready`, wallet, {
            version: 2,
            ready: true,
          })
        ).status,
      ).toBe(200);
    }
    const final = (await (
      await request(`/rooms/${initial.room.id}`, alice)
    ).json()) as { room: Room };
    expect(final.room.state).toBe("READY");
    const offers = (await (await request("/offers", alice)).json()) as {
      offers: { status: string; version: number }[];
    };
    expect(offers.offers.find((o) => o.version === 1)?.status).toBe(
      "SUPERSEDED",
    );
    expect(offers.offers.find((o) => o.version === 2)?.status).toBe("ACCEPTED");
  });
  it("rejects altered fees, unsupported mints and opposing bilateral directions before room creation", async () => {
    const { db, f, request } = await setup(),
      [alice, bob] = f.terms.owners;
    const wrongFee = {
      ...f.terms,
      legs: f.terms.legs.map((l, i) => (i ? l : { ...l, expectedFeeRaw: "0" })),
    };
    expect((await request("/offers", alice, { terms: wrongFee })).status).toBe(
      400,
    );
    const extra = legFor(bob, alice, f.assets[0], "10000");
    expect(
      (
        await request("/offers", alice, {
          terms: { ...f.terms, legs: [...f.terms.legs, extra] },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request("/listings", alice, {
          giveMint: "unknown",
          wantMint: f.assets[0].mint,
          grossRaw: "1",
          minReceiveNetRaw: "1",
          expiresAt: Date.now() + 3600_000,
        })
      ).status,
    ).toBe(400);
    expect(
      (await db.prepare("SELECT id FROM rooms").all()).results,
    ).toHaveLength(0);
  });
});

async function seededAttempt(
  t: Awaited<ReturnType<typeof setup>>,
  state: AttemptState,
  safeToRetry = false,
  stopRequested = false,
  releaseLocks = true,
) {
  let room = await createRoom(t.db, {
    terms: t.f.terms,
    termsHash: await hashTerms(t.f.terms),
  });
  await t.db
    .prepare(
      "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=?",
    )
    .bind(room.id)
    .run();
  await t.db
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(room.id)
    .run();
  room = (await getRoom(t.db, room.id))!;
  const tx = buildTransaction(t.f.plan);
  tx.partialSign(...t.f.owners);
  const wire = tx.serialize();
  const initial: Attempt = {
    id: crypto.randomUUID(),
    roomId: room.id,
    termsHash: room.termsHash,
    plan: t.f.plan,
    messageBase64: b64(tx.serializeMessage()),
    messageHash: await sha256(tx.serializeMessage()),
    wireBase64: b64(wire),
    fullWireBase64: null,
    txid: null,
    state: "SIGNING",
    signatures: {},
    createdAt: Date.now(),
    submissionStartedAt: null,
    lastCheckedAt: null,
    stopRequested: false,
    safeToRetry: false,
    receipt: null,
    error: null,
  };
  await acquireAttemptLocks(t.db, room, initial);
  const outcome: Attempt = {
    ...initial,
    state,
    safeToRetry,
    stopRequested,
    txid: transactionId(wire),
    fullWireBase64: b64(wire),
    submissionStartedAt: [
      "SUBMISSION_STARTED",
      "SUBMITTED",
      "CONFIRMED",
      "FINALIZED",
    ].includes(state)
      ? Date.now()
      : null,
  };
  await saveAttempt(t.db, outcome, "SIGNING", initial);
  if (releaseLocks && (safeToRetry || state === "FINALIZED"))
    await releaseAttemptLocks(t.db, initial.id);
  return { room: (await getRoom(t.db, room.id))!, attempt: outcome };
}
describe("explicit room renewal after authoritative reconciliation", () => {
  it("rejects renewal for timeout, cancellation, nonfinal failure and any prior success", async () => {
    const t = await setup();
    for (const [state, safeToRetry, stopped] of [
      ["SIGNING", false, true],
      ["STATUS_UNKNOWN", false, false],
      ["FAILED_ONCHAIN", false, false],
      ["CONFIRMED", false, false],
      ["FINALIZED", false, false],
    ] as const) {
      // Each room has distinct owners so retained allocation locks remain intact.
      const isolated = await setup();
      const { room, attempt } = await seededAttempt(
        isolated,
        state,
        safeToRetry,
        stopped,
      );
      const response = await isolated.request(
        `/rooms/${room.id}/renew`,
        isolated.f.terms.owners[0],
        {
          expectedVersion: 1,
          attemptId: attempt.id,
          terms: { ...room.terms, version: 2 },
        },
      );
      expect(response.status).toBe(409);
      expect((await getRoom(isolated.db, room.id))?.terms.version).toBe(1);
    }
    const room = await createRoom(t.db, {
      terms: t.f.terms,
      termsHash: await hashTerms(t.f.terms),
    });
    expect(
      (
        await t.request(`/rooms/${room.id}/renew`, t.f.terms.owners[0], {
          expectedVersion: 1,
          terms: { ...room.terms, version: 2 },
        })
      ).status,
    ).toBe(409);
  });
  it("allows a reconciled basket failure and ring expiry only with a new complete revision and fresh consent", async () => {
    for (const [ownersCount, state] of [
      [2, "FAILED_ONCHAIN"],
      [3, "EXPIRED_UNLANDED"],
    ] as const) {
      const t = await setup(ownersCount),
        { room, attempt } = await seededAttempt(t, state, true);
      const body = {
        expectedVersion: 1,
        attemptId: attempt.id,
        terms: { ...room.terms, version: 2, expiresAt: Date.now() + 7200000 },
      };
      expect(
        (await t.request(`/rooms/${room.id}/renew`, t.outsider, body)).status,
      ).toBe(404);
      const response = await t.request(
        `/rooms/${room.id}/renew`,
        t.f.terms.owners[0],
        body,
      );
      expect(response.status).toBe(201);
      const renewed = ((await response.json()) as { room: Room }).room;
      expect(renewed.terms).toEqual(body.terms);
      expect(renewed.attempt).toBeNull();
      expect(renewed.state).toBe("NEGOTIATING");
      expect(
        renewed.members.every((m) => m.acceptedVersion === null && !m.ready),
      ).toBe(true);
      expect(
        (await t.db.prepare("SELECT id FROM attempts").all()).results,
      ).toHaveLength(1);
      expect(
        (await t.request(`/rooms/${room.id}/renew`, t.f.terms.owners[0], body))
          .status,
      ).toBe(409);
      expect(
        (
          await t.request(`/rooms/${room.id}/accept`, t.f.terms.owners[0], {
            version: 1,
            termsHash: room.termsHash,
          })
        ).status,
      ).toBe(409);
    }
  });
  it("atomically releases safe locks even when explicit cleanup is skipped, then renews the room", async () => {
    const t = await setup(),
      { room, attempt } = await seededAttempt(
        t,
        "EXPIRED_UNLANDED",
        true,
        false,
        false,
      );
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(0);
    const response = await t.request(
      `/rooms/${room.id}/renew`,
      t.f.terms.owners[0],
      {
        expectedVersion: 1,
        attemptId: attempt.id,
        terms: { ...room.terms, version: 2 },
      },
    );
    expect(response.status).toBe(201);
    expect(
      (await t.db.prepare("SELECT lock_key FROM active_locks").all()).results,
    ).toHaveLength(0);
    expect(
      (await getRoom(t.db, room.id))?.members.every(
        (m) => !m.ready && m.acceptedVersion === null,
      ),
    ).toBe(true);
  });
  it("rejects stale fees rather than changing quantities or receipts and checks unchanged ring shape", async () => {
    const t = await setup(3),
      { room, attempt } = await seededAttempt(t, "EXPIRED_UNLANDED", true),
      wallet = t.f.terms.owners[0];
    const body = {
      expectedVersion: 1,
      attemptId: attempt.id,
      terms: { ...room.terms, version: 2 },
    };
    t.f.assets[0].observedEpoch = "100";
    expect(
      (await t.request(`/rooms/${room.id}/renew`, wallet, body)).status,
    ).toBe(400);
    expect((await getRoom(t.db, room.id))?.terms).toEqual(room.terms);
    const legs = room.terms.legs.map((l) =>
      legFor(
        l.fromOwner,
        l.toOwner,
        t.f.assets.find((a) => a.mint === l.mint)!,
        l.grossRaw,
      ),
    );
    const terms = {
      ...body.terms,
      legs,
      minima: legs.map((l) => ({
        owner: l.toOwner,
        mint: l.mint,
        minNetRaw: l.netRaw,
      })),
    };
    expect(
      (
        await t.request(`/rooms/${room.id}/renew`, wallet, {
          ...body,
          terms: { ...terms, mode: "BASKET" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.request(`/rooms/${room.id}/renew`, wallet, {
          ...body,
          terms: { ...terms, version: 3 },
        })
      ).status,
    ).toBe(400);
    const renewed = await t.request(`/rooms/${room.id}/renew`, wallet, {
      ...body,
      terms,
    });
    expect(renewed.status).toBe(201);
    expect(((await renewed.json()) as { room: Room }).room.terms).toEqual(
      terms,
    );
  });
});
