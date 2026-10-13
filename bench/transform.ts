// `transform` against parse then generate and Lightning CSS's `transform`, in MB/s of source: each
// library and file in a fresh process, 1 s warm, the median of 2 s of runs, the median of 3
// processes. Every library takes a string, so Lightning CSS's time includes encoding it, and
// returns CSS text; Lightning CSS returns bytes, so its time leaves out decoding them. Each runs
// through its adapter in bench/adapters.ts, as in docs/benchmark.md.
//
//   node bench/transform.ts [file.css | directory ...]
//   bun bench/transform.ts ...
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { LIBRARIES } from "./adapters.ts";

const RUNS = 3;
const WARM_MS = 1000;
const TIME_MS = 2000;

// the column each adapter fills
const COLUMNS: Record<string, string> = {
  transform: "yuku-css transform",
  "parse + generate": "yuku-css print",
  lightningcss: "lightningcss",
  "lightningcss-wasm": "lightningcss-wasm",
};

const [, script, library, file] = process.argv;
if (library !== undefined && Object.hasOwn(COLUMNS, library) && file !== undefined) {
  process.stdout.write(String(await time(library, file)));
} else {
  main(process.argv.slice(2));
}

function main(paths: string[]): void {
  const files = (paths.length > 0 ? paths : [new URL("../test/corpus/", import.meta.url).pathname]).flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path).filter((name) => name.endsWith(".css")).sort().map((name) => join(path, name))
      : [path],
  );
  const libraries = Object.keys(COLUMNS);
  const rows = files.map((file) => {
    const megabytes = readFileSync(file).length / 1e6;
    const row: Record<string, string> = { file: basename(file) };
    for (const name of libraries) {
      const runs = Array.from({ length: RUNS }, () => spawn(name, file));
      row[name] = (megabytes / (median(runs) / 1000)).toFixed(0);
    }
    return row;
  });
  console.log(`${process.versions.bun ? "Bun " + process.versions.bun : "Node.js " + process.versions.node}, MB/s`);
  console.table(rows);
}

function spawn(library: string, file: string): number {
  const { status, stdout } = spawnSync(process.execPath, [script!, library, file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${library} on ${file} exited with ${status}`);
  return Number(stdout);
}

// milliseconds per run, the median
async function time(library: string, file: string): Promise<number> {
  const source = readFileSync(file, "utf8");
  const run = await LIBRARIES.find(({ name }) => name === COLUMNS[library])!.load({ values: "parsed", positions: false });
  for (const start = performance.now(); performance.now() - start < WARM_MS; ) run(source);
  const samples: number[] = [];
  for (const start = performance.now(); performance.now() - start < TIME_MS || samples.length < 25; ) {
    const before = performance.now();
    run(source);
    samples.push(performance.now() - before);
  }
  return median(samples);
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
