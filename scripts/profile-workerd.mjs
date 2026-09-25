import { writeFileSync } from "node:fs";
import WebSocket from "ws";
const inspector = (
  await (await fetch("http://localhost:9230/json/list")).json()
)[0];
const ws = new WebSocket(
  inspector.webSocketDebuggerUrl.replace("localhost", "127.0.0.1"),
  { headers: { Origin: "http://localhost:9230" } },
);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (!p) return;
    m.error ? p.reject(m.error) : p.resolve(m.result);
  }
};
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await call("Profiler.enable");
await call("Profiler.setSamplingInterval", { interval: 100 });
await fetch("http://localhost:8790/?n=10");
await call("Profiler.start");
const start = performance.now();
const response = await (await fetch("http://localhost:8790/?n=100")).json();
const wallMs = performance.now() - start;
const { profile } = await call("Profiler.stop");
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
let activeMicros = 0;
const functions = new Map();
for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
  const node = nodes.get(profile.samples[i]),
    time = profile.timeDeltas[i];
  const name = node.callFrame.functionName;
  if (!["(idle)", "(program)", "(root)"].includes(name)) activeMicros += time;
  functions.set(name, (functions.get(name) ?? 0) + time);
}
const report = {
  at: new Date().toISOString(),
  scope:
    "LOCAL workerd V8 sampling profile; warmed batch average, not hosted per-request CPU percentile. Real Free-tier gate remains unverified.",
  iterations: response.iterations,
  wallMs,
  sampledActiveMs: activeMicros / 1000,
  sampledActiveMsPerVerification: activeMicros / 1000 / response.iterations,
  topFunctions: [...functions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10),
};
writeFileSync(
  "evidence/workerd-cpu-profile.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
ws.terminate();
