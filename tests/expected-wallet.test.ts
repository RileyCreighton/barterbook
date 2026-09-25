import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createAuthRouter, type AppContext } from "../src/server/auth";
import { createBoardRouter } from "../src/server/board";
import { createSettlementRouter } from "../src/server/settlement";
import {
  acquireAttemptLocks,
  createRoom,
  getAttempt,
  getRoom,
} from "../src/server/db";
import { b64, sha256 } from "../src/shared/crypto";
import {
  buildTransaction,
  hashTerms,
  validateTerms,
} from "../src/shared/transactions";
import type { Attempt, Env } from "../src/shared/types";
import { fixture } from "./fixtures";
import { testDatabase } from "./db-fixture";
import {
  api,
  onWalletIdentityMismatch,
  setExpectedWallet,
} from "../src/client/api";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  setExpectedWallet(null);
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) db.close();
});

async function setup() {
  const db = testDatabase();
  databases.push(db);
  const f = fixture(),
    [alice, bob] = f.terms.owners;
  const origin = "https://barterbook.test";
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const now = Date.now(),
    challengeId = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(challengeId, bob, origin, "devnet", "test session", now + 60_000, now)
    .run();
  const tokenHash = await sha256(token);
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,challenge_id,wallet,origin,cluster,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(tokenHash, challengeId, bob, origin, "devnet", now + 3600_000, now)
    .run();
  const room = await createRoom(db, {
    terms: f.terms,
    termsHash: await hashTerms(f.terms),
  });
  const signingRoom = await createRoom(db, {
    terms: f.terms,
    termsHash: await hashTerms(f.terms),
  });
  await db
    .prepare(
      "UPDATE room_members SET accepted_version=1,ready=1 WHERE room_id=?",
    )
    .bind(signingRoom.id)
    .run();
  await db
    .prepare("UPDATE rooms SET state='READY' WHERE id=?")
    .bind(signingRoom.id)
    .run();
  const tx = buildTransaction(f.plan);
  tx.partialSign(f.owners[0]);
  const attempt: Attempt = {
    id: crypto.randomUUID(),
    roomId: signingRoom.id,
    termsHash: signingRoom.termsHash,
    plan: f.plan,
    messageBase64: b64(tx.serializeMessage()),
    messageHash: await sha256(tx.serializeMessage()),
    wireBase64: b64(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ),
    fullWireBase64: null,
    txid: null,
    state: "SIGNING",
    signatures: {
      [alice]: b64(
        tx.signatures.find((s) => s.publicKey.toBase58() === alice)!.signature!,
      ),
    },
    createdAt: now,
    submissionStartedAt: null,
    lastCheckedAt: null,
    stopRequested: false,
    safeToRetry: false,
    receipt: null,
    error: null,
  };
  await acquireAttemptLocks(db, (await getRoom(db, signingRoom.id))!, attempt);
  const app = new Hono<AppContext>();
  app.route("/auth", createAuthRouter());
  app.route(
    "/",
    createBoardRouter({
      getAssets: async () => f.assets,
      getHoldings: async () => [],
      validateTerms,
    }),
  );
  app.route("/", createSettlementRouter());
  const env = {
    DB: db,
    APP_ORIGIN: origin,
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
  } as unknown as Env;
  const request = (path: string, body?: unknown, expectedWallet?: string) =>
    app.request(
      path,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          Cookie: `__Host-bb_session=${token}`,
          ...(expectedWallet === undefined
            ? {}
            : { "X-BarterBook-Expected-Wallet": expectedWallet }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  return { db, alice, bob, room, attempt, tokenHash, request };
}

describe("displayed wallet and durable cookie identity boundary", () => {
  it.each(["accept", "ready", "signatures", "stop", "logout", "private-read"])(
    "rejects stale Alice identity for %s without modifying Bob or signed attempts",
    async (operation) => {
      const t = await setup();
      const before = await getAttempt(t.db, t.attempt.id);
      const roomBefore = await getRoom(t.db, t.room.id);
      const paths: Record<string, [string, unknown?]> = {
        accept: [
          `/rooms/${t.room.id}/accept`,
          { version: 1, termsHash: t.room.termsHash },
        ],
        ready: [`/rooms/${t.room.id}/ready`, { version: 1, ready: true }],
        signatures: [
          `/attempts/${t.attempt.id}/signatures`,
          { wireBase64: t.attempt.wireBase64 },
        ],
        stop: [`/attempts/${t.attempt.id}/stop`, {}],
        logout: ["/auth/logout", {}],
        "private-read": [`/rooms/${t.room.id}`],
      };
      const [path, body] = paths[operation];
      const response = await t.request(path, body, t.alice);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "WALLET_IDENTITY_MISMATCH",
      });
      expect(response.headers.get("Set-Cookie")).toBeNull();
      expect(await getAttempt(t.db, t.attempt.id)).toEqual(before);
      expect(await getRoom(t.db, t.room.id)).toEqual(roomBefore);
      const session = await t.db
        .prepare("SELECT revoked_at FROM sessions WHERE token_hash=?")
        .bind(t.tokenHash)
        .first<{ revoked_at: number | null }>();
      expect(session?.revoked_at).toBeNull();
      expect(
        (await t.request(`/rooms/${t.room.id}`, undefined, t.bob)).status,
      ).toBe(200);
    },
  );

  it.each([true, false])(
    "allows a matching browser identity or absent SDK header (header=%s)",
    async (withHeader) => {
      const t = await setup();
      expect(
        (
          await t.request(
            `/rooms/${t.room.id}/accept`,
            { version: 1, termsHash: t.room.termsHash },
            withHeader ? t.bob : undefined,
          )
        ).status,
      ).toBe(200);
      expect(
        (await getRoom(t.db, t.room.id))?.members.find(
          (m) => m.wallet === t.bob,
        )?.acceptedVersion,
      ).toBe(1);
      expect(
        (await t.request("/auth/logout", {}, withHeader ? t.bob : undefined))
          .status,
      ).toBe(200);
      expect(
        (await t.request(`/rooms/${t.room.id}`, undefined, t.bob)).status,
      ).toBe(401);
    },
  );
});

describe("browser expected-wallet request lifecycle", () => {
  const mismatch = () =>
    new Response(
      JSON.stringify({
        code: "WALLET_IDENTITY_MISMATCH",
        error: "Wallet session changed",
      }),
      { status: 409 },
    );

  it("keeps anonymous walkthrough and authentication requests available without an identity", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(
        new Headers(init?.headers).has("X-BarterBook-Expected-Wallet"),
      ).toBe(false);
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    await api("/assets");
    await api("/history?cursor=example");
    await api("/auth/me");
    await api("/auth/challenge", { wallet: "Alice" });
    await api("/auth/verify", { wallet: "Alice" });
    await expect(api("/assets/fresh")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("includes the displayed wallet on private reads and mutations", async () => {
    setExpectedWallet("Alice");
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(
        new Headers(init?.headers).get("X-BarterBook-Expected-Wallet"),
      ).toBe("Alice");
      return new Response("{}");
    });
    vi.stubGlobal("fetch", fetchMock);
    await api("/rooms");
    await api("/rooms/room/ready", { ready: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates once on mismatch and prevents later unguarded private calls", async () => {
    setExpectedWallet("Alice");
    const notify = vi.fn(),
      unwatch = onWalletIdentityMismatch(notify);
    const fetchMock = vi.fn(async () => mismatch());
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(api("/rooms/room/accept", {})).rejects.toMatchObject({
        status: 409,
      });
      expect(notify).toHaveBeenCalledTimes(1);
      await expect(api("/auth/logout", {})).rejects.toMatchObject({
        status: 401,
      });
      await expect(api("/rooms")).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      unwatch();
    }
  });

  it("retains the prior logout identity after local invalidation", async () => {
    setExpectedWallet("Alice");
    setExpectedWallet(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        expect(
          new Headers(init?.headers).get("X-BarterBook-Expected-Wallet"),
        ).toBe("Alice");
        return mismatch();
      }),
    );
    await expect(
      api("/auth/logout", {}, undefined, { expectedWallet: "Alice" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it.each([true, false])(
    "does not let a late old response clear a new identity (mismatch=%s)",
    async (fails) => {
      setExpectedWallet("Alice");
      const notify = vi.fn(),
        unwatch = onWalletIdentityMismatch(notify);
      let finish!: (response: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              finish = resolve;
            }),
        ),
      );
      try {
        const pending = api("/rooms");
        setExpectedWallet("Bob");
        finish(fails ? mismatch() : new Response('{"rooms":[]}'));
        await expect(pending).rejects.toMatchObject({ status: 409 });
        expect(notify).not.toHaveBeenCalled();
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_input: unknown, init?: RequestInit) => {
            expect(
              new Headers(init?.headers).get("X-BarterBook-Expected-Wallet"),
            ).toBe("Bob");
            return new Response("{}");
          }),
        );
        await api("/rooms");
      } finally {
        unwatch();
      }
    },
  );
});
