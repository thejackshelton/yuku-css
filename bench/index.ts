import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Bench } from "tinybench";
import { chart } from "./chart.ts";

interface Parser {
  name: string;
  color: string;
  load(): Promise<(source: string) => unknown>;
}

const RUNS = 3;
const CORPUS = new URL("../test/corpus/", import.meta.url);

const PARSERS: Parser[] = [
  {
    name: "yuku-css",
    color: "#FF6B35",
    async load() {
      const { parse } = await import("yuku-css");
      return (source) => parse(source).stylesheet;
    },
  },
  {
    name: "css-tree",
    color: "#3A86FF",
    async load() {
      const { parse } = await import("css-tree");
      // selectors parsed, values and at-rule preludes kept raw, as yuku-css does
      const options = { positions: true, parseValue: false, parseAtrulePrelude: false, parseCustomProperty: false };
      return (source) => parse(source, options);
    },
  },
  {
    name: "postcss",
    color: "#8338EC",
    async load() {
      const { parse } = await import("postcss");
      // selectors stay strings: postcss parses them only with postcss-selector-parser
      return (source) => parse(source);
    },
  },
];

const child = PARSERS.find((parser) => parser.name === process.argv[2]);
if (child === undefined) main();
else process.stdout.write(String(await time(child)));

function main(): void {
  const results = PARSERS.map((parser) => {
    const runs = Array.from({ length: RUNS }, () => spawn(parser));
    return { ...parser, microseconds: median(runs) };
  });
  console.table(
    results.map(({ name, microseconds }) => ({ parser: name, "per file": format(microseconds) })),
  );
  writeFileSync(
    new URL("chart.svg", import.meta.url),
    chart([{ bars: results.map(({ name, color, microseconds }) => ({ label: name, color, value: microseconds, text: format(microseconds) })) }]),
  );
}

function spawn(parser: Parser): number {
  const { status, stdout } = spawnSync(process.execPath, [import.meta.filename, parser.name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${parser.name} exited with ${status}`);
  return Number(stdout);
}

async function time(parser: Parser): Promise<number> {
  const files = readdirSync(CORPUS).map((name) => readFileSync(new URL(name, CORPUS), "utf8"));
  const parse = await parser.load();
  const bench = new Bench({ time: 5000, warmupTime: 1000 });
  bench.add(parser.name, () => {
    for (const source of files) parse(source);
  });
  await bench.run();
  const { result } = bench.tasks[0]!;
  if (result.state !== "completed") throw new Error(`${parser.name} did not complete`);
  return (result.latency.p50 * 1000) / files.length;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function format(microseconds: number): string {
  return `${microseconds.toFixed(1)} µs`;
}
