import { afterEach, describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { b64, sha256 } from "../src/shared/crypto";
import {
  authenticatedWallet,
  challengeMessage,
  checkRateLimit,
  consumeChallenge,
  createAuthRouter,
} from "../src/server/auth";
import type { Env } from "../src/shared/types";
import { testDatabase } from "./db-fixture";

const databases: ReturnType<typeof testDatabase>[] = [];
const config = {
  APP_ORIGIN: "https://barterbook.test",
  SOLANA_CLUSTER: "devnet" as const,
};
function db() {
  const d = testDatabase();
  databases.push(d);
  return d;
}
afterEach(() => {
  for (const d of databases.splice(0)) d.close();
});
async function signer() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const wallet = new PublicKey(
    new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  ).toBase58();
  return {
    wallet,
    sign: async (message: string) =>
      b64(
        new Uint8Array(
          await crypto.subtle.sign(
            "Ed25519",
            pair.privateKey,
            new TextEncoder().encode(message),
          ),
        ),
      ),
  };
}
async function challenge(
  database: D1Database,
  wallet: string,
  now = Date.now(),
) {
  const id = crypto.randomUUID(),
    expiresAt = now + 300_000;
  const message = challengeMessage(
    wallet,
    config.APP_ORIGIN,
    config.SOLANA_CLUSTER,
    id,
    expiresAt,
  );
  await database
    .prepare(
      "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      wallet,
      config.APP_ORIGIN,
      config.SOLANA_CLUSTER,
      message,
      expiresAt,
      now,
    )
    .run();
  return { id, message, expiresAt };
}
describe("wallet authentication boundary", () => {
  it("consumes a cryptographically verified challenge once even when requests race", async () => {
    const database = db(),
      wallet = await signer(),
      proof = await challenge(database, wallet.wallet);
    const input = {
      id: proof.id,
      wallet: wallet.wallet,
      signatureBase64: await wallet.sign(proof.message),
    };
    const results = await Promise.allSettled([
      consumeChallenge(database, input, config),
      consumeChallenge(database, input, config),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const result = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ token: string; expiresAt: number }>;
    const row = await database
      .prepare("SELECT token_hash FROM sessions")
      .first<{ token_hash: string }>();
    expect(row?.token_hash).toBe(await sha256(result.value.token));
    expect(row?.token_hash).not.toBe(result.value.token);
    expect(
      await authenticatedWallet(database, result.value.token, config),
    ).toMatchObject({ wallet: wallet.wallet });
    expect(
      await authenticatedWallet(database, result.value.token, {
        ...config,
        SOLANA_CLUSTER: "mainnet-beta",
      }),
    ).toBeNull();
  });
  it("rejects signatures by another wallet and keeps the challenge unconsumed", async () => {
    const database = db(),
      owner = await signer(),
      impostor = await signer(),
      proof = await challenge(database, owner.wallet);
    await expect(
      consumeChallenge(
        database,
        {
          id: proof.id,
          wallet: owner.wallet,
          signatureBase64: await impostor.sign(proof.message),
        },
        config,
      ),
    ).rejects.toThrow("Invalid wallet signature");
    const row = await database
      .prepare("SELECT consumed_at FROM auth_challenges WHERE id=?")
      .bind(proof.id)
      .first<{ consumed_at: number | null }>();
    expect(row?.consumed_at).toBeNull();
  });
  it("binds a signature to exact message, origin, cluster and expiry", async () => {
    const database = db(),
      owner = await signer(),
      proof = await challenge(database, owner.wallet);
    const input = {
      id: proof.id,
      wallet: owner.wallet,
      signatureBase64: await owner.sign(proof.message),
    };
    await expect(
      consumeChallenge(database, input, {
        ...config,
        APP_ORIGIN: "https://evil.test",
      }),
    ).rejects.toThrow();
    await expect(
      consumeChallenge(database, input, {
        ...config,
        SOLANA_CLUSTER: "mainnet-beta",
      }),
    ).rejects.toThrow();
    await expect(
      consumeChallenge(database, input, config, proof.expiresAt),
    ).rejects.toThrow();
    await expect(
      consumeChallenge(
        database,
        { ...input, signatureBase64: await owner.sign(proof.message + " ") },
        config,
      ),
    ).rejects.toThrow("Invalid wallet signature");
    const session = await consumeChallenge(database, input, config);
    expect(
      await authenticatedWallet(
        database,
        session.token,
        config,
        session.expiresAt,
      ),
    ).toBeNull();
  });
  it("rejects cross-origin mutations and issues secure HttpOnly cookies", async () => {
    const database = db(),
      owner = await signer();
    const app = createAuthRouter(),
      env = { ...config, DB: database } as unknown as Env;
    const post = (path: string, body: unknown, origin = config.APP_ORIGIN) =>
      app.request(
        path,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: origin },
          body: JSON.stringify(body),
        },
        env,
      );
    expect(
      (await post("/challenge", { wallet: owner.wallet }, "https://evil.test"))
        .status,
    ).toBe(403);
    const challengeResponse = await post("/challenge", {
      wallet: owner.wallet,
    });
    const proof = (await challengeResponse.json()) as {
      id: string;
      message: string;
    };
    const verified = await post("/verify", {
      id: proof.id,
      wallet: owner.wallet,
      signatureBase64: await owner.sign(proof.message),
    });
    expect(verified.status).toBe(200);
    expect(verified.headers.get("Set-Cookie")).toMatch(/HttpOnly/);
    expect(verified.headers.get("Set-Cookie")).toMatch(/Secure/);
    expect(verified.headers.get("Set-Cookie")).toMatch(/SameSite=Strict/);
    expect(
      (
        await post("/verify", {
          id: proof.id,
          wallet: owner.wallet,
          signatureBase64: await owner.sign(proof.message),
        })
      ).status,
    ).toBe(401);
  });
  it("enforces rate limits under concurrent increments in the database", async () => {
    const database = db();
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        checkRateLimit(database, "test", 3, 60_000, 123_000),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(3);
  });
});
