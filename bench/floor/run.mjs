// One way of building css-tree's tree for one file, in this process: the median and mean ns per
// node of ROUNDS builds after WARM_MS of warming, and on Node.js the share of that time in GC.
//   node bench/floor/run.mjs <way> <file.css> [--check]
// with LOOP_SECONDS set it only builds for that long, to run under --cpu-prof or --trace-gc
// ways
//   decoder                 src/decode.js on the transfer buffer, captured once
//   decoder:<decode.js>     another checkout's decoder on the same buffer
//   x-nostr                 the decoder with every string a constant, a bound, not the tree
//   floor                   one literal per node from a pre-order tape, strings made in advance
//   floor-slice             the same, with strings sliced from the source as the decoder does
//   floor-intern            the same, each distinct string sliced once per tree
//   floor-json              the same, the distinct strings from one JSON.parse per tree
//   json, clone, v8         JSON.parse, structuredClone and v8.deserialize of the tree
//   parse:<dist>            full parse(source).ast of a built dist directory
//   parseloc:<dist>         the same with positions
//   <name>                  bench/floor/variants/<name>.js, exporting `tree` like the decoder
// --check exits 1 unless the tree is deep-equal, key order included, to this checkout's parse()
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { capture, floorBuilder, shapes, tape } from "./lib.mjs";

const [way, file] = process.argv.slice(2);
const check = process.argv.includes("--check");
const ROUNDS = Number(process.env.ROUNDS ?? 60);
const WARM_MS = Number(process.env.WARM_MS ?? 1000);
const source = readFileSync(file, "utf8");
const { parse } = await import(new URL("../../dist/index.js", import.meta.url).href);
const { buffer, nodes } = capture(source);
const isBun = typeof Bun !== "undefined";

// the decoder's `tree`, exported from a copy of its module, with `edit` applied to the text
async function decoder(path, edit = (text) => text) {
  const text = edit(readFileSync(path, "utf8")).replace(/^export \{[^}]*\};$/m, "export { tree };");
  const out = join(mkdtempSync(join(tmpdir(), "floor-")), "decode.mjs");
  writeFileSync(out, text);
  return (await import(out)).tree;
}

let expected = parse(source, { positions: way.startsWith("parseloc:") }).ast;
let build;
if (way.startsWith("floor")) {
  const slices = way === "floor" || way === "floor-json" ? false : way === "floor-intern" ? "intern" : true;
  const sh = shapes(expected);
  const t = tape(expected, sh, source, slices);
  const f = floorBuilder(sh, t.types, slices);
  build = () => f(t.tape, t.values, source);
  if (way === "floor-json") {
    const bytes = new TextEncoder().encode(JSON.stringify(t.values));
    const td = new TextDecoder();
    build = () => f(t.tape, JSON.parse(td.decode(bytes)), source);
  }
} else if (way === "decoder" || way.startsWith("decoder:") || way === "x-nostr") {
  const path = way.startsWith("decoder:") ? way.slice(8) : new URL("../../src/decode.js", import.meta.url).pathname;
  const nostr = (text) => text.replace(/(const str = \(s, e\) => \{\n)[\s\S]*?\n  \};/, '$1    return "x";\n  };');
  const tree = await decoder(path, way === "x-nostr" ? nostr : undefined);
  build = () => tree(buffer, 0, source, null);
} else if (way.startsWith("parse:") || way.startsWith("parseloc:")) {
  const positions = way.startsWith("parseloc:");
  const other = await import(join(way.slice(way.indexOf(":") + 1), "index.js"));
  build = () => other.parse(source, { positions }).ast;
} else if (way === "json") {
  const json = JSON.stringify(expected);
  build = () => JSON.parse(json);
} else if (way === "clone") {
  const tree = expected;
  build = () => structuredClone(tree);
} else if (way === "v8") {
  const v8 = await import("node:v8");
  const bytes = v8.serialize(expected);
  build = () => v8.deserialize(bytes);
} else {
  const { tree, prepare } = await import(new URL(`variants/${way}.js`, import.meta.url).href);
  if (prepare) prepare(buffer, source);
  build = () => tree(buffer, 0, source, null);
}
if (check && !way.startsWith("x-")) {
  const got = build();
  if (!isDeepStrictEqual(got, expected) || JSON.stringify(got) !== JSON.stringify(expected)) {
    console.error(`${way}: the tree differs from parse()`);
    process.exit(1);
  }
}
expected = null;

// a plain loop for --cpu-prof or --trace-gc
if (process.env.LOOP_SECONDS) {
  const end = performance.now() + Number(process.env.LOOP_SECONDS) * 1000;
  let builds = 0;
  for (; performance.now() < end; builds++) build();
  console.log(`${builds} builds`);
  process.exit(0);
}

let gcMs = 0;
let start = Infinity;
if (!isBun) {
  const { PerformanceObserver } = await import("node:perf_hooks");
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.startTime >= start) gcMs += entry.duration;
  });
  observer.observe({ entryTypes: ["gc"] });
}
let keep;
const warm = performance.now();
while (performance.now() - warm < WARM_MS) keep = build();
const times = [];
start = performance.now();
for (let i = 0; i < ROUNDS; i++) {
  const t = performance.now();
  keep = build();
  times.push(performance.now() - t);
}
const total = performance.now() - start;
// gc entries arrive after the task that ran them
await new Promise((resolve) => setTimeout(resolve, 10));
times.sort((a, b) => a - b);
const median = times[times.length >> 1];
const name = way.replace(/^(\w+:).*?([^/]+\/[^/]+)$/, "$1$2");
console.log(
  JSON.stringify({
    way: name,
    file: file.split("/").pop(),
    nodes,
    ms: +median.toFixed(3),
    ns: +((median * 1e6) / nodes).toFixed(2),
    mean: +(((total / ROUNDS) * 1e6) / nodes).toFixed(2),
    gc: isBun ? null : +(gcMs / total).toFixed(3),
    kept: typeof keep,
  }),
);
