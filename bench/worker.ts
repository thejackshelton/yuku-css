// One measurement in a fresh process, run by bench/full.ts. The task comes as JSON in argv[2],
// the result goes as JSON to stdout.
import { COMPETITORS, count, LIBRARIES, MATCHERS, type Mode, VALIDATORS, type Where } from "./adapters.ts";
import { type File, load } from "./corpus.ts";
import { measure, measureAsync, sample, warm } from "./sample.ts";

const booted = performance.now();
// seconds one read of one file may take before a tool is left out of that file and every larger one
const LIMIT = 1;

export type Task =
  | { kind: "time"; library: string; mode: Mode; files: string[]; budget: number }
  | { kind: "tokenize"; library: string; files: string[]; budget: number }
  | { kind: "generate"; library: string; sourceMap: boolean; files: string[]; budget: number }
  | { kind: "match"; matcher: string; files: string[]; budget: number }
  | { kind: "validate"; validator: string; files: string[]; budget: number }
  | { kind: "phases"; mode: Mode; files: string[]; budget: number }
  | { kind: "cold"; library: string; mode: Mode; file: string }
  | { kind: "memory"; library: string; mode: Mode; file: string }
  | { kind: "compete"; tool: string; files: string[]; budget: number }
  | { kind: "check"; tool: string; files: string[]; nodes: boolean };

const task: Task = JSON.parse(process.argv[2]!);
const keys = "files" in task ? task.files : [task.file];
const groups = new Set(keys.map((key) => key.slice(0, key.indexOf("/")) as File["group"]));
const sources = new Map(load(groups).map((file) => [`${file.group}/${file.name}`, file.source]));
const source = (key: string) => sources.get(key)!;
const where: Where = typeof Bun === "undefined" ? "node" : "bun";
const library = "library" in task ? LIBRARIES.find((library) => library.name === task.library)! : undefined;

process.stdout.write(JSON.stringify(await run(task)));

async function run(task: Task): Promise<unknown> {
  switch (task.kind) {
    case "time": {
      const parse = await library!.load(task.mode);
      return each(task.files, task.budget, (text) => () => parse(text));
    }
    case "tokenize": {
      const tokenize = await library!.tokenizer!();
      return each(task.files, task.budget, (text) => () => tokenize(text));
    }
    case "generate": {
      const generate = await library!.generator!(task.sourceMap);
      const { parse } = await import("css-tree");
      // css-tree's tree with its defaults, values parsed, and positions for the source map, built untimed
      return each(task.files, task.budget, (text) => {
        const tree = parse(text, { positions: true });
        return () => generate(tree);
      });
    }
    case "match": {
      const matcher = MATCHERS[task.matcher]!;
      const match = await matcher.load();
      const inputs = new Map(await Promise.all(task.files.map(async (key) => [key, await matcher.prepare(source(key))] as const)));
      return measure(task.files.map((key) => ({ bytes: Buffer.byteLength(source(key)), run: () => match(inputs.get(key)) })), task.budget);
    }
    case "validate": {
      const validate = await VALIDATORS[task.validator]!();
      return each(task.files, task.budget, (text) => () => validate(text));
    }
    case "phases": {
      const { phases } = await import("./yuku-phases.ts");
      const options = { positions: task.mode.positions, parseValue: task.mode.values === "parsed" };
      warm(
        task.files.map((key) => () => {
          const { run, done } = phases(source(key), options);
          for (const phase of Object.values(run)) phase();
          done();
        }),
      );
      return task.files.map((key) => {
        const { run, done } = phases(source(key), options);
        const timings = Object.fromEntries(Object.entries(run).map(([phase, fn]) => [phase, sample(fn, task.budget)]));
        done();
        return timings;
      });
    }
    case "cold": {
      const text = source(task.file);
      const start = performance.now();
      const parse = await library!.load(task.mode);
      const loaded = performance.now();
      parse(text);
      const first = performance.now();
      parse(text);
      const second = performance.now();
      return { boot: booted, load: loaded - start, first: first - loaded, second: second - first };
    }
    case "compete": {
      const tool = COMPETITORS.find(({ name }) => name === task.tool)!;
      const run = await tool.load(where);
      const runs = task.files.map((key) => {
        const text = source(key);
        return { bytes: Buffer.byteLength(text), run: () => run(text) };
      });
      return tool.async?.includes(where) ? measureAsync(runs, task.budget) : measure(runs, task.budget);
    }
    case "check": {
      const tool = COMPETITORS.find(({ name }) => name === task.tool)!;
      const run = task.nodes ? await tool.load(where) : undefined;
      const failed: Record<string, string> = {};
      const nodes: Record<string, number> = {};
      let slow: string | undefined;
      // smallest first, so once a read passes the limit every larger file is left out unread
      for (const key of task.files.toSorted((a, b) => Buffer.byteLength(source(a)) - Buffer.byteLength(source(b)))) {
        if (slow) {
          failed[key] = slow;
          continue;
        }
        const start = performance.now();
        const reason = await tool.check(source(key));
        const seconds = (performance.now() - start) / 1000;
        if (seconds > LIMIT) {
          slow = `left out unread: ${key.slice(key.indexOf("/") + 1)} took ${seconds.toFixed(1)} s to read once`;
          failed[key] = `took ${seconds.toFixed(1)} s to read once, over the ${LIMIT} s limit`;
        } else if (reason) failed[key] = reason;
        else if (run) {
          // stylis links each node to its root and siblings, a cycle no count can walk
          try {
            nodes[key] = count(await run(source(key)));
          } catch {}
        }
      }
      return { failed, nodes };
    }
    case "memory": {
      const gc = (globalThis as { gc?: () => void }).gc!;
      const text = source(task.file);
      const parse = await library!.load(task.mode);
      parse(".a { color: red }");
      gc();
      const before = process.memoryUsage();
      const tree = parse(text);
      const peak = process.resourceUsage().maxRSS * 1024;
      gc();
      const after = process.memoryUsage();
      (globalThis as { tree?: unknown }).tree = tree;
      return {
        heap: after.heapUsed - before.heapUsed,
        external: after.external - before.external,
        peak: peak - before.rss,
      };
    }
  }
}

function each(keys: string[], budget: number, prepare: (source: string) => () => void) {
  return measure(keys.map((key) => ({ bytes: Buffer.byteLength(source(key)), run: prepare(source(key)) })), budget);
}
