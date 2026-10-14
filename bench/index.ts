// One benchmark, quickly: `node bench/index.ts` times the parsers of the README's parse row on
// test/corpus; `tokenize`, `generate`, `match` or `validate` times tokenizing, printing, matching
// every declaration or validating each file instead. `CORPUS=npm` or `synthetic` times that group
// of bench/corpus.ts in place of test/corpus. bench/full.ts writes the README section.
import { spawnSync } from "node:child_process";
import { LIBRARIES, type Mode } from "./adapters.ts";
import { type File, load, prepare } from "./corpus.ts";
import { quantile, type Timing } from "./sample.ts";
import type { Task } from "./worker.ts";

interface Row {
  name: string;
  task(files: string[]): Task;
  // the parse a file must pass cleanly to be timed in this suite
  checks: { library: string; mode: Mode }[];
}

const RUNS = Number(process.env.RUNS ?? 3);
const BUDGET = Number(process.env.BUDGET ?? 30);
const WORKER = new URL("worker.ts", import.meta.url).pathname;
const LOC: Mode = { values: "parsed", positions: true };
const OFFSETS: Mode = { values: "parsed", positions: false };
// PostCSS keeps values and preludes as strings whatever it is asked
const RAW: Mode = { values: "raw", positions: true };

const parse = (name: string, library: string, mode: Mode): Row => ({
  name,
  task: (files) => ({ kind: "time", library, mode, files, budget: BUDGET }),
  checks: [{ library, mode }],
});
const tokenize = (library: string): Row => ({
  name: library,
  task: (files) => ({ kind: "tokenize", library, files, budget: BUDGET }),
  checks: [{ library, mode: LOC }],
});
// both print css-tree's own tree, so only css-tree must parse the file cleanly
const generate = (name: string, library: string, sourceMap: boolean): Row => ({
  name,
  task: (files) => ({ kind: "generate", library, sourceMap, files, budget: BUDGET }),
  checks: [{ library: "css-tree", mode: LOC }],
});

const match = (matcher: string): Row => ({
  name: matcher,
  task: (files) => ({ kind: "match", matcher, files, budget: BUDGET }),
  checks: [{ library: "css-tree", mode: OFFSETS }],
});
// both parse each file with values, as their defaults do, so both must read it cleanly
const validate = (validator: string): Row => ({
  name: validator,
  task: (files) => ({ kind: "validate", validator, files, budget: BUDGET }),
  checks: [
    { library: "yuku-css", mode: OFFSETS },
    { library: "css-tree", mode: OFFSETS },
  ],
});

const SUITES: Record<string, Row[]> = {
  // css-tree parses selectors, values and at-rule preludes, as yuku-css does, and gives positions
  parse: [
    parse("yuku-css", "yuku-css", OFFSETS),
    parse("yuku-css loc", "yuku-css", LOC),
    parse("css-tree", "css-tree", LOC),
    parse("postcss", "postcss", RAW),
  ],
  tokenize: [tokenize("yuku-css"), tokenize("css-tree")],
  // both print css-tree's tree of each file, values parsed
  generate: [
    generate("yuku-css", "yuku-css", false),
    generate("css-tree", "css-tree", false),
    generate("yuku-css map", "yuku-css", true),
    generate("css-tree map", "css-tree", true),
  ],
  // every declaration's text, or css-tree's tree of its value, through `matchProperty`
  match: [
    match("yuku-css"),
    match("yuku-css unread"),
    match("css-tree webref"),
    match("yuku-css tree"),
    match("css-tree tree"),
    match("css-tree"),
  ],
  // yuku-css's `matchStylesheet` against css-tree's parse and `matchDeclaration` on each declaration
  validate: [validate("yuku-css"), validate("yuku-css unread"), validate("css-tree")],
};

const task = Object.hasOwn(SUITES, process.argv[2] ?? "") ? process.argv[2]! : "parse";
const group = (process.env.CORPUS ?? "markless") as File["group"];
if (group !== "markless") await prepare();
const rows = SUITES[task]!;
const files = await clean(rows.flatMap((row) => row.checks));

// runs take turns, so drift spreads over every row
const runs = rows.map((): Timing[][] => []);
for (let run = 0; run < RUNS; run++) rows.forEach((row, index) => runs[index]!.push(spawn(row.task(files))));

const results = rows.map((row, index) => {
  const medians = files.map((_, file) => quantile(runs[index]!.map((timings) => timings[file]!.median), 0.5));
  return { ...row, microseconds: (medians.reduce((sum, median) => sum + median, 0) * 1000) / files.length };
});
console.table(results.map(({ name, microseconds }) => ({ [task]: name, "per file": format(microseconds) })));
console.log(`${files.length} files`);

// the corpus files that every row's parser reads without an error, in the mode it runs in
async function clean(checks: { library: string; mode: Mode }[]): Promise<string[]> {
  const kept: string[] = [];
  for (const file of load(new Set([group]))) {
    let passed = true;
    for (const { library, mode } of checks)
      if (passed && (await LIBRARIES.find(({ name }) => name === library)!.check(file.source, mode)) !== undefined) passed = false;
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
