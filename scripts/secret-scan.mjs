import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Reports names/rule IDs only. Never prints matched values, private file content,
// credentials, or historical blob content. This is a focused release check, not
// a claim to discover every possible secret format.
const git = (...args) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error(
      "Git inspection could not complete. No inspected content is included in this error.",
    );
  }
};
const files = [
  ...new Set(
    git("ls-files", "--cached", "--others", "--exclude-standard", "-z")
      .split("\0")
      .filter(Boolean),
  ),
];
const findings = [];
const skipped = [];
const checked = [];
const forbidden =
  /(^|\/)(?:\.dev\.vars(?:\..*)?|\.test-wallets|\.env(?!\.example$)(?:\.[^/]*)?|node_modules|\.wrangler|test-results|playwright-report)(?:\/|$)|\.(?:sqlite|sqlite3|db|log|pem|key)$/i;
const rules = [
  ["pem-private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "github-token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  ["aws-access-key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["solana-private-key-array", /\[\s*\d{1,3}(?:\s*,\s*\d{1,3}){63}\s*\]/],
  [
    "rpc-url-credential",
    /https:\/\/[^\s"'<>]+[?&]api[-_]?key=(?!REPLACE|YOUR_|EXAMPLE|…|\.\.\.)[a-zA-Z0-9_-]{16,}/i,
  ],
  [
    "alchemy-url-credential",
    /https:\/\/(?:[a-z0-9-]+\.)*alchemy\.com\/v2\/(?!REPLACE|YOUR[_-]|EXAMPLE|…|\.\.\.)[a-zA-Z0-9_-]{16,}/i,
  ],
  ["bearer-literal", /(?:Bearer|oauth_token\s*=)\s*["']?[A-Za-z0-9_-]{35,}/],
];
// Exact local credential/key matching catches values even if their format is new.
// This list stays in memory and is never reported.
const secrets = [];
function keepCredential(value) {
  if (
    value.length >= 16 &&
    !/^(?:REPLACE|YOUR[_-]|EXAMPLE|<|…|\.\.\.|\$\{)/i.test(value)
  )
    secrets.push(value);
}
for (const localFile of [
  ".dev.vars",
  ".env.rpc-backup.local",
  ".env.cloudflare-cpu.local",
]) {
  if (!existsSync(localFile)) continue;
  for (const line of readFileSync(localFile, "utf8").split("\n")) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/i,
    );
    if (!match) continue;
    const value = match[2]
      .replace(/\s+#.*$/, "")
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (/(?:^|_)(?:TOKEN|SECRET|API_KEY)$/i.test(match[1]))
      keepCredential(value);
    try {
      const u = new URL(value);
      for (const [name, credential] of u.searchParams)
        if (/key|token|secret/i.test(name)) keepCredential(credential);
      if (/(?:^|\.)alchemy\.com$/i.test(u.hostname)) {
        const key = /^\/v2\/([^/]+)/.exec(u.pathname)?.[1];
        if (key) keepCredential(decodeURIComponent(key));
      }
    } catch {}
  }
}
function scan(label, content) {
  if (content.includes("\0")) {
    skipped.push(label);
    return;
  }
  checked.push(label);
  for (const [rule, pattern] of rules)
    if (pattern.test(content)) findings.push({ file: label, rule });
  if (secrets.some((value) => content.includes(value)))
    findings.push({ file: label, rule: "exact-local-provider-secret" });
}
for (const file of files) {
  if (forbidden.test(file)) {
    findings.push({ file, rule: "private-path-selected-for-release" });
    continue;
  }
  if (!existsSync(file)) continue;
  scan(file, readFileSync(file, "utf8"));
}
let commits = [];
try {
  commits = git("rev-list", "--all").trim().split("\n").filter(Boolean);
} catch {}
const seen = new Set();
for (const commit of commits) {
  for (const line of git("ls-tree", "-r", commit).trim().split("\n")) {
    const match = line.match(/^\d+ blob ([a-f0-9]+)\t(.+)$/);
    if (!match) continue;
    const [, blob, path] = match;
    if (seen.has(blob)) continue;
    seen.add(blob);
    if (forbidden.test(path))
      findings.push({
        file: `history:${commit.slice(0, 8)}:${path}`,
        rule: "private-path-in-history",
      });
    scan(
      `history:${commit.slice(0, 8)}:${path}`,
      git("cat-file", "blob", blob),
    );
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  scope:
    "Git-selected working files and all available Git commit blobs; text rules plus exact local RPC credential matching. Binary files require separate review.",
  filesChecked: checked.length,
  commitsChecked: commits.length,
  binaryFilesSkipped: skipped,
  findings,
  passed: findings.length === 0,
  manifestSha256: createHash("sha256").update(files.join("\n")).digest("hex"),
};
if (process.argv.includes("--record"))
  writeFileSync(
    "evidence/release-secret-scan.json",
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(JSON.stringify(report, null, 2));
if (findings.length) process.exitCode = 1;
