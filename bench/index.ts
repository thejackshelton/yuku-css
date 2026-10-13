import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Bench } from "tinybench";

interface Parser {
  name: string;
  color: string;
  load(): Promise<(source: any) => unknown>;
  // turns each file into what the timed function takes, untimed
  prepare?(source: string): Promise<unknown>;
}

const RUNS = 3;
const CORPUS = new URL("../test/corpus/", import.meta.url);

const PARSERS: Parser[] = [
  {
    name: "yuku-css",
    color: "#FF6B35",
    async load() {
      const { parse } = await import("yuku-css");
      return (source) => parse(source).ast;
    },
  },
  {
    name: "yuku-css loc",
    color: "#FFA07A",
    async load() {
      const { parse } = await import("yuku-css");
      // with lines and columns, as css-tree gives them below
      return (source) => parse(source, { positions: true }).ast;
    },
  },
  {
    name: "css-tree",
    color: "#3A86FF",
    async load() {
      const { parse } = await import("css-tree");
      // selectors and values parsed, at-rule preludes kept raw, as yuku-css does
      const options = { positions: true, parseAtrulePrelude: false };
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

const TOKENIZERS: Parser[] = [
  {
    name: "yuku-css",
    color: "#FF6B35",
    async load() {
      const { tokenize } = await import("yuku-css");
      return (source) => tokenize(source);
    },
  },
  {
    name: "css-tree",
    color: "#3A86FF",
    async load() {
      const { tokenize } = await import("css-tree");
      return (source) => {
        let count = 0;
        tokenize(source, () => count++);
        return count;
      };
    },
  },
];

// css-tree's tree of each file, values parsed, which both generators print
async function cssTree(source: string): Promise<unknown> {
  const { parse } = await import("css-tree");
  return parse(source, { positions: true });
}

const GENERATORS: Parser[] = [
  {
    name: "yuku-css",
    color: "#FF6B35",
    prepare: cssTree,
    async load() {
      const { generate } = await import("yuku-css/codegen");
      return (ast) => generate(ast);
    },
  },
  {
    name: "css-tree",
    color: "#3A86FF",
    prepare: cssTree,
    async load() {
      const { generate } = await import("css-tree");
      return (ast) => generate(ast);
    },
  },
  {
    name: "yuku-css map",
    color: "#FFA07A",
    prepare: cssTree,
    async load() {
      const { generate } = await import("yuku-css/codegen");
      return (ast) => generate(ast, { sourceMap: true }).map.toString();
    },
  },
  {
    name: "css-tree map",
    color: "#8338EC",
    prepare: cssTree,
    async load() {
      const { generate } = await import("css-tree");
      return (ast) => (generate(ast, { sourceMap: true }) as unknown as { map: object }).map.toString();
    },
  },
];

// every declaration of a file as property and css-tree's tree of the value, which both lexers match
// node for node
async function declarationTrees(source: string): Promise<[string, unknown][]> {
  const { parse, walk } = await import("css-tree");
  const found: [string, unknown][] = [];
  walk(parse(source), { visit: "Declaration", enter: (node) => found.push([node.property, node.value]) });
  return found;
}

// every declaration of a file, as property and value text, which every lexer matches as a string
async function declarations(source: string): Promise<[string, string][]> {
  const { parse, walk } = await import("css-tree");
  const found: [string, string][] = [];
  const ast = parse(source, { parseValue: false, parseAtrulePrelude: false });
  walk(ast, { visit: "Declaration", enter: (node) => found.push([node.property, (node.value as { value: string }).value.trim()]) });
  return found;
}

const MATCHERS: Parser[] = [
  {
    name: "yuku-css",
    color: "#FF6B35",
    prepare: declarations,
    async load() {
      const { lexer } = await import("yuku-css/lexer");
      // reading `matched` and `error` builds the tree and error css-tree builds
      return (list: [string, string][]) => {
        for (const [property, value] of list) {
          const result = lexer.matchProperty(property, value);
          void result.matched;
          void result.error;
        }
      };
    },
  },
  {
    name: "yuku-css unread",
    color: "#FFA07A",
    prepare: declarations,
    async load() {
      const { lexer } = await import("yuku-css/lexer");
      // neither read, so neither built, as a caller that keeps only valid values does not
      return (list: [string, string][]) => {
        for (const [property, value] of list) lexer.matchProperty(property, value);
      };
    },
  },
  {
    name: "css-tree webref",
    color: "#8338EC",
    prepare: declarations,
    async load() {
      // css-tree's matcher over the same grammar
      const oraclePath = "../test/grammar/webref.ts";
      const { oracle } = (await import(oraclePath)) as typeof import("../test/grammar/webref");
      return (list: [string, string][]) => {
        for (const [property, value] of list) oracle.matchProperty(property, value);
      };
    },
  },
  {
    name: "yuku-css tree",
    color: "#FFBE0B",
    prepare: declarationTrees,
    async load() {
      const { lexer } = await import("yuku-css/lexer");
      return (list: [string, string][]) => {
        for (const [property, value] of list) {
          const result = lexer.matchProperty(property, value);
          void result.matched;
          void result.error;
        }
      };
    },
  },
  {
    name: "css-tree tree",
    color: "#06D6A0",
    prepare: declarationTrees,
    async load() {
      const { lexer } = await import("css-tree");
      return (list: [string, string][]) => {
        for (const [property, value] of list) lexer.matchProperty(property, value);
      };
    },
  },
  {
    name: "css-tree",
    color: "#3A86FF",
    prepare: declarations,
    async load() {
      const { lexer } = await import("css-tree");
      return (list: [string, string][]) => {
        for (const [property, value] of list) lexer.matchProperty(property, value);
      };
    },
  },
];

// `node bench/index.ts tokenize`, `generate` or `match` times tokenizing, printing or matching
// every declaration instead, and leaves the chart alone
const task = ["tokenize", "generate", "match"].includes(process.argv[2]!) ? process.argv[2]! : "parse";
const suite = { tokenize: TOKENIZERS, generate: GENERATORS, match: MATCHERS }[task] ?? PARSERS;
const child = suite.find((parser) => parser.name === process.argv[3]);
if (child === undefined) main();
else process.stdout.write(String(await time(child)));

function main(): void {
  const results = suite.map((parser) => {
    const runs = Array.from({ length: RUNS }, () => spawn(parser));
    return { ...parser, microseconds: median(runs) };
  });
  console.table(
    results.map(({ name, microseconds }) => ({ [{ parse: "parser", tokenize: "tokenizer", generate: "generator" }[task] ?? "lexer"]: name, "per file": format(microseconds) })),
  );
  if (task === "parse") writeFileSync(new URL("chart.svg", import.meta.url), chart(results));
}

function spawn(parser: Parser): number {
  const { status, stdout } = spawnSync(process.execPath, [import.meta.filename, task, parser.name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (status !== 0) throw new Error(`${parser.name} exited with ${status}`);
  return Number(stdout);
}

async function time(parser: Parser): Promise<number> {
  const sources = readdirSync(CORPUS).map((name) => readFileSync(new URL(name, CORPUS), "utf8"));
  const files = parser.prepare ? await Promise.all(sources.map(parser.prepare)) : sources;
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

function chart(results: (Parser & { microseconds: number })[]): string {
  const width = 640;
  const barX = 110;
  const fastest = Math.min(...results.map((result) => result.microseconds));
  const slowest = Math.max(...results.map((result) => result.microseconds));
  const rows = results.map(({ name, color, microseconds }, index) => {
    const y = index * 30;
    const middle = y + 11;
    const barEnd = barX + Math.round((microseconds / slowest) * (width - barX - 80));
    const row = [
      `<text x="${barX - 10}" y="${middle}" text-anchor="end">${name}</text>`,
      `<rect x="${barX}" y="${y}" width="${barEnd - barX}" height="22" rx="4" fill="${color}"/>`,
      `<text x="${barEnd + 8}" y="${middle}">${format(microseconds)}</text>`,
    ];
    if (microseconds !== fastest) {
      const ratio = `${(microseconds / fastest).toFixed(2)}×`;
      row.push(`<text class="ratio" x="${barEnd - 8}" y="${middle}" text-anchor="end">${ratio}</text>`);
    }
    return row.join("\n  ");
  });

  const height = results.length * 30 - 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text { font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; fill: #848d97; dominant-baseline: central; font-variant-numeric: tabular-nums }
    .ratio { font-size: 12px; fill: #fff }
  </style>
  ${rows.join("\n  ")}
</svg>
`;
}
