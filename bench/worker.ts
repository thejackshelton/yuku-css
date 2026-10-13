// One measurement in a fresh process, run by bench/full.ts. The task comes as JSON in argv[2],
// the result goes as JSON to stdout.
import { LIBRARIES, type Mode } from "./adapters.ts";
import { type File, load } from "./corpus.ts";
import { measure, sample, warm } from "./sample.ts";

const booted = performance.now();

export type Task =
  | { kind: "time"; library: string; mode: Mode; files: string[]; budget: number }
  | { kind: "tokenize"; library: string; files: string[]; budget: number }
  | { kind: "generate"; library: string; sourceMap: boolean; files: string[]; budget: number }
  | { kind: "phases"; mode: Mode; files: string[]; budget: number }
  | { kind: "cold"; library: string; mode: Mode; file: string }
  | { kind: "memory"; library: string; mode: Mode; file: string };

const task: Task = JSON.parse(process.argv[2]!);
const keys = "files" in task ? task.files : [task.file];
const groups = new Set(keys.map((key) => key.slice(0, key.indexOf("/")) as File["group"]));
const sources = new Map(load(groups).map((file) => [`${file.group}/${file.name}`, file.source]));
const source = (key: string) => sources.get(key)!;
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
    case "phases": {
      const { phases } = await import("./yuku-phases.ts");
      const options = { positions: task.mode.positions };
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
