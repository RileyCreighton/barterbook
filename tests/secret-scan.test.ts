import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(
  new URL("../scripts/secret-scan.mjs", import.meta.url),
);
// Construct synthetic credentials at runtime so these fixtures themselves do
// not look like leaked provider URLs to the release scan.
const alchemyUrl = (key: string) =>
  ["https://", "solana-devnet.g.alchemy.com", "/v2/", key].join("");
let directory: string;
function write(path: string, value: string) {
  writeFileSync(join(directory, path), value);
}
function scan() {
  const result = spawnSync(process.execPath, [scanner], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    output: result.stdout + result.stderr,
    report: JSON.parse(result.stdout) as {
      passed: boolean;
      findings: { file: string; rule: string }[];
    },
  };
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "barterbook-secret-scan-"));
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  write(".gitignore", ".dev.vars\n.env.*\n!.env.example\n");
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("release secret scanner", () => {
  it("detects Alchemy path credentials without needing local configuration", () => {
    const key = "a".repeat(32);
    write("accidental.txt", alchemyUrl(key));
    const result = scan();
    expect(result.status).toBe(1);
    expect(result.report.findings).toContainEqual({
      file: "accidental.txt",
      rule: "alchemy-url-credential",
    });
    expect(result.output).not.toContain(key);
  });

  it("allows documentation placeholders and .env.example", () => {
    write(
      ".env.example",
      [
        "YOUR_ALCHEMY_API_KEY",
        "REPLACE_WITH_API_KEY",
        "EXAMPLE_API_KEY_VALUE",
        "<api-key>",
      ]
        .map((key) => `SOLANA_RPC_FALLBACK_URL=${alchemyUrl(key)}`)
        .join("\n"),
    );
    write(
      ".env.rpc-backup.local",
      `ALCHEMY_RPC_URL=${alchemyUrl("YOUR_ALCHEMY_API_KEY")}`,
    );
    const result = scan();
    expect(result.status).toBe(0);
    expect(result.report.passed).toBe(true);
  });

  it("detects bare Alchemy and Cloudflare credentials from ignored local files", () => {
    const rpcKey = "b".repeat(32);
    const cloudflareToken = "c".repeat(40);
    write(
      ".env.rpc-backup.local",
      `export SOLANA_RPC_FALLBACK_URL = '${alchemyUrl(rpcKey)}' # local only\n`,
    );
    write(
      ".env.cloudflare-cpu.local",
      `CLOUDFLARE_API_TOKEN="${cloudflareToken}"\n`,
    );
    write("accidental.txt", `${rpcKey}\n${cloudflareToken}`);
    const result = scan();
    expect(result.report.findings).toEqual([
      { file: "accidental.txt", rule: "exact-local-provider-secret" },
    ]);
    expect(result.status).toBe(1);
    expect(result.output).not.toContain(rpcKey);
    expect(result.output).not.toContain(cloudflareToken);
  });

  it("retains exact matching of original RPC query keys", () => {
    const key = "d".repeat(32);
    write(
      ".dev.vars",
      `SOLANA_RPC_URL=${["https://rpc.example.invalid/?api-key=", key].join("")}\n`,
    );
    write("accidental.txt", key);
    const result = scan();
    expect(result.status).toBe(1);
    expect(result.report.findings).toContainEqual({
      file: "accidental.txt",
      rule: "exact-local-provider-secret",
    });
  });

  it("rejects force-added secret env files even when they contain no key", () => {
    write(".env.rpc-backup.local", "# private configuration\n");
    execFileSync("git", ["add", "--force", ".env.rpc-backup.local"], {
      cwd: directory,
    });
    const result = scan();
    expect(result.status).toBe(1);
    expect(result.report.findings).toContainEqual({
      file: ".env.rpc-backup.local",
      rule: "private-path-selected-for-release",
    });
  });
});
