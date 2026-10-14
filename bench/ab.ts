// Parse time of checkouts against each other and css-tree, on Bun and Node.js: `bun bench/ab.ts`.
// ROOTS=/a,/b names the checkouts, each row runs its own bench/worker.ts in a fresh process, rows
// take turns. CORPUS=npm, POS=0 for offsets, RUNTIMES=bun, CSSTREE=0, BUCKETS=1 by size.
import { spawnSync } from "node:child_process";
import { LIBRARIES } from "./adapters.ts";
import { load } from "./corpus.ts";

const RUNS = Number(process.env.RUNS ?? 3);
const BUDGET = Number(process.env.BUDGET ?? 15);
const group = (process.env.CORPUS ?? "markless") as "markless" | "npm";
const roots = (process.env.ROOTS ?? new URL("..", import.meta.url).pathname).split(",");
const runtimes = (process.env.RUNTIMES ?? "bun,node").split(",");
const positions = process.env.POS !== "0";
const mode = { values: "parsed", positions } as const;
const files: string[] = [];
for (const f of load(new Set([group]))) {
  let clean = true;
  for (const library of ["yuku-css", "css-tree"])
    if (clean && (await LIBRARIES.find(({ name }) => name === library)!.check(f.source, mode)) !== undefined) clean = false;
  if (clean) files.push(`${f.group}/${f.name}`);
}
const rows: { runtime: string; root: string; library: string }[] = [];
for (const runtime of runtimes) {
  for (const root of roots) rows.push({ runtime, root, library: "yuku-css" });
  if (process.env.CSSTREE !== "0") rows.push({ runtime, root: roots[0]!, library: "css-tree" });
}
const results = rows.map(() => [] as number[][]);
for (let run = 0; run < RUNS; run++) {
  rows.forEach((row, i) => {
    const task = { kind: "time", library: row.library, mode, files, budget: BUDGET };
    const out = spawnSync(row.runtime, [`${row.root}/bench/worker.ts`, JSON.stringify(task)], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (out.status !== 0) throw new Error(out.stderr);
    results[i]!.push(JSON.parse(out.stdout).map((t: { median: number }) => t.median));
  });
}
const median = (xs: number[]) => xs.toSorted((a, b) => a - b)[xs.length >> 1]!;
const means = rows.map((_, i) => files.reduce((sum, _f, j) => sum + median(results[i]!.map((r) => r[j]!)), 0) / files.length);
rows.forEach((row, i) => {
  const ct = rows.findIndex((r) => r.runtime === row.runtime && r.library === "css-tree");
  const ratio = ct >= 0 && row.library !== "css-tree" ? `  ${(means[ct]! / means[i]!).toFixed(2)}x css-tree` : "";
  console.log(`${row.runtime.padEnd(5)} ${row.library.padEnd(9)} ${row.root.split("/").at(-1)!.padEnd(10)} ${(means[i]! * 1000).toFixed(2).padStart(8)} µs/file${ratio}`);
});
if (group === "npm") {
  files.forEach((f, j) => console.log(f.padEnd(28), rows.map((_, i) => (median(results[i]!.map((r) => r[j]!)) * 1000).toFixed(0).padStart(7)).join(" ")));
}
if (process.env.BUCKETS) {
  const { bucket } = await import("./sample.ts");
  const bytes = new Map(load(new Set([group])).map((f) => [`${f.group}/${f.name}`, f.bytes]));
  const by = new Map<string, number[][]>();
  files.forEach((f, j) => {
    const b = bucket(bytes.get(f)!);
    if (!by.has(b)) by.set(b, rows.map(() => []));
    rows.forEach((_, i) => by.get(b)![i]!.push(median(results[i]!.map((r) => r[j]!))));
  });
  for (const [b, cols] of by) console.log(b.padEnd(12), `n=${cols[0]!.length}`.padEnd(6), rows.map((row, i) => `${row.runtime} ${row.library} ${((cols[i]!.reduce((s, x) => s + x, 0) / cols[i]!.length) * 1000).toFixed(2)}`).join("  "));
}
