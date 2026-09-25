import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
export function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
export function unb64(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length > 10000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    throw new Error("Invalid base64");
  return new Uint8Array(Buffer.from(value, "base64"));
}
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(obj[k]))
      .join(",") +
    "}"
  );
}
export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : new Uint8Array(bytes);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifyEd25519(
  wallet: string,
  signature: Uint8Array,
  message: Uint8Array,
): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(new PublicKey(wallet).toBytes()),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      new Uint8Array(signature),
      new Uint8Array(message),
    );
  } catch {
    return false;
  }
}
