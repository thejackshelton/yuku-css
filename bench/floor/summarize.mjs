// Self time by function in a .cpuprofile, the top 15.
//   node bench/floor/summarize.mjs <file.cpuprofile>
import { readFileSync } from "node:fs";

const profile = JSON.parse(readFileSync(process.argv[2], "utf8"));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
let total = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const { callFrame } = byId.get(profile.samples[i]);
  const key = `${callFrame.functionName || "(anonymous)"} ${callFrame.url.split("/").pop()}:${callFrame.lineNumber}`;
  const dt = profile.timeDeltas[i] ?? 0;
  self.set(key, (self.get(key) ?? 0) + dt);
  total += dt;
}
for (const [key, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`${((t / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
}
