// The README benchmark: `node bench/index.ts` times parsing test/corpus and redraws the chart,
// `node bench/index.ts tokenize` or `generate` times tokenizing or printing and leaves it alone.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { LIBRARIES, type Mode } from "./adapters.ts";
import { chart } from "./chart.ts";
import { load } from "./corpus.ts";
import { quantile, type Timing } from "./sample.ts";
import type { Task } from "./worker.ts";

interface Row {
  name: string;
  color: string;
  task(files: string[]): Task;
}

const RUNS = Number(process.env.RUNS ?? 3);
const BUDGET = Number(process.env.BUDGET ?? 30);
const WORKER = new URL("worker.ts", import.meta.url).pathname;
const RAW: Mode = { values: "raw", positions: true };
const OFFSETS: Mode = { values: "raw", positions: false };
const PARSED: Mode = { values: "parsed", positions: true };

const parse = (name: string, library: string, mode: Mode, color: string): Row => ({
  name,
  color,
  task: (files) => ({ kind: "time", library, mode, files, budget: BUDGET }),
});
const tokenize = (library: string, color: string): Row => ({
  name: library,
  color,
  task: (files) => ({ kind: "tokenize", library, files, budget: BUDGET }),
});
const generate = (name: string, library: string, sourceMap: boolean, color: string): Row => ({
  name,
  color,
  task: (files) => ({ kind: "generate", library, sourceMap, files, budget: BUDGET }),
});

const SUITES = {
  // css-tree keeps values and at-rule preludes raw, as yuku-css does, and gives positions
  parse: [
    parse("yuku-css", "yuku-css", OFFSETS, "#FF6B35"),
    parse("yuku-css loc", "yuku-css", RAW, "#FFA07A"),
    parse("css-tree", "css-tree", RAW, "#3A86FF"),
    parse("postcss", "postcss", RAW, "#8338EC"),
  ],
  tokenize: [tokenize("yuku-css", "#FF6B35"), tokenize("css-tree", "#3A86FF")],
  // both print css-tree's tree of each file, values parsed
  generate: [
    generate("yuku-css", "yuku-css", false, "#FF6B35"),
    generate("css-tree", "css-tree", false, "#3A86FF"),
    generate("yuku-css map", "yuku-css", true, "#FFA07A"),
    generate("css-tree map", "css-tree", true, "#8338EC"),
  ],
};

const task = process.argv[2] === "tokenize" || process.argv[2] === "generate" ? process.argv[2] : "parse";
const files = await clean(task === "generate" ? [RAW, OFFSETS, PARSED] : [RAW, OFFSETS]);
const rows = SUITES[task];

// runs take turns, so drift spreads over every row
const runs = rows.map((): Timing[][] => []);
for (let run = 0; run < RUNS; run++) rows.forEach((row, index) => runs[index]!.push(spawn(row.task(files))));

const results = rows.map((row, index) => {
  const medians = files.map((_, file) => quantile(runs[index]!.map((timings) => timings[file]!.median), 0.5));
  return { ...row, microseconds: (medians.reduce((sum, median) => sum + median, 0) * 1000) / files.length };
});
console.table(results.map(({ name, microseconds }) => ({ [task]: name, "per file": format(microseconds) })));
console.log(`${files.length} files`);
if (task === "parse") {
  const bars = results.map(({ name, color, microseconds }) => ({ label: name, color, value: microseconds, text: format(microseconds) }));
  writeFileSync(new URL("chart.svg", import.meta.url), chart([{ bars }], { labelWidth: 110 }));
}

// the corpus files that every library parses without an error, in every mode the suite uses
async function clean(modes: Mode[]): Promise<string[]> {
  const checks = LIBRARIES.filter(({ name }) => name === "yuku-css" || name === "css-tree" || name === "postcss");
  const kept: string[] = [];
  for (const file of load(new Set(["markless"]))) {
    let passed = true;
    for (const library of checks)
      for (const mode of modes)
        if (passed && (await library.supports(mode)) && (await library.check(file.source, mode)) !== undefined) passed = false;
    if (passed) kept.push(`${file.group}/${file.name}`);
  }
  return kept;
}

function spawn(task: Task): Timing[] {
  const { status, stdout } = spawnSync(process.execPath, [WORKER, JSON.stringify(task)], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${task.kind} exited with ${status}`);
  return JSON.parse(stdout);
}

function format(microseconds: number): string {
  return `${microseconds.toFixed(1)} µs`;
}
