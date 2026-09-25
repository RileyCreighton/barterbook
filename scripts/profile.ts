import { writeFileSync } from "node:fs";
import { fixture } from "../tests/fixtures";
import {
  buildTransaction,
  verifyTransaction,
  verifyWireSignatures,
} from "../src/shared/transactions";
const f = fixture(3),
  tx = buildTransaction(f.plan);
tx.partialSign(...f.owners);
const bytes = tx.serialize();
const rows = [];
for (const [name, action] of Object.entries({
  strictVerification: () => {
    verifyTransaction(bytes, f.plan);
  },
  allThreeNativeSignatures: () => verifyWireSignatures(bytes, f.plan, true),
})) {
  for (let i = 0; i < 20; i++) await action();
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const cpu = process.cpuUsage();
    const wall = performance.now();
    await action();
    const used = process.cpuUsage(cpu);
    samples.push({
      cpuMs: (used.user + used.system) / 1000,
      wallMs: performance.now() - wall,
    });
  }
  const sorted = samples.map((s) => s.cpuMs).sort((a, b) => a - b);
  rows.push({
    name,
    iterations: 100,
    medianCpuMs: sorted[50],
    p95CpuMs: sorted[95],
    maxCpuMs: sorted[99],
    medianWallMs: samples.map((s) => s.wallMs).sort((a, b) => a - b)[50],
  });
}
const result = {
  at: new Date().toISOString(),
  runtime: process.version,
  scope:
    "EARLY LOCAL NODE PROCESS CPU PROFILE. Not deployed Worker CPU. Free 10ms gate requires workerd and hosted metrics.",
  rows,
};
writeFileSync(
  "evidence/early-cpu-profile.json",
  JSON.stringify(result, null, 2) + "\n",
);
console.log(result);
