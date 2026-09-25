/** Uses the normal authenticated HTTP API. SDK authentication is not browser signing evidence. */
import { Keypair } from "@solana/web3.js";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { legFor, validateTerms } from "../src/shared/transactions";
import type { Asset, Listing, Room, Terms } from "../src/shared/types";
import {
  args,
  fixtureKey,
  immutableJson,
  openRun,
  publicEvidence,
  readJson,
  safeName,
  type Run,
} from "./devnet-common";

export type Http = typeof fetch;
export type ApiSession = <T>(
  path: string,
  body?: unknown,
  key?: string,
) => Promise<T>;
export async function authenticateSdkWallet(
  base: string,
  wallet: Keypair,
  transport: Http = fetch,
): Promise<ApiSession> {
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Use an HTTPS application origin or a local development origin, with no credentials or path",
    );
  let cookie = "";
  const request = async <T>(
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<T> => {
    const response = await transport(`${url.origin}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json", Origin: url.origin }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(
        `API ${path} returned ${response.status}: ${result.error ?? "request failed"}`,
      );
    const setCookie = response.headers.get("set-cookie");
    if (path === "/auth/verify") {
      if (
        !setCookie?.startsWith("__Host-bb_session=") ||
        !/;\s*HttpOnly/i.test(setCookie) ||
        !/;\s*Secure/i.test(setCookie) ||
        !/;\s*SameSite=Strict/i.test(setCookie)
      )
        throw new Error("Expected a secure, HttpOnly authentication cookie");
      cookie = setCookie.split(";")[0];
    }
    return result as T;
  };
  const health = await request<{ cluster: string }>("/health");
  if (health.cluster !== "devnet")
    throw new Error("REFUSED: application API is not devnet");
  const address = wallet.publicKey.toBase58();
  const challenge = await request<{
    id: string;
    wallet: string;
    origin: string;
    cluster: string;
    expiresAt: number;
    message: string;
  }>("/auth/challenge", { wallet: address });
  const expected = `BarterBook wallet authentication\n\nOrigin: ${url.origin}\nWallet: ${address}\nNetwork: devnet\nNonce: ${challenge.id}\nExpires: ${new Date(challenge.expiresAt).toISOString()}\n\nThis signature authenticates board activity only. It does not authorize a token transfer.`;
  if (
    challenge.wallet !== address ||
    challenge.origin !== url.origin ||
    challenge.cluster !== "devnet" ||
    challenge.expiresAt <= Date.now() ||
    challenge.expiresAt > Date.now() + 300_000 ||
    challenge.message !== expected
  )
    throw new Error(
      "Authentication challenge scope or exact message is invalid",
    );
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(wallet.secretKey.slice(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
  const signatureBase64 = Buffer.from(
    sign(null, Buffer.from(expected), key),
  ).toString("base64");
  await request("/auth/verify", {
    id: challenge.id,
    wallet: address,
    signatureBase64,
  });
  const current = await request<{ wallet: string }>("/auth/me");
  if (current.wallet !== address)
    throw new Error("Authenticated wallet differs from the disposable signer");
  return request;
}
export type SeedPlan = {
  schemaVersion: 1;
  buildId: string;
  runId: string;
  batch: string;
  origin: string;
  wallets: string[];
  createdAt: number;
  listings: Array<{
    owner: string;
    idempotencyKey: string;
    body: {
      giveMint: string;
      wantMint: string;
      grossRaw: string;
      minReceiveNetRaw: string;
      expiresAt: number;
    };
  }>;
  offer: { owner: string; idempotencyKey: string; body: { terms: Terms } };
};
export function createSeedPlan(
  run: Run,
  batch: string,
  origin: string,
  assets: Asset[],
  now = Date.now(),
): SeedPlan {
  safeName(batch);
  const path = join(run.privateRoot, "board", `${batch}-intent.json`);
  if (existsSync(path)) {
    const previous = readJson<SeedPlan>(path);
    if (
      previous.origin !== origin ||
      previous.runId !== run.runId ||
      previous.batch !== batch ||
      previous.listings.some(
        (l) => !assets.some((a) => a.mint === l.body.giveMint),
      )
    )
      throw new Error("Seed batch identity differs from its original intent");
    return previous;
  }
  if (
    assets.length !== 3 ||
    assets.some((a) => a.cluster !== "devnet" || !a.mock || !a.tested)
  )
    throw new Error("Require three separately tested mock devnet mints");
  const wallets = [0, 1, 2].map((i) =>
    fixtureKey(run, `wallet-${i}`).publicKey.toBase58(),
  );
  const id = (name: string) =>
    `seed-${createHash("sha256").update(`${run.runId}:${batch}:${origin}:${name}`).digest("hex").slice(0, 40)}`;
  const lots = [
    legFor(wallets[0], wallets[2], assets[0], "10000000"),
    legFor(wallets[1], wallets[0], assets[1], "20000000"),
    legFor(wallets[2], wallets[1], assets[2], "15000000"),
  ];
  const expiresAt = now + 24 * 60 * 60_000;
  const legs = [
    legFor(wallets[0], wallets[1], assets[0], "10000000"),
    legFor(wallets[0], wallets[1], assets[1], "5000000"),
    legFor(wallets[1], wallets[0], assets[2], "20000000"),
  ];
  const terms: Terms = {
    cluster: "devnet",
    version: 1,
    mode: "BASKET",
    owners: wallets.slice(0, 2),
    feePayer: wallets[0],
    maxNetworkFeeLamports: "50000",
    maxAccountRentLamports: "20000000",
    expiresAt,
    legs,
    minima: legs.map((l) => ({
      owner: l.toOwner,
      mint: l.mint,
      minNetRaw: l.netRaw,
    })),
  };
  validateTerms(terms, assets);
  const plan: SeedPlan = {
    schemaVersion: 1,
    buildId: run.buildId,
    runId: run.runId,
    batch,
    origin,
    wallets,
    createdAt: now,
    listings: lots.map((lot, i) => ({
      owner: wallets[i],
      idempotencyKey: id(`listing-${i}`),
      body: {
        giveMint: lot.mint,
        wantMint: lots[(i + 1) % 3].mint,
        grossRaw: lot.grossRaw,
        minReceiveNetRaw: lots[(i + 1) % 3].netRaw,
        expiresAt,
      },
    })),
    offer: {
      owner: wallets[0],
      idempotencyKey: id("basket-offer"),
      body: { terms },
    },
  };
  immutableJson(path, plan, true);
  return plan;
}
export async function executeSeedPlan(
  plan: SeedPlan,
  sessions: Map<string, ApiSession>,
): Promise<{ listings: Listing[]; room: Room }> {
  // Exact original body and key survive a timeout; never generate another key automatically.
  const listings: Listing[] = [];
  for (const intent of plan.listings) {
    const session = sessions.get(intent.owner);
    if (!session)
      throw new Error("Missing authenticated disposable participant");
    listings.push(
      (
        await session<{ listing: Listing }>(
          "/listings",
          intent.body,
          intent.idempotencyKey,
        )
      ).listing,
    );
  }
  const result = await sessions.get(plan.offer.owner)!<{ room: Room }>(
    "/offers",
    plan.offer.body,
    plan.offer.idempotencyKey,
  );
  return { listings, room: result.room };
}
export async function main(): Promise<void> {
  const options = args();
  const run = openRun(options);
  const origin = new URL(options.get("--url") ?? "http://localhost:5173")
    .origin;
  const assets = readJson<Asset[]>(join(run.evidenceRoot, "assets.json"));
  const plan = createSeedPlan(
    run,
    safeName(options.get("--batch") ?? "judge-1"),
    origin,
    assets,
  );
  if (!run.execute) {
    console.log(
      `Saved seed preview for ${plan.batch}: 3 exact-lot cycle listings and one two-for-one offer. Re-run with --execute to authenticate through the normal API. No settlement acceptance or signature is automatic.`,
    );
    return;
  }
  const sessions = new Map<string, ApiSession>();
  for (let i = 0; i < 3; i++) {
    const wallet = fixtureKey(run, `wallet-${i}`);
    sessions.set(
      wallet.publicKey.toBase58(),
      await authenticateSdkWallet(origin, wallet),
    );
  }
  const current = await sessions.values().next().value!<{ assets: Asset[] }>(
    "/assets/fresh",
  );
  if (
    current.assets.length !== 3 ||
    assets.some(
      (a) =>
        !current.assets.some(
          (b) =>
            b.mint === a.mint && b.mock && b.tested && b.cluster === "devnet",
        ),
    )
  )
    throw new Error(
      "The application's registry does not match this run's three tested mock mints",
    );
  validateTerms(plan.offer.body.terms, current.assets);
  const result = await executeSeedPlan(plan, sessions);
  publicEvidence(run, `board-${plan.batch}.json`, {
    schemaVersion: 1,
    runId: run.runId,
    buildId: plan.buildId,
    cluster: "devnet",
    origin,
    scope:
      "Developer board demo authenticated by disposable SDK keys through the HTTP API; NOT browser-wallet proof; no automatic settlement approvals",
    batch: plan.batch,
    listingIds: result.listings.map((l) => l.id),
    roomId: result.room.id,
    idempotencyKeys: [
      ...plan.listings.map((l) => l.idempotencyKey),
      plan.offer.idempotencyKey,
    ],
  });
  console.log(
    `Seeded/resumed ${result.listings.length} listings and basket room ${result.room.id} through the authenticated API. Participants must review, accept, ready and sign in their own wallets.`,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main().catch((error) => {
    console.error(
      error instanceof Error
        ? error.message.replace(/https?:\/\/\S+/g, "[endpoint]")
        : "Board seeding failed",
    );
    process.exitCode = 1;
  });
