// The in-depth benchmark: `bun run bench:full`. Writes bench/results/<date>.json, then
// docs/benchmark.md and its charts from it. RUNS, BUDGET (ms per file), and COLD set its size.
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, totalmem } from "node:os";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { count, LIBRARIES, MODES, type Mode } from "./adapters.ts";
import { browser } from "./browser.ts";
import { bucket, load, prepare } from "./corpus.ts";
import { report } from "./report.ts";
import type { Timing } from "./sample.ts";
import type { Task } from "./worker.ts";

const RUNS = Number(process.env.RUNS ?? 3);
const BUDGET = Number(process.env.BUDGET ?? 30);
const COLD = Number(process.env.COLD ?? 10);
const RUNTIMES: Record<string, string[]> = { node: [process.execPath], bun: ["bun"] };
const require = createRequire(import.meta.url);
const WORKER = new URL("worker.ts", import.meta.url).pathname;

export const id = (library: string, { values, positions }: Mode) =>
  `${library} ${values}${positions ? "" : " nopos"}`;

const began = Date.now();
const durations: Record<string, number> = {};
const section = async <T>(name: string, work: () => T | Promise<T>): Promise<T> => {
  const start = Date.now();
  console.error(`${name}…`);
  const result = await work();
  durations[name] = (Date.now() - start) / 1000;
  return result;
};

await prepare();
const files = load().map((file) => ({ ...file, key: `${file.group}/${file.name}`, bucket: bucket(file.bytes) }));

const configs = await section("modes", async () => {
  const supported = [];
  for (const library of LIBRARIES)
    for (const mode of MODES) if (await library.supports(mode)) supported.push({ id: id(library.name, mode), library: library.name, mode });
  return supported;
});

// every parse that reports an error is left out of that configuration's timings
const gate = await section("gate", async () => {
  const failed: Record<string, Record<string, string>> = {};
  const nodes: Record<string, Record<string, number>> = {};
  for (const config of configs) {
    const library = LIBRARIES.find(({ name }) => name === config.library)!;
    const parse = await library.load(config.mode);
    failed[config.id] = {};
    nodes[config.id] = {};
    for (const file of files) {
      const reason = await library.check(file.source, config.mode);
      if (reason) failed[config.id]![file.key] = reason;
      else nodes[config.id]![file.key] = count(parse(file.source));
    }
  }
  return { failed, nodes };
});
const passing = (config: string) => files.filter((file) => !(file.key in gate.failed[config]!)).map((file) => file.key);

function spawn(runtime: string, task: Task, flags: string[] = []): any {
  const [command, ...args] = RUNTIMES[runtime]!;
  const { status, stdout } = spawnSync(command!, [...args, ...flags, WORKER, JSON.stringify(task)], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${runtime} ${task.kind} exited with ${status}`);
  return JSON.parse(stdout);
}

// runs take turns, so drift over the suite spreads over every configuration
function rounds<T>(jobs: { key: string; run: () => T }[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (let round = 0; round < RUNS; round++) for (const { key, run } of jobs) (out[key] ??= []).push(run());
  return out;
}

const byFile = (keys: string[], runs: Timing[][]) =>
  Object.fromEntries(keys.map((key, i) => [key, runs.map((run) => run[i]!)]));

const time = await section("parse", () => {
  const out: Record<string, Record<string, Record<string, Timing[]>>> = {};
  for (const runtime of Object.keys(RUNTIMES)) {
    const runs = rounds(
      configs.map((config) => ({
        key: config.id,
        run: (): Timing[] =>
          spawn(runtime, { kind: "time", library: config.library, mode: config.mode, files: passing(config.id), budget: BUDGET }),
      })),
    );
    out[runtime] = Object.fromEntries(configs.map((config) => [config.id, byFile(passing(config.id), runs[config.id]!)]));
  }
  return out;
});

const tokenize = await section("tokenize", () => {
  const out: Record<string, Record<string, Record<string, Timing[]>>> = {};
  const keys = files.map((file) => file.key);
  for (const runtime of Object.keys(RUNTIMES)) {
    const tokenizers = LIBRARIES.filter((library) => library.tokenizer);
    const runs = rounds(
      tokenizers.map((library) => ({
        key: library.name,
        run: (): Timing[] => spawn(runtime, { kind: "tokenize", library: library.name, files: keys, budget: BUDGET }),
      })),
    );
    out[runtime] = Object.fromEntries(tokenizers.map((library) => [library.name, byFile(keys, runs[library.name]!)]));
  }
  return out;
});

const phases = await section("phases", () => {
  const out: Record<string, Record<string, Record<string, Timing>[]>> = {};
  const keys = passing(id("yuku-css", MODES[0]!));
  for (const runtime of Object.keys(RUNTIMES)) {
    try {
      const runs = rounds([{ key: "phases", run: () => spawn(runtime, { kind: "phases", files: keys, budget: BUDGET }) }]);
      out[runtime] = Object.fromEntries(keys.map((key, i) => [key, runs.phases!.map((run) => run[i])]));
    } catch (error) {
      console.error(`phases skipped: ${error}`);
    }
  }
  return out;
});

const typical = files
  .filter((file) => file.group === "markless" && configs.every((config) => !(file.key in gate.failed[config.id]!)))
  .toSorted((a, b) => a.bytes - b.bytes);
const coldFiles = [typical[typical.length >> 1]!.key, "npm/bootstrap.css"];
const cold = await section("cold", () => {
  const out: Record<string, Record<string, Record<string, object[]>>> = {};
  for (const runtime of Object.keys(RUNTIMES))
    for (const library of LIBRARIES)
      for (const file of coldFiles)
        ((out[runtime] ??= {})[library.name] ??= {})[file] = Array.from({ length: COLD }, () =>
          spawn(runtime, { kind: "cold", library: library.name, mode: configs.find((config) => config.library === library.name)!.mode, file }),
        );
  return out;
});

const memory = await section("memory", () => {
  const large = files.filter((file) => file.bytes >= 100 * 1024).map((file) => file.key);
  const out: Record<string, Record<string, object[]>> = {};
  for (const config of configs) {
    out[config.id] = {};
    for (const file of large.filter((key) => !(key in gate.failed[config.id]!)))
      out[config.id]![file] = Array.from({ length: RUNS }, () =>
        spawn("node", { kind: "memory", library: config.library, mode: config.mode, file }, ["--expose-gc"]),
      );
  }
  return out;
});

const bundle = await section("bundle", async () => {
  const out: Record<string, { library: string; minified: number; gzip: number; brotli: number }> = {};
  const compress = (code: Buffer) => ({
    minified: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  });
  for (const library of LIBRARIES)
    for (const { entry, name, assets = [] } of library.entries) {
      const build = await rolldown({
        input: "entry",
        platform: "browser",
        logLevel: "silent",
        plugins: [
          {
            name: "entry",
            resolveId: (source) => (source === "entry" ? source : null),
            load: (source) => (source === "entry" ? `export { ${name} } from "${entry}";` : null),
          },
        ],
      });
      const { output } = await build.generate({ format: "esm", minify: true, codeSplitting: false });
      const sizes = [Buffer.from(output[0].code), ...assets.map((asset) => readFileSync(require.resolve(asset)))].map(compress);
      const sum = (key: "minified" | "gzip" | "brotli") => sizes.reduce((total, size) => total + size[key], 0);
      out[entry] = { library: library.name, minified: sum("minified"), gzip: sum("gzip"), brotli: sum("brotli") };
    }
  return out;
});

const chromium = await section("browser", () =>
  browser(
    configs.filter((config) => LIBRARIES.find(({ name }) => name === config.library)!.browser),
    (config) => files.filter((file) => !(file.key in gate.failed[config]!)),
    RUNS,
    BUDGET / 2,
  ),
);

const version = (name: string) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), "utf8")).version;
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const date = new Date().toISOString().slice(0, 10);
const results = {
  date,
  machine: { cpu: cpus()[0]!.model, cores: cpus().length, memory: totalmem(), os: `${platform()} ${release()}` },
  runtimes: {
    node: process.version,
    bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
    chromium: chromium.version,
  },
  libraries: {
    "yuku-css": `${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version} (${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "src") ? ", modified" : ""})`,
    "css-tree": version("css-tree"),
  },
  settings: { runs: RUNS, budget: BUDGET, cold: COLD },
  files: files.map(({ key, group, name, bytes, bucket }) => ({ key, group, name, bytes, bucket })),
  configs,
  gate,
  time,
  tokenize,
  phases,
  cold,
  memory,
  bundle,
  browser: chromium.results,
  durations: { ...durations, total: (Date.now() - began) / 1000 },
};

mkdirSync(new URL("results/", import.meta.url), { recursive: true });
writeFileSync(new URL(`results/${date}.json`, import.meta.url), JSON.stringify(results));
report(results);
console.error(`done in ${Math.round(results.durations.total)} s`);
