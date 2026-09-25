import { afterEach, expect, it, vi } from "vitest";
import { Keypair, Transaction, SystemProgram } from "@solana/web3.js";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { b64, unb64 } from "../src/shared/crypto";
import { testDatabase } from "./db-fixture";
import type { Env } from "../src/shared/types";
import type { AppContext } from "../src/server/auth";
import { createDemoFaucetRouter } from "../src/server/demo-faucet";
import {
  buildFaucetTransaction,
  DEMO_MINTS,
  FAUCET_AUTHORITY,
} from "../src/shared/demo-faucet";
vi.mock("../src/shared/demo-faucet", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/shared/demo-faucet")>();
  const { Keypair } = await import("@solana/web3.js");
  const authority = Keypair.fromSeed(
    new Uint8Array(32).fill(119),
  ).publicKey.toBase58();
  return {
    ...actual,
    FAUCET_AUTHORITY: authority,
    buildFaucetTransaction: (p: any) =>
      actual.buildFaucetTransaction(p, authority),
    verifyFaucetWire: (w: any, p: any, s: any) =>
      actual.verifyFaucetWire(w, p, s, authority),
  };
});
vi.mock("../src/server/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/auth")>();
  return {
    ...actual,
    requireAuth: async (c: any, next: any) => {
      const wallet = c.req.header("X-Test-Wallet");
      if (!wallet) throw new HTTPException(401);
      c.set("wallet", wallet);
      await next();
    },
  };
});
const dbs: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  dbs.splice(0).forEach((db) => db.close());
});
function setup() {
  const db = testDatabase();
  dbs.push(db);
  const wallet = Keypair.generate(),
    authority = Keypair.fromSeed(new Uint8Array(32).fill(119));
  const env = {
    DB: db,
    APP_ORIGIN: "https://test.example",
    SOLANA_CLUSTER: "devnet",
    SETTLEMENT_ENABLED: "true",
    SOLANA_RPC_URL: "https://rpc.test",
    DEMO_FAUCET_MINT_SECRET: b64(authority.secretKey),
    DEVNET_ASSETS_JSON: JSON.stringify(
      DEMO_MINTS.map((mint) => ({
        mint,
        cluster: "devnet",
        mock: true,
        tested: true,
        tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      })),
    ),
  } as unknown as Env;
  const state = {
    timeout: false,
    sends: 0,
    stored: false,
    finalized: false,
    wire: "",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const { method, params } = JSON.parse(init.body);
      let result: any;
      switch (method) {
        case "getGenesisHash":
          result = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
          break;
        case "getBalance":
          result = { value: 50000000 };
          break;
        case "getLatestBlockhash":
          result = {
            value: {
              blockhash: Keypair.generate().publicKey.toBase58(),
              lastValidBlockHeight: 250,
            },
          };
          break;
        case "getMinimumBalanceForRentExemption":
          result = 2129280;
          break;
        case "getFeeForMessage":
          result = { value: 10000 };
          break;
        case "sendTransaction":
          state.sends++;
          state.wire = params[0];
          state.stored = !!(await db
            .prepare(
              "SELECT txid FROM demo_faucet_claims WHERE signed_wire_base64=?",
            )
            .bind(params[0])
            .first());
          if (state.timeout) throw new Error("timeout");
          result = "submitted";
          break;
        case "getSignatureStatuses":
          result = {
            value: [
              state.finalized
                ? { confirmationStatus: "finalized", err: null }
                : null,
            ],
          };
          break;
        case "getTransaction":
          result = { transaction: [state.wire, "base64"], meta: { err: null } };
          break;
        case "getBlockHeight":
          result = 1;
          break;
        default:
          throw new Error(method);
      }
      return Response.json({ result });
    }),
  );
  const app = new Hono<AppContext>()
    .route("/", createDemoFaucetRouter())
    .onError((e, c) =>
      c.json({ error: e.message }, e instanceof HTTPException ? e.status : 400),
    );
  const request = (
    path: string,
    body?: any,
    overrides: Record<string, string> = {},
  ) =>
    app.request(
      `https://test.example/demo/faucet/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Origin: env.APP_ORIGIN,
          "Content-Type": "application/json",
          "X-Test-Wallet": wallet.publicKey.toBase58(),
          ...overrides,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
    );
  return { wallet, authority, request, env, db, state };
}
it("requires authentication, same origin and Devnet", async () => {
  const f = setup();
  expect((await f.request("prepare", {}, { "X-Test-Wallet": "" })).status).toBe(
    401,
  );
  expect(
    (await f.request("prepare", {}, { Origin: "https://evil.example" })).status,
  ).toBe(403);
  f.env.SOLANA_CLUSTER = "mainnet-beta" as any;
  expect((await f.request("prepare", {})).status).toBe(503);
  expect(f.state.sends).toBe(0);
});
it("binds exact mint instructions and preserves bytes before a timeout, then reconciles", async () => {
  const f = setup();
  const r = await f.request("prepare", {});
  expect(r.status, await r.clone().text()).toBe(200);
  const { claim } = (await r.json()) as any;
  expect(claim.plan.wallet).toBe(f.wallet.publicKey.toBase58());
  const tx = Transaction.from(unb64(claim.wireBase64));
  expect(tx.instructions).toHaveLength(6);
  expect(
    tx.signatures.some(
      (s) => s.publicKey.toBase58() === FAUCET_AUTHORITY && s.signature,
    ),
  ).toBe(true);
  tx.partialSign(f.wallet);
  const wireBase64 = b64(tx.serialize());
  f.state.timeout = true;
  expect((await f.request(`${claim.id}/submit`, { wireBase64 })).status).toBe(
    400,
  );
  expect(f.state.stored).toBe(true);
  f.state.finalized = true;
  const check = await f.request(claim.id);
  expect(((await check.json()) as any).claim.state).toBe("FINALIZED");
  expect(f.state.sends).toBe(1);
  await f.request(`${claim.id}/submit`, {});
  expect(f.state.sends).toBe(1);
});
it("rejects changed instructions even when both signatures are valid", async () => {
  const f = setup();
  const { claim } = (await (await f.request("prepare", {})).json()) as any;
  const tx = buildFaucetTransaction(claim.plan);
  tx.add(
    SystemProgram.transfer({
      fromPubkey: f.wallet.publicKey,
      toPubkey: f.authority.publicKey,
      lamports: 1,
    }),
  );
  tx.sign(f.wallet, f.authority);
  const r = await f.request(`${claim.id}/submit`, {
    wireBase64: b64(tx.serialize()),
  });
  expect(r.status).toBe(400);
  expect(f.state.sends).toBe(0);
});
it("prevents a different wallet submitting or reading a claim", async () => {
  const f = setup();
  const { claim } = (await (await f.request("prepare", {})).json()) as any;
  const headers = { "X-Test-Wallet": Keypair.generate().publicKey.toBase58() };
  expect((await f.request(claim.id, undefined, headers)).status).toBe(404);
  expect((await f.request(`${claim.id}/submit`, {}, headers)).status).toBe(404);
});
it("caps preparations before signing or broadcasting", async () => {
  const f = setup();
  await f.db
    .prepare(
      "INSERT INTO rate_limits(key,hits,limit_count,expires_at) VALUES(?,?,?,?)",
    )
    .bind(
      `faucet-wallet:${f.wallet.publicKey.toBase58()}:${Math.floor(Date.now() / 86400000)}`,
      8,
      8,
      Date.now() + 86400000,
    )
    .run();
  expect((await f.request("prepare", {})).status).toBe(429);
  expect(f.state.sends).toBe(0);
});
it("the database refuses replacing executable request bytes", async () => {
  const f = setup();
  const { claim } = (await (await f.request("prepare", {})).json()) as any;
  const tx = Transaction.from(unb64(claim.wireBase64));
  tx.partialSign(f.wallet);
  await f.request(`${claim.id}/submit`, { wireBase64: b64(tx.serialize()) });
  await expect(
    f.db
      .prepare(
        "UPDATE demo_faucet_claims SET signed_wire_base64='changed' WHERE id=?",
      )
      .bind(claim.id)
      .run(),
  ).rejects.toThrow("Immutable");
});
