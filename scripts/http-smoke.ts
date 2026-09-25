/** Hosted HTTP/D1 verification only. Ephemeral SDK identity, no wallet extension,
 * tokens, chain transactions, or trading private keys in the application. */
import { Keypair } from "@solana/web3.js";
import { mkdirSync, writeFileSync } from "node:fs";
import { authenticateSdkWallet } from "./devnet-board-seed";
const input = process.argv[2];
if (!input)
  throw new Error("Usage: npm run smoke:http -- https://ACTUAL_APP_ORIGIN");
const url = new URL(input);
if (
  url.protocol !== "https:" ||
  url.pathname !== "/" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash
)
  throw new Error("Provide an exact public HTTPS application origin");
const startedAt = new Date().toISOString();
const checks: { name: string; passed: boolean }[] = [];
for (const route of [
  "/health",
  "/demo",
  "/history",
  "/assets",
  "/listings",
  "/matches",
]) {
  const response = await fetch(`${url.origin}/api${route}`, {
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Public ${route} returned ${response.status}`);
  const data = (await response.json()) as { cluster?: string };
  if (data.cluster && data.cluster !== "devnet")
    throw new Error("Wrong cluster");
  if (response.headers.get("cache-control") !== "no-store")
    throw new Error("API cache policy missing");
  checks.push({ name: `GET ${route}`, passed: true });
}
const signer = Keypair.generate();
const session = await authenticateSdkWallet(url.origin, signer);
checks.push({
  name: "Real hosted challenge, native Ed25519 verification, secure cookie and durable session",
  passed: true,
});
await session("/rooms");
checks.push({ name: "Authenticated room listing", passed: true });
try {
  await session("/rooms/nonexistent-smoke-room");
  throw new Error("Unexpected room access");
} catch (error) {
  if (!(error instanceof Error) || !error.message.includes("returned 404"))
    throw error;
}
checks.push({
  name: "Unknown/unauthorized room remains private",
  passed: true,
});
await session("/auth/logout", {});
const me = await session<{ wallet: string | null }>("/auth/me");
if (me.wallet !== null)
  throw new Error("Logout did not revoke the durable session");
checks.push({ name: "Logout revokes session", passed: true });
for (const path of [
  "/legal/LICENSE",
  "/legal/NOTICE",
  "/legal/third-party-licenses.txt",
  "/legal/rpc-websockets-9.3.9-source.tar.gz",
]) {
  const response = await fetch(`${url.origin}${path}`, { redirect: "error" });
  if (
    !response.ok ||
    response.headers.get("content-type")?.includes("text/html")
  )
    throw new Error(`Legal artifact unavailable: ${path}`);
  checks.push({ name: `GET ${path}`, passed: true });
}
const report = {
  startedAt,
  finishedAt: new Date().toISOString(),
  url: url.origin,
  scope:
    "Real hosted HTTP/Worker/D1; ephemeral SDK authentication only. No browser-wallet signing or onchain exchange.",
  wallet: signer.publicKey.toBase58(),
  checks,
  passed: true,
};
mkdirSync("evidence/hosted", { recursive: true });
const path = `evidence/hosted/http-smoke-${Date.now()}.json`;
writeFileSync(path, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({ evidence: path, passed: true, checks: checks.length }),
);
