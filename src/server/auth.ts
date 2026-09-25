import { Hono, type MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { PublicKey } from "@solana/web3.js";
import { b64, sha256, unb64, verifyEd25519 } from "../shared/crypto";
import type { Env } from "../shared/types";

export interface AppContext {
  Bindings: Env;
  Variables: { wallet: string; sessionHash: string };
}
const COOKIE = "__Host-bb_session";
const SESSION_SECONDS = 60 * 60;
const CHALLENGE_MS = 5 * 60 * 1000;

export function walletAddress(value: unknown): string {
  if (typeof value !== "string")
    throw new HTTPException(400, { message: "Wallet address is required" });
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    throw new HTTPException(400, { message: "Invalid signing wallet address" });
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value || !PublicKey.isOnCurve(key.toBytes()))
      throw new Error();
    return value;
  } catch {
    throw new HTTPException(400, { message: "Invalid signing wallet address" });
  }
}

export const requireMutationOrigin: MiddlewareHandler<AppContext> = async (
  c,
  next,
) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
  const origin = c.req.header("Origin");
  if (
    !origin ||
    origin !== new URL(c.env.APP_ORIGIN).origin ||
    c.req.header("Sec-Fetch-Site") === "cross-site"
  )
    throw new HTTPException(403, { message: "Mutation origin is not allowed" });
  if (
    !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json")
  )
    throw new HTTPException(415, { message: "Use application/json" });
  const length = Number(c.req.header("Content-Length") ?? "0");
  if (!Number.isFinite(length) || length > 32_768)
    throw new HTTPException(413, { message: "Request is too large" });
  await next();
};

export async function jsonObject(c: {
  req: { text(): Promise<string> };
}): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.length > 32_768)
    throw new HTTPException(413, { message: "Request is too large" });
  try {
    const result: unknown = JSON.parse(text);
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new Error();
    return result as Record<string, unknown>;
  } catch {
    throw new HTTPException(400, { message: "Expected a JSON object" });
  }
}

export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<void> {
  const bucket = Math.floor(now / windowMs);
  try {
    await db
      .prepare(
        `INSERT INTO rate_limits(key,hits,limit_count,expires_at) VALUES(?,1,?,?)
      ON CONFLICT(key) DO UPDATE SET hits=hits+1`,
      )
      .bind(`${key}:${bucket}`, limit, (bucket + 1) * windowMs)
      .run();
  } catch {
    throw new HTTPException(429, {
      message: "Too many requests; try again shortly",
    });
  }
}

export async function authenticatedWallet(
  db: D1Database,
  token: string | undefined,
  env: Pick<Env, "APP_ORIGIN" | "SOLANA_CLUSTER">,
  now = Date.now(),
): Promise<{ wallet: string; tokenHash: string } | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT wallet FROM sessions WHERE token_hash=? AND expires_at>? AND revoked_at IS NULL AND origin=? AND cluster=?`,
    )
    .bind(tokenHash, now, new URL(env.APP_ORIGIN).origin, env.SOLANA_CLUSTER)
    .first<{ wallet: string }>();
  return row ? { wallet: row.wallet, tokenHash } : null;
}

export const requireAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const identity = await authenticatedWallet(
    c.env.DB,
    getCookie(c, COOKIE),
    c.env,
  );
  if (!identity)
    throw new HTTPException(401, {
      message: "Connect your wallet and authenticate first",
    });
  c.set("wallet", identity.wallet);
  c.set("sessionHash", identity.tokenHash);
  await next();
};

export function challengeMessage(
  wallet: string,
  origin: string,
  cluster: string,
  nonce: string,
  expiresAt: number,
): string {
  return `BarterBook wallet authentication\n\nOrigin: ${origin}\nWallet: ${wallet}\nNetwork: ${cluster}\nNonce: ${nonce}\nExpires: ${new Date(expiresAt).toISOString()}\n\nThis signature authenticates board activity only. It does not authorize a token transfer.`;
}

export async function consumeChallenge(
  db: D1Database,
  input: { id: string; wallet: string; signatureBase64: string },
  env: Pick<Env, "APP_ORIGIN" | "SOLANA_CLUSTER">,
  now = Date.now(),
): Promise<{ token: string; expiresAt: number }> {
  const wallet = walletAddress(input.wallet);
  const row = await db
    .prepare("SELECT * FROM auth_challenges WHERE id=?")
    .bind(input.id)
    .first<{
      id: string;
      wallet: string;
      origin: string;
      cluster: string;
      message: string;
      expires_at: number;
      consumed_at: number | null;
    }>();
  if (
    !row ||
    row.wallet !== wallet ||
    row.origin !== new URL(env.APP_ORIGIN).origin ||
    row.cluster !== env.SOLANA_CLUSTER ||
    row.expires_at <= now ||
    row.consumed_at !== null
  )
    throw new HTTPException(401, {
      message: "Challenge is invalid, expired or already used",
    });
  let signature: Uint8Array;
  try {
    signature = unb64(input.signatureBase64);
  } catch {
    throw new HTTPException(401, { message: "Invalid wallet signature" });
  }
  if (
    !(await verifyEd25519(
      wallet,
      signature,
      new TextEncoder().encode(row.message),
    ))
  )
    throw new HTTPException(401, { message: "Invalid wallet signature" });
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const tokenHash = await sha256(token);
  const expiresAt = now + SESSION_SECONDS * 1000;
  try {
    // The insert trigger checks and consumes the nonce in the same SQLite transaction.
    await db
      .prepare(
        `INSERT INTO sessions(token_hash,challenge_id,wallet,origin,cluster,expires_at,created_at)
      VALUES(?,?,?,?,?,?,?)`,
      )
      .bind(tokenHash, row.id, wallet, row.origin, row.cluster, expiresAt, now)
      .run();
  } catch {
    throw new HTTPException(401, {
      message: "Challenge is invalid, expired or already used",
    });
  }
  return { token, expiresAt };
}

export function createAuthRouter(): Hono<AppContext> {
  const app = new Hono<AppContext>();
  app.use("*", requireMutationOrigin);
  app.post("/challenge", async (c) => {
    const body = await jsonObject(c);
    const wallet = walletAddress(body.wallet);
    const now = Date.now();
    const origin = new URL(c.env.APP_ORIGIN).origin;
    const ipHash = await sha256(c.req.header("CF-Connecting-IP") ?? "local");
    await checkRateLimit(c.env.DB, `challenge-ip:${ipHash}`, 30, 60_000, now);
    await checkRateLimit(
      c.env.DB,
      `challenge-wallet:${wallet}`,
      10,
      60_000,
      now,
    );
    const id = crypto.randomUUID();
    const expiresAt = now + CHALLENGE_MS;
    const message = challengeMessage(
      wallet,
      origin,
      c.env.SOLANA_CLUSTER,
      id,
      expiresAt,
    );
    await c.env.DB.prepare(
      "INSERT INTO auth_challenges(id,wallet,origin,cluster,message,expires_at,created_at) VALUES(?,?,?,?,?,?,?)",
    )
      .bind(id, wallet, origin, c.env.SOLANA_CLUSTER, message, expiresAt, now)
      .run();
    return c.json({
      id,
      message,
      expiresAt,
      origin,
      cluster: c.env.SOLANA_CLUSTER,
      wallet,
    });
  });
  app.post("/verify", async (c) => {
    const body = await jsonObject(c);
    if (typeof body.id !== "string" || typeof body.signatureBase64 !== "string")
      throw new HTTPException(400, {
        message: "Challenge ID and signature are required",
      });
    const wallet = walletAddress(body.wallet);
    await checkRateLimit(
      c.env.DB,
      `verify:${await sha256(c.req.header("CF-Connecting-IP") ?? "local")}`,
      40,
      60_000,
    );
    const { token, expiresAt } = await consumeChallenge(
      c.env.DB,
      { id: body.id, wallet, signatureBase64: body.signatureBase64 },
      c.env,
    );
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      path: "/",
      maxAge: SESSION_SECONDS,
    });
    c.header("Cache-Control", "no-store");
    return c.json({ wallet, expiresAt });
  });
  app.get("/me", async (c) => {
    const identity = await authenticatedWallet(
      c.env.DB,
      getCookie(c, COOKIE),
      c.env,
    );
    c.header("Cache-Control", "no-store");
    return c.json({ wallet: identity?.wallet ?? null });
  });
  app.post("/logout", requireAuth, async (c) => {
    await c.env.DB.prepare(
      "UPDATE sessions SET revoked_at=? WHERE token_hash=?",
    )
      .bind(Date.now(), c.get("sessionHash"))
      .run();
    deleteCookie(c, COOKIE, {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Strict",
    });
    return c.json({ ok: true });
  });
  return app;
}
