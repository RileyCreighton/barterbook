import { Keypair } from "@solana/web3.js";
import { createPrivateKey, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
const base = "http://localhost:8787",
  origin = "http://localhost:5173";
const wallet = Keypair.generate();
const results: Record<string, unknown> = {
  scope:
    "Actual local workerd + migrated D1 HTTP smoke. Ephemeral SDK identity; no browser wallet or chain execution.",
  at: new Date().toISOString(),
};
const request = async (path: string, body?: unknown, cookie?: string) => {
  const response = await fetch(base + "/api" + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json", origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, data: (await response.json()) as any };
};
for (const path of ["/health", "/assets", "/listings", "/matches"]) {
  const { response, data } = await request(path);
  if (response.status !== 200)
    throw new Error(`${path} failed: ${JSON.stringify(data)}`);
  results[path] = data;
}
const challenge = await request("/auth/challenge", {
  wallet: wallet.publicKey.toBase58(),
});
if (challenge.response.status !== 200)
  throw new Error(
    "Challenge unavailable " +
      challenge.response.status +
      " " +
      JSON.stringify(challenge.data),
  );
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(wallet.secretKey.slice(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
const input = {
  id: challenge.data.id,
  wallet: wallet.publicKey.toBase58(),
  signatureBase64: Buffer.from(
    sign(null, Buffer.from(challenge.data.message), key),
  ).toString("base64"),
};
const verified = await request("/auth/verify", input);
if (verified.response.status !== 200)
  throw new Error("Native Worker Ed25519 auth failed");
const cookie = verified.response.headers.get("set-cookie")!.split(";")[0];
const me = await request("/auth/me", undefined, cookie);
if (me.data.wallet !== input.wallet)
  throw new Error("Durable auth session failed");
const replay = await request("/auth/verify", input);
if (replay.response.status !== 401) throw new Error("Auth replay accepted");
results.auth = {
  verified: true,
  sessionPersisted: true,
  replayRejected: true,
  cookieFlags: verified.response.headers
    .get("set-cookie")!
    .slice(cookie.length),
};
const forbidden = await request("/rooms/another-wallet", undefined, cookie);
if (forbidden.response.status !== 404) throw new Error("Room privacy failed");
results.roomPrivacy = true;
await request("/auth/logout", {}, cookie);
if ((await request("/auth/me", undefined, cookie)).data.wallet !== null)
  throw new Error("Logout did not revoke token");
results.logout = true;
writeFileSync(
  "evidence/local-worker-smoke.json",
  JSON.stringify(results, null, 2) + "\n",
);
console.log(results);
