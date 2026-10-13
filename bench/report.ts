// Writes docs/benchmark.md and its charts from a results file: `node bench/report.ts [results.json]`.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { LIBRARIES, type Mode } from "./adapters.ts";
import { chart } from "./chart.ts";
import { BUCKETS, quantile, type Timing } from "./sample.ts";

type Results = any;
interface Config {
  id: string;
  library: string;
  mode: Mode;
}
interface Total {
  files: number;
  bytes: number;
  median: number;
  p95: number;
  nodes: number;
}
interface Memory {
  heap: number;
  external: number;
  peak: number;
}

const DOCS = new URL("../docs/", import.meta.url);
const README = new URL("../README.md", import.meta.url);
const LABEL = 210;
const median = (values: number[]) => quantile(values, 0.5);
const library = (name: string) => LIBRARIES.find((library) => library.name === name)!;

export function report(results: Results): void {
  const configs: Config[] = results.configs;
  const files: { key: string; group: string; name: string; bytes: number; bucket: string }[] = results.files;
  const bytes = Object.fromEntries(files.map((file) => [file.key, file.bytes]));
  const short = (key: string) => key.slice(key.indexOf("/") + 1);
  const runtimes = Object.keys(results.time);
  const title = (runtime: string) => (runtime === "node" ? `Node.js ${results.runtimes.node.slice(1)}` : `Bun ${results.runtimes.bun}`);

  const yuku = configs.find((config) => config.library === "yuku-css")!;
  const twin = configs.find((config) => config.library === "css-tree" && sameMode(config.mode, yuku.mode))!;
  const defaults = configs.find((config) => config.id === "css-tree parsed nopos")!;
  const others = configs.filter((config) => !config.library.startsWith("yuku-css") && config.library !== "css-tree");
  const headline = [yuku, twin, defaults, ...others];
  // the yuku-css configuration doing the same work, if there is one
  const same = (config: Config) =>
    library(config.library).note ? undefined : configs.find((other) => other.library === "yuku-css" && sameMode(other.mode, config.mode));
  const name = (config: Config) => {
    if (config === yuku) return "yuku-css";
    if (config === twin) return "css-tree, same work";
    if (config === defaults) return "css-tree, defaults";
    return config.library === "yuku-css" || config.library === "css-tree" ? `${config.library}, ${describe(config.mode)}` : config.library;
  };
  const extra = (mode: Mode) => library("yuku-css").extra?.(mode);
  const work = (config: Config) => {
    const what = [describe(config.mode), library(config.library).note].filter(Boolean).join("; ");
    if (config.library === "yuku-css") return [what, extra(config.mode)].filter(Boolean).join("; ");
    if (!same(config)) return `${what} (**not the same work**)`;
    return extra(config.mode) ? `${what} (same as yuku-css, less its ${extra(config.mode)})` : `${what} (same as yuku-css)`;
  };
  const color = (config: Config) => library(config.library).color;

  // the files every given configuration parsed cleanly
  const clean = (ids: string[], keys: string[]) => keys.filter((key) => ids.every((id) => !(key in results.gate.failed[id])));
  const total = (timings: Record<string, Timing[]>, keys: string[], nodes?: Record<string, number>): Total => {
    const sum = { files: keys.length, bytes: 0, median: 0, p95: 0, nodes: 0 };
    for (const key of keys) {
      sum.median += median(timings[key]!.map((run) => run.median));
      sum.p95 += median(timings[key]!.map((run) => run.p95));
      sum.nodes += nodes?.[key] ?? 0;
      sum.bytes += bytes[key]!;
    }
    return sum;
  };
  const parse = (runtime: string, config: Config, keys: string[]) => total(results.time[runtime][config.id], keys, results.gate.nodes[config.id]);
  const page = (config: Config, keys: string[]) => total(results.browser[config.id], keys, results.gate.nodes[config.id]);
  const one = (runtime: string, config: Config, key: string) => {
    const runs = results.time[runtime][config.id][key] as Timing[] | undefined;
    return runs && { median: median(runs.map((run) => run.median)), p95: median(runs.map((run) => run.p95)) };
  };

  const all = files.filter((file) => file.group !== "overhead").map((file) => file.key);
  const markless = files.filter((file) => file.group === "markless").map((file) => file.key);
  const corpus = clean(configs.map((config) => config.id), markless);
  const everything = clean(configs.map((config) => config.id), all);
  const pair = clean([yuku.id, twin.id], all);
  const printable = clean(["css-tree parsed"], all);
  const inBucket = (keys: string[], bucket: string) => keys.filter((key) => files.find((file) => file.key === key)!.bucket === bucket);
  const buckets = BUCKETS.map(({ name }) => ({ bucket: name, keys: inBucket(pair, name) }))
    .filter(({ keys }) => keys.length)
    .map(({ bucket, keys }) => ({ bucket, keys, yuku: parse("node", yuku, keys), twin: parse("node", twin, keys) }));
  const browsed = configs.filter((config) => results.browser[config.id]);
  const browserCorpus = clean(browsed.map((config) => config.id), markless);
  const large = files.filter((file) => file.bytes >= 100 * 1024).map((file) => file.key);
  const memory = (config: Config, key: string, field: keyof Memory) => {
    const runs = results.memory[config.id]?.[key] as Memory[] | undefined;
    return runs && Math.max(0, median(runs.map((run) => run[field])));
  };
  const bundles = Object.entries<{ library: string; minified: number; gzip: number; brotli: number }>(results.bundle);

  const lines: string[] = [];
  const chromiumTitle = `Chromium ${results.runtimes.chromium}`;
  const everywhere = [...runtimes, "chromium"];
  const titleOf = (runtime: string) => (runtime === "chromium" ? chromiumTitle : title(runtime));
  const timingsOf = (runtime: string, config: Config): Record<string, Timing[]> | undefined =>
    runtime === "chromium" ? results.browser[config.id] : results.time[runtime][config.id];
  const sumOf = (runtime: string, config: Config, keys: string[]) => {
    const timings = timingsOf(runtime, config);
    return timings && keys.every((key) => timings[key]) ? total(timings, keys) : undefined;
  };
  const out = (...text: string[]) => lines.push(...text);
  const table = (header: string[], rows: string[][]) =>
    out(`| ${header.join(" | ")} |`, `|${header.map((_, i) => (i ? " ---: |" : " --- |")).join("")}`, ...rows.map((row) => `| ${row.join(" | ")} |`), "");
  const charts: Record<string, string> = {};

  // summary
  const node = { yuku: parse("node", yuku, corpus), twin: parse("node", twin, corpus), defaults: parse("node", defaults, corpus) };
  const bun = runtimes.includes("bun") && { yuku: parse("bun", yuku, corpus), twin: parse("bun", twin, corpus) };
  const wide = { yuku: parse("node", yuku, pair), twin: parse("node", twin, pair) };
  const lead = (bucket: (typeof buckets)[number]) => ratio(bucket.twin, bucket.yuku);
  const widest = buckets.reduce((best, bucket) => (lead(bucket) > lead(best) ? bucket : best));
  const narrowest = buckets.reduce((best, bucket) => (lead(bucket) < lead(best) ? bucket : best));
  const lightning = configs.find((config) => config.library === "lightningcss");
  const generated = results.generate?.node;
  const printed = generated && {
    yuku: total(generated["yuku-css"], printable),
    twin: total(generated["css-tree"], printable),
    yukuMap: total(generated["yuku-css map"], printable),
    twinMap: total(generated["css-tree map"], printable),
  };
  const validatedKeys = results.validate?.node && Object.keys(results.validate.node["yuku-css"]);
  const validated = validatedKeys && {
    yuku: total(results.validate.node["yuku-css"], validatedKeys.filter((key: string) => key.startsWith("markless/"))),
    twin: total(results.validate.node["css-tree"], validatedKeys.filter((key: string) => key.startsWith("markless/"))),
  };
  const tokenized = results.tokenize.node?.["yuku-css"] && {
    yuku: total(results.tokenize.node["yuku-css"], pair),
    twin: total(results.tokenize.node["css-tree"], pair),
  };
  const chromium = results.browser[yuku.id] && results.browser[twin.id] && { yuku: page(yuku, browserCorpus), twin: page(twin, browserCorpus) };

  const beaten = runtimes.flatMap((runtime) =>
    files
      .filter((file) => file.group !== "markless")
      .flatMap((file) => {
        const own = one(runtime, yuku, file.key);
        const faster = headline.flatMap((config) => {
          const other = config === yuku ? undefined : one(runtime, config, file.key);
          return own && other && other.median < own.median ? [`${name(config)} (${times(own, other)})`] : [];
        });
        return faster.length ? [`on ${file.name} on ${title(runtime)}, ${list(faster)} parse faster`] : [];
      }),
  );
  const smaller = bundles.filter(([, size]) => !size.library.startsWith("yuku-css") && size.gzip < results.bundle["yuku-css"].gzip).map(([entry, size]) => `\`${entry}\` (${kb(size.gzip)})`);
  const biggest = large.toSorted((a, b) => bytes[b]! - bytes[a]!).find((key) => memory(yuku, key, "external") !== undefined && memory(twin, key, "peak") !== undefined)!;
  const against = (field: keyof Memory) =>
    median(
      large.flatMap((key) => {
        const own = memory(yuku, key, field);
        const other = memory(twin, key, field);
        return own && other ? [own / other] : [];
      }),
    );
  const losses = [
    ...beaten,
    `it holds more memory outside the JS heap: after parsing ${short(biggest)} its WebAssembly memory has grown to ${mb(memory(yuku, biggest, "external")!)}, and on files of 100 KB or more its peak resident memory is a median ${against("peak").toFixed(2)}× css-tree's, though its tree retains ${against("heap").toFixed(2)}× the JS heap css-tree's does`,
    smaller.length && `${list(smaller)} download less than its ${kb(results.bundle["yuku-css"].gzip)} gzipped`,
  ].filter(Boolean);

  out(
    "# Benchmark",
    "",
    `yuku-css ${results.libraries["yuku-css"]} against [Lightning CSS](https://lightningcss.dev) ${results.libraries.lightningcss}, its fastest rival, and [css-tree](https://github.com/csstree/csstree) ${results.libraries["css-tree"]}, whose tree it builds, with [PostCSS](https://postcss.org) for context, on an ${results.machine.cpu}, ${results.date}. Run it with \`bun run bench:full\`; the raw data is in [bench/results/${results.date}.json](../bench/results/${results.date}.json).`,
    "",
  );
  lightningSection();
  out(
    "## Summary",
    "",
    [
      `On ${corpus.length} Markless style sheets, yuku-css parses a file in ${us(per(node.yuku))} on ${title("node")}, ${times(node.twin, node.yuku)} faster than css-tree building the same tree: selectors, values and at-rule preludes parsed, positions on${bun ? `; ${times(bun.twin, bun.yuku)} on ${title("bun")}` : ""}${chromium ? `, and ${times(chromium.twin, chromium.yuku)} in Chromium` : ""}.`,
      `Over all ${pair.length} files both parse cleanly, ${mb(wide.yuku.bytes)} of CSS, it reads ${mbps(wide.yuku)} against css-tree's ${mbps(wide.twin)}; the lead is widest on files of ${widest.bucket} (${times(widest.twin, widest.yuku)}) and narrowest on ${narrowest.bucket} (${times(narrowest.twin, narrowest.yuku)}).`,
      `css-tree's defaults, which give no positions, take ${times(node.defaults, node.yuku)} as long${lightning ? `, and Lightning CSS's native addon, which parses values into typed structures and prints CSS back, ${times(parse("node", lightning, corpus), node.yuku)}` : ""}.`,
      printed && `Printing css-tree's own tree back to CSS, \`yuku-css/codegen\` takes ${us(per(printed.yuku))} a file against css-tree's ${us(per(printed.twin))} (${times(printed.twin, printed.yuku)}), and with a source map ${us(per(printed.yukuMap))} against ${us(per(printed.twinMap))} (${times(printed.twinMap, printed.yukuMap)}).`,
      validated && `Validating every declaration of a file with \`yuku-css/lexer\`'s \`matchStylesheet\` takes ${us(per(validated.yuku))} on the Markless corpus against ${us(per(validated.twin))} for css-tree parsing it and calling \`matchDeclaration\` on each declaration (${times(validated.twin, validated.yuku)}).`,
      tokenized && `Its \`tokenize\` takes ${us(per(tokenized.yuku))} a file against css-tree's ${us(per(tokenized.twin))} (${times(tokenized.twin, tokenized.yuku)}).`,
      `Where yuku-css loses: ${losses.join("; ")}.`,
    ]
      .filter(Boolean)
      .join(" "),
    "",
  );
  charts.corpus = chart(
    [{ bars: headline.map((config) => bar(name(config), color(config), per(parse("node", config, corpus)))) }],
    { labelWidth: LABEL },
  );
  out(`![Time per file to parse the Markless corpus on ${title("node")}](benchmark/corpus.svg)`, "", `Median time per file, ${corpus.length} Markless files, ${title("node")}.`, "");

  // parse time
  out("## Parse time", "", "Each row says the work it does. Only rows marked the same as yuku-css build what yuku-css builds; the others are context.", "");
  for (const [label, keys] of [
    ["Markless corpus", corpus],
    ["All files", everything],
  ] as const) {
    out(`### ${label}, ${keys.length} files`, "");
    table(
      ["Parser", "Work", ...runtimes.flatMap((runtime) => [`${title(runtime)}, per file`, "p95", "vs yuku-css"])],
      configs.map((config) => [
        name(config),
        work(config),
        ...runtimes.flatMap((runtime) => {
          const own = parse(runtime, config, keys);
          return [us(per(own)), us(own.p95 / own.files), config.library === "yuku-css" ? "" : times(own, parse(runtime, same(config) ?? yuku, keys))];
        }),
      ]),
    );
  }

  out("### By size", "", `Throughput on ${title("node")}, by file size, on the ${pair.length} files both yuku-css and css-tree parse cleanly, less any a context parser leaves out.`, "");
  table(
    ["Size", "Files", ...headline.map(name), "css-tree, same work, vs yuku-css"],
    buckets.map(({ bucket, keys, yuku: own, twin: other }) => [
      bucket,
      String(keys.length),
      ...headline.map((config) => mbps(parse("node", config, clean([config.id], keys)))),
      times(other, own),
    ]),
  );
  charts.buckets = chart(
    buckets.map(({ bucket, yuku: own, twin: other }) => ({
      title: bucket,
      bars: [
        { label: name(yuku), color: color(yuku), value: throughput(own), text: mbps(own) },
        { label: name(twin), color: color(twin), value: throughput(other), text: mbps(other) },
      ],
    })),
    { higherIsBetter: true, labelWidth: LABEL },
  );
  out(`![Throughput by file size on ${title("node")}](benchmark/buckets.svg)`, "");

  for (const group of ["npm", "synthetic"]) {
    out(
      `### ${group === "npm" ? "Real-world CSS from npm" : "Synthetic stress files"}`,
      "",
      `Median time per parse on ${title("node")}, p95 in parentheses. A dash marks a parse that reported errors.`,
      "",
    );
    table(
      ["File", "Size", ...headline.map(name), "css-tree, same work, vs yuku-css"],
      files
        .filter((file) => file.group === group)
        .map((file) => {
          const cell = (config: Config) => {
            const timing = one("node", config, file.key);
            return timing ? `${ms(timing.median)} (${ms(timing.p95)})` : "–";
          };
          const own = one("node", yuku, file.key);
          const other = one("node", twin, file.key);
          return [file.name, kb(file.bytes), ...headline.map(cell), own && other ? times(other, own) : "–"];
        }),
    );
  }

  // per node
  out(
    "## Cost per node",
    "",
    "Every tree's nodes are counted the same way: each object with a string `type`, reached through fields and lists. yuku-css builds css-tree's tree, so with the same work the counts differ only where the two read CSS differently; with values parsed, both have a node for each part of a value and prelude; PostCSS has none below a rule's selector. Lightning CSS, and yuku-css when it prints, transforms or is read for diagnostics only, return no tree. Each row covers the files it parses cleanly.",
    "",
  );
  const counted = configs.filter((config) => !config.library.startsWith("lightningcss") && config.library !== "yuku-css print" && config.library !== "yuku-css transform" && config.library !== "yuku-css diagnostics");
  table(
    ["Parser", "Files", "Nodes", ...runtimes.map((runtime) => `${title(runtime)}, ns per node`), ...runtimes.map((runtime) => `${title(runtime)}, MB/s`)],
    counted.map((config) => {
      const keys = clean([config.id], all);
      const totals = runtimes.map((runtime) => parse(runtime, config, keys));
      return [
        name(config),
        String(keys.length),
        totals[0]!.nodes.toLocaleString("en"),
        ...totals.map((sum) => ((sum.median * 1e6) / sum.nodes).toFixed(1)),
        ...totals.map(mbps),
      ];
    }),
  );

  // phases
  const phased = Object.keys(results.phases);
  if (phased.length) {
    out(
      "## Where yuku-css spends its time",
      "",
      `Its \`parse\` has three steps: encoding the source to UTF-8 in WebAssembly memory, parsing and serializing the tree in WebAssembly, and decoding the tree into JS objects. Each step is timed on its own (bench/yuku-phases.ts), per file, ${describe(yuku.mode)}, over the files yuku-css parses cleanly.`,
      "",
    );
    const keys = clean([yuku.id], all);
    table(
      ["Runtime", "Size", "Encode", "Parse and serialize", "Decode", "Sum", "Whole parse"],
      phased.flatMap((runtime) =>
        [...BUCKETS.map(({ name }) => name), "All"].flatMap((bucket) => {
          const chosen = bucket === "All" ? keys : inBucket(keys, bucket);
          if (!chosen.length) return [];
          const sums = ["encode", "wasm", "decode"].map((phase) =>
            chosen.reduce((sum, key) => sum + median(results.phases[runtime][key].map((run: Record<string, Timing>) => run[phase]!.median)), 0),
          );
          const sum = sums.reduce((a, b) => a + b, 0);
          const each = (value: number) => ms(value / chosen.length);
          return [[title(runtime), bucket, ...sums.map((value) => `${each(value)} (${percent(value / sum)})`), each(sum), each(parse(runtime, yuku, chosen).median)]];
        }),
      ),
    );
  }

  // tokenizing
  const tokenizers = Object.keys(results.tokenize.node ?? {});
  if (tokenizers.length) {
    out(
      "## Tokenizing",
      "",
      `yuku-css's \`tokenize\` returns every token packed into a \`Uint32Array\`, type and end offset, as css-tree packs its \`offsetAndType\`. css-tree's \`tokenize\` calls back once for each token, timed here counting them. Both on the ${pair.length} files yuku-css and css-tree parse cleanly.`,
      "",
    );
    table(
      ["Runtime", "Tokenizer", "Per file", "MB/s", "vs yuku-css", "Share of its same-work parse"],
      runtimes.flatMap((runtime) =>
        tokenizers.map((tokenizer) => {
          const own = total(results.tokenize[runtime][tokenizer], pair);
          const parser = tokenizer === "yuku-css" ? yuku : twin;
          return [
            title(runtime),
            tokenizer,
            us(per(own)),
            mbps(own),
            tokenizer === "yuku-css" ? "" : times(own, total(results.tokenize[runtime]["yuku-css"], pair)),
            percent(own.median / parse(runtime, parser, pair).median),
          ];
        }),
      ),
    );
  }

  // printing
  if (results.generate) {
    out(
      "## Printing",
      "",
      `\`generate\` from \`yuku-css/codegen\` against css-tree's \`generate\`, both printing css-tree's own tree of each file, values parsed and positions on, built before timing. Both print the same bytes; with \`sourceMap: true\` each also builds a source map, timed through \`map.toString()\`. On the ${printable.length} files css-tree parses cleanly that way.`,
      "",
    );
    const printers = Object.keys(results.generate.node);
    table(
      ["Runtime", "Printer", "Per file", "MB/s", "vs yuku-css"],
      Object.keys(results.generate).flatMap((runtime) =>
        printers.map((printer) => {
          const own = total(results.generate[runtime][printer], printable);
          const mine = printer.startsWith("yuku-css") ? undefined : printer.replace("css-tree", "yuku-css");
          return [
            title(runtime),
            printer.replace(" map", ", source map"),
            us(per(own)),
            mbps(own),
            mine ? times(own, total(results.generate[runtime][mine], printable)) : "",
          ];
        }),
      ),
    );
    charts.generate = chart(
      [
        {
          bars: printers.map((printer) =>
            bar(printer.replace(" map", ", source map"), library(printer.split(" ")[0]!).color, per(total(results.generate.node[printer], printable))),
          ),
        },
      ],
      { labelWidth: LABEL },
    );
    out(`![Time per file to print css-tree's tree on ${title("node")}](benchmark/generate.svg)`, "");
  }

  // validating
  if (validatedKeys) {
    const groups = [
      ["Markless corpus", validatedKeys.filter((key: string) => key.startsWith("markless/"))],
      ["npm", validatedKeys.filter((key: string) => key.startsWith("npm/"))],
      ["Synthetic", validatedKeys.filter((key: string) => key.startsWith("synthetic/"))],
    ].filter(([, keys]) => keys.length) as [string, string[]][];
    out(
      "## Validating",
      "",
      `\`matchStylesheet\` from \`yuku-css/lexer\` parses a style sheet and matches every declaration against the grammar in one WebAssembly call; each result's \`matched\` and \`error\` are read, which builds css-tree's match tree and error. css-tree validates by parsing with values and calling \`lexer.matchDeclaration\` on each declaration, which builds both at once. \`yuku-css unread\` reads neither, as a caller that only counts errors would not. The grammars differ, yuku-css's from @webref/css and css-tree's from mdn-data, so the trees and errors are the same only where the grammars agree. On the ${validatedKeys.length} files both parse cleanly.`,
      "",
    );
    table(
      ["Runtime", "Validator", ...groups.flatMap(([group, keys]) => [`${group}, per file (${keys.length} files)`, "MB/s"]), "vs yuku-css"],
      Object.keys(results.validate).flatMap((runtime) =>
        Object.keys(results.validate[runtime]).map((validator) => [
          title(runtime),
          validator,
          ...groups.flatMap(([, keys]) => {
            const own = total(results.validate[runtime][validator], keys);
            return [ms(per(own)), mbps(own)];
          }),
          validator === "yuku-css" ? "" : times(total(results.validate[runtime][validator], validatedKeys), total(results.validate[runtime]["yuku-css"], validatedKeys)),
        ]),
      ),
    );
  }

  // cold start
  out(
    "## Cold start",
    "",
    `The median of ${results.settings.cold} fresh processes. Load is the \`import\` of the library, which for yuku-css includes compiling its WebAssembly. First and second are the first two parses in that process. Warm is the median from the parse timings.`,
    "",
  );
  const coldFiles = Object.keys(Object.values<Record<string, unknown>>(results.cold.node)[0]!);
  const coldOf = (runtime: string, lib: string, key: string) => results.cold[runtime][lib][key] as { load: number; first: number; second: number }[];
  table(
    ["Runtime", "File", "Parser", "Load", "First parse", "Second parse", "Warm parse", "Load and first parse"],
    Object.keys(results.cold).flatMap((runtime) =>
      coldFiles.flatMap((key) =>
        Object.keys(results.cold[runtime]).map((lib) => {
          const runs = coldOf(runtime, lib, key);
          const warm = one(runtime, configs.find((config) => config.library === lib)!, key);
          return [
            title(runtime),
            `${short(key)} (${kb(bytes[key]!)})`,
            lib,
            ms(median(runs.map((run) => run.load))),
            ms(median(runs.map((run) => run.first))),
            ms(median(runs.map((run) => run.second))),
            warm ? ms(warm.median) : "–",
            ms(median(runs.map((run) => run.load + run.first))),
          ];
        }),
      ),
    ),
  );
  charts.cold = chart(
    coldFiles.map((key) => ({
      title: `${short(key)} (${kb(bytes[key]!)})`,
      bars: Object.keys(results.cold.node).map((lib) => bar(lib, library(lib).color, median(coldOf("node", lib, key).map((run) => run.load + run.first)))),
    })),
    { labelWidth: LABEL },
  );
  out(`![Load and first parse in a fresh ${title("node")} process](benchmark/cold.svg)`, "");

  // memory
  out(
    "## Memory",
    "",
    `Each file of 100 KB or more, parsed in a fresh ${title("node")} process run with \`--expose-gc\`, median of ${results.settings.runs}. Heap is the JS heap the tree retains after a full GC. External is memory outside the JS heap, such as WebAssembly memory, which only grows. Peak is how far resident memory rose during the parse. Negative readings, which are noise, show as 0.`,
    "",
  );
  const measured = headline.filter((config) => results.memory[config.id]);
  table(
    ["File", "Size", ...measured.map((config) => `${name(config)}: heap / external / peak`)],
    large.map((key) => [
      short(key),
      kb(bytes[key]!),
      ...measured.map((config) =>
        memory(config, key, "heap") === undefined ? "–" : (["heap", "external", "peak"] as const).map((field) => mb(memory(config, key, field)!)).join(" / "),
      ),
    ]),
  );

  // bundle
  out(
    "## Bundle size",
    "",
    "What a browser downloads to parse: the library bundled by [Rolldown](https://rolldown.rs) for the browser and minified, keeping only its parse function (`transform` for Lightning CSS and for `yuku-css transform`, `generate` for `yuku-css/codegen`), plus any file it fetches beside the JS. yuku-css inlines its WebAssembly into the JS as base64. Lightning CSS's WebAssembly is a separate file; its native addon does not run in a browser.",
    "",
  );
  table(
    ["Entry", "Minified", "gzip", "brotli"],
    bundles.map(([entry, size]) => [entry.includes(" ") ? entry : `\`${entry}\``, kb(size.minified), kb(size.gzip), kb(size.brotli)]),
  );
  const charted = bundles.filter(([, size]) => size.gzip < 1024 * 1024);
  charts.bundle = chart([{ bars: charted.map(([entry, size]) => ({ label: entry, color: library(size.library).color, value: size.gzip, text: kb(size.gzip) })) }], {
    labelWidth: LABEL,
  });
  const offChart = bundles.filter(([, size]) => size.gzip >= 1024 * 1024).map(([entry]) => `\`${entry}\``);
  out(`![Bytes downloaded, gzipped](benchmark/bundle.svg)`, "", offChart.length ? `Gzipped. ${list(offChart)}, past 1 MB, is left off the chart.` : "Gzipped.", "");

  // browser
  if (browsed.length) {
    const keys = clean(browsed.map((config) => config.id), all);
    out(
      "## In the browser",
      "",
      `The parse timings in headless Chromium ${results.runtimes.chromium}, a fresh browser for each of ${results.settings.runs} runs, on a cross-origin isolated page, where \`performance.now()\` ticks every 5 µs. Each library is bundled by Rolldown as a consumer would bundle it.`,
      "",
    );
    table(
      ["Parser", "Work", `Markless, per file (${browserCorpus.length} files)`, "p95", "vs yuku-css", `All files, MB/s (${keys.length} files)`],
      browsed.map((config) => {
        const own = page(config, browserCorpus);
        return [
          name(config),
          work(config),
          us(per(own)),
          us(own.p95 / own.files),
          config.library === "yuku-css" ? "" : times(own, page(same(config) ?? yuku, browserCorpus)),
          mbps(page(config, keys)),
        ];
      }),
    );
    charts.browser = chart(
      [{ bars: headline.filter((config) => results.browser[config.id]).map((config) => bar(name(config), color(config), per(page(config, browserCorpus)))) }],
      { labelWidth: LABEL },
    );
    out(`![Time per file to parse the Markless corpus in Chromium](benchmark/browser.svg)`, "", `Median time per file, ${browserCorpus.length} Markless files, Chromium.`, "");
  }

  // gate
  const failures = new Map<string, { configs: string[]; reason: string }>();
  for (const config of configs)
    for (const [key, reason] of Object.entries<string>(results.gate.failed[config.id])) {
      const entry = failures.get(key) ?? { configs: [], reason };
      entry.configs.push(name(config));
      failures.set(key, entry);
    }
  out(
    "## Files left out",
    "",
    `Before timing, every configuration parses every file once. A parse that throws or reports an error is left out of that configuration's timings, and each comparison uses only the files every parser in it parsed cleanly. yuku-css parsed all ${all.length - Object.keys(results.gate.failed[yuku.id]).length} of ${all.length} cleanly.`,
    "",
  );
  table(
    ["File", "Left out of", "First error"],
    [...failures].map(([key, { configs, reason }]) => [short(key), configs.join("; "), reason.replaceAll("|", "\\|")]),
  );

  // methodology
  const group = (name: string) => files.filter((file) => file.group === name).length;
  out(
    "## Methodology",
    "",
    `- **Corpus.** ${group("markless")} style sheets from the Markless repository ([test/corpus](../test/corpus)); ${group("npm")} files from npm packages, pinned by version and checked by SHA-256; ${group("synthetic")} generated stress files: deep nesting, a long selector list, huge custom properties, and many at-rules; and an empty file and a one-rule file, timed only for the cost of a call. \`node bench/corpus.ts\` fetches and generates them ([bench/corpus.ts](../bench/corpus.ts)).`,
    `- **Processes.** Each measurement runs in a fresh process, ${results.settings.runs} times, with the runs of every configuration taking turns. A file's time is the median over runs of its median; its p95 is the median over runs of its 95th percentile.`,
    `- **Sampling.** A process first parses its files in turn for at least a second, so the JIT has compiled the hot paths. It then parses each file for ${results.settings.budget / 5} ms more and samples it for ${results.settings.budget} ms and at least 10 samples (half that in the browser). A sample times enough parses to last 20 µs (500 µs in the browser), so the clock's cost and precision do not count.`,
    "- **Smallest first.** A process times its files a size bucket at a time, from the smallest, warming each bucket up first. css-tree resets its token buffers in full on every parse (`balance.fill(0)` in its `TokenStream`), and they keep the size of the largest source it has parsed: in a one-off check, `.a { color: red }` took 1.4 µs to parse before a 3.6 MB file and 60 µs after. Timing small files after large ones would charge css-tree for that.",
    "- **Per file** is the sum of the files' medians over the number of files, as in the README chart. **MB/s** is the files' bytes over that sum.",
    "- **Same work.** yuku-css and css-tree get the same options: `parseValue` and `parseAtrulePrelude` on and `parseCustomProperty` off, which is what yuku-css builds by default, and `positions` on, so both build css-tree's `loc` with lines and columns. Rows with values raw turn the first two off for both. css-tree's defaults are the same with positions off. Without positions yuku-css still gives each node `start` and `end` offsets, so it does more than css-tree there. Each library is called through one adapter in [bench/adapters.ts](../bench/adapters.ts), so after an API change only the adapter changes.",
    "- **Lightning CSS** has no parse-only API in JS. It is timed calling `transform({ filename, code, minify: false })`, which parses into typed structures, values included, and prints CSS back with no minifying and no targets, so nothing is lowered. Encoding the source string to bytes is part of the timed call, as it is in yuku-css's `parse`.",
    "",
    "| | |",
    "| --- | --- |",
    `| Machine | ${results.machine.cpu}, ${results.machine.cores} cores, ${Math.round(results.machine.memory / 2 ** 30)} GB, ${results.machine.os} |`,
    `| Runtimes | Node.js ${results.runtimes.node.slice(1)}, Bun ${results.runtimes.bun}, Chromium ${results.runtimes.chromium} |`,
    `| Libraries | ${Object.entries(results.libraries).map(([lib, version]) => `${lib} ${version}`).join(", ")} |`,
    `| Duration | ${Math.round(results.durations.total / 60)} min: ${Object.entries<number>(results.durations).filter(([part]) => part !== "total").map(([part, seconds]) => `${part} ${Math.round(seconds)} s`).join(", ")} |`,
    "",
    "## Caveats",
    "",
    "- The trees are not identical even when the work is the same: where css-tree reads CSS otherwise than the CSS specifications, yuku-css follows the specifications, and it collects every comment, which css-tree does only when given `onComment`. [test/divergences.ts](../test/divergences.ts) lists every difference.",
    "- css-tree reads a nested rule that starts with a type selector, such as `html.dark & {}`, as a declaration and reports an error, which is why it leaves out most of the Markless files it does.",
    "- css-tree is imported from its main entry, which also loads its lexer and syntax data. `css-tree/parser` loads less; its bundle size is listed.",
    "- yuku-css's WebAssembly memory grows to fit the largest file it has parsed and does not shrink until it has passed 128 MB and a small file comes, so its external memory is a high-water mark.",
    "- One machine, one run of the suite: differences under about 5% are noise.",
    "",
  );

  mkdirSync(new URL("benchmark/", DOCS), { recursive: true });
  for (const [file, svg] of Object.entries(charts)) writeFileSync(new URL(`benchmark/${file}.svg`, DOCS), svg);
  writeFileSync(new URL("benchmark.md", DOCS), lines.join("\n"));
  readme();

  // the README's benchmark section and bench/chart.svg, from the same results as docs/benchmark.md
  function readme(): void {
    const byId = (id: string) => configs.find((config) => config.id === id);
    const charted = (
      [
        ["yuku-css", "yuku-css parsed nopos"],
        ["yuku-css loc", "yuku-css parsed"],
        ["css-tree", "css-tree parsed"],
        ["postcss", "postcss raw"],
      ] as const
    ).flatMap(([label, id]) => (byId(id) ? [{ label, config: byId(id)! }] : []));
    const keys = clean(charted.map(({ config }) => config.id), markless);
    const node = title("node");
    const parsed = Object.fromEntries(charted.map(({ label, config }) => [label, parse("node", config, keys)]));
    const svg = chart([{ bars: charted.map(({ label, config }) => bar(label, color(config), per(parsed[label]!))) }], { labelWidth: 110 });
    writeFileSync(new URL("../bench/chart.svg", import.meta.url), svg);

    const inCorpus = (keys: string[]) => keys.filter((key) => key.startsWith("markless/"));
    const cell = (what: string, sum: Total) => `${what}, ${us(per(sum))}`;
    const rows: string[][] = [];
    const tokens = results.tokenize.node?.["yuku-css"] && inCorpus(pair);
    if (tokens) {
      const own = total(results.tokenize.node["yuku-css"], tokens);
      const other = total(results.tokenize.node["css-tree"], tokens);
      rows.push(["Tokenize", cell("`tokenize`", own), `${cell("css-tree `tokenize`", other)} (${times(other, own)})`, "yes"]);
    }
    if (results.generate) {
      const shown = inCorpus(printable);
      for (const map of [false, true]) {
        const own = total(results.generate.node[`yuku-css${map ? " map" : ""}`], shown);
        const other = total(results.generate.node[`css-tree${map ? " map" : ""}`], shown);
        rows.push([
          map ? "Print css-tree's tree with a source map" : "Print css-tree's tree",
          cell("`generate`", own),
          `${cell("css-tree `generate`", other)} (${times(other, own)})`,
          "yes",
        ]);
      }
    }
    if (validatedKeys) {
      const shown = inCorpus(validatedKeys);
      const own = total(results.validate.node["yuku-css"], shown);
      const other = total(results.validate.node["css-tree"], shown);
      rows.push([
        "Validate every declaration",
        cell("`lexer.matchStylesheet`", own),
        `${cell("css-tree `parse` and `matchDeclaration`", other)} (${times(other, own)})`,
        "yes, over a different grammar: @webref/css, where css-tree's is mdn-data",
      ]);
    }
    const checking = byId("yuku-css diagnostics parsed nopos");
    const plain = byId("css-tree parsed nopos");
    if (checking && plain) {
      const shown = clean([checking.id, plain.id], markless);
      const own = parse("node", checking, shown);
      const other = parse("node", plain, shown);
      rows.push([
        "Check for parse errors",
        cell("`parse`, reading only `diagnostics`", own),
        `${cell("css-tree `parse` at its defaults", other)} (${times(other, own)})`,
        "no: diagnostics only, yuku-css builds no tree in JS, where css-tree builds its whole tree",
      ]);
    }
    const transforming = byId("yuku-css transform parsed nopos");
    const native = byId("lightningcss parsed nopos");
    const wasm = byId("lightningcss-wasm parsed nopos");
    if (transforming && native && wasm) {
      const shown = clean([transforming.id, native.id, wasm.id], markless);
      const own = parse("node", transforming, shown);
      const addon = parse("node", native, shown);
      const web = parse("node", wasm, shown);
      rows.push([
        "Parse and print",
        cell("`transform`", own),
        `Lightning CSS \`transform\`: native, ${us(per(addon))} (${times(addon, own)}); WebAssembly, ${us(per(web))} (${times(web, own)})`,
        "no: Lightning CSS types every value and pretty-prints, yuku-css prints compactly",
      ]);
    }

    const section = [
      "## Benchmark",
      "",
      `Parsing the ${keys.length} style sheets of [test/corpus](test/corpus) that every parser here reads without an error. [css-tree](https://github.com/csstree/csstree) is set to build the tree \`yuku-css loc\` builds: selectors, values and at-rule preludes parsed, with positions; \`yuku-css\` gives offsets in their place. [PostCSS](https://postcss.org) keeps selectors, values and preludes as strings, so it does less.`,
      "",
      "![Time per file to parse with yuku-css, css-tree, and PostCSS](bench/chart.svg)",
      "",
      `Against \`yuku-css loc\`, css-tree takes ${times(parsed["css-tree"]!, parsed["yuku-css loc"]!)} as long. The rest of the API, per file of the same corpus, each row on the files both sides read cleanly:`,
      "",
      "| Task | yuku-css | Against | Same work |",
      "|---|---|---|---|",
      ...rows.map((row) => `| ${row.join(" | ")} |`),
      "",
      `Median time per file over ${results.settings.runs} runs, each in a fresh ${node} process on an ${results.machine.cpu}, files timed smallest first. [docs/benchmark.md](docs/benchmark.md) has Lightning CSS by file size, Bun and Chromium, real-world and synthetic CSS, cold start, memory, bundle size and where yuku-css loses. Run it with \`bun run bench:full\`; \`bun run bench\` times the chart's parsers alone, and \`bun run bench tokenize\`, \`generate\`, \`match\` or \`validate\` one row, without touching the README.`,
      "",
      "",
    ].join("\n");
    const text = readFileSync(README, "utf8");
    const start = text.indexOf("## Benchmark\n");
    const end = text.indexOf("\n## ", start + 1);
    if (start < 0 || end < 0) throw new Error("README.md has no Benchmark section to replace");
    writeFileSync(README, text.slice(0, start) + section + text.slice(end + 1));
  }

  function lightningSection(): void {
    const find = (library: string, mode: Mode) => configs.find((config) => config.library === library && sameMode(config.mode, mode));
    const offsets = find("yuku-css", { values: "parsed", positions: false });
    const printing = find("yuku-css print", { values: "parsed", positions: false });
    const transforming = find("yuku-css transform", { values: "parsed", positions: false });
    const native = find("lightningcss", { values: "parsed", positions: false });
    const wasm = find("lightningcss-wasm", { values: "parsed", positions: false });
    if (!offsets || !printing || !transforming || !native || !wasm) return;
    const rivals = [transforming, printing, offsets, native, wasm];
    const label = (config: Config) =>
      config === transforming
        ? "yuku-css `transform`"
        : config === printing
          ? "yuku-css, `parse` and `generate`"
          : config === offsets
            ? "yuku-css, parse only"
            : config.library;
    // what Lightning CSS is held against in a runtime: its addon, or its WebAssembly in the browser
    const rival = (runtime: string) => (runtime === "chromium" ? wasm : native);
    const verdict = (own: Total | undefined, other: Total | undefined) =>
      own && other ? (own.median <= other.median ? `${times(other, own)} faster` : `${times(own, other)} slower`) : "–";
    const keys = clean(rivals.map((config) => config.id), all);

    out(
      "## Against Lightning CSS",
      "",
      "Lightning CSS returns no tree to JS. Its `transform({ filename, code, minify: false })` parses every value into typed Rust structures and prints CSS back. yuku-css's `transform` does the same in kind: one WebAssembly call parses, values and at-rule preludes included, and prints CSS back, with no tree built in JS. The work still differs: Lightning CSS types every value, where yuku-css splits values and preludes into css-tree's untyped nodes, and Lightning CSS pretty-prints, where yuku-css prints compactly, as css-tree's `generate` does. yuku-css parsing with `parse` and printing with `generate` from `yuku-css/codegen`, which builds the JS tree in between, and parsing alone are listed too. Lightning CSS runs as its native Node.js addon and as `lightningcss-wasm`; in Chromium only the WebAssembly runs.",
      "",
    );

    const leads: Record<string, { bucket: string; lead: number }[]> = {};
    const rows: string[][] = [];
    for (const runtime of everywhere)
      for (const { name: bucketName } of BUCKETS) {
        const chosen = inBucket(keys, bucketName);
        if (!chosen.length) continue;
        const sums = rivals.map((config) => sumOf(runtime, config, chosen));
        const own = sums[0];
        const other = sumOf(runtime, rival(runtime), chosen);
        if (own && other) (leads[runtime] ??= []).push({ bucket: bucketName, lead: ratio(other, own) });
        rows.push([titleOf(runtime), bucketName, String(chosen.length), ...sums.map((sum) => (sum ? mbps(sum) : "–")), verdict(own, other)]);
      }
    out(
      "### By size",
      "",
      `Throughput on the ${keys.length} files that yuku-css and both builds of Lightning CSS parse cleanly. The last column sets yuku-css's \`transform\` against Lightning CSS's addon, or in Chromium its WebAssembly.`,
      "",
    );
    table(["Runtime", "Size", "Files", ...rivals.map(label), "yuku-css `transform` vs Lightning CSS"], rows);
    charts.lightning = chart(
      BUCKETS.map(({ name: bucketName }) => ({ title: bucketName, keys: inBucket(keys, bucketName) }))
        .filter(({ keys: chosen }) => chosen.length)
        .map(({ title: bucketName, keys: chosen }) => ({
          title: bucketName,
          bars: rivals.map((config) => {
            const sum = parse("node", config, chosen);
            return { label: label(config), color: color(config), value: throughput(sum), text: mbps(sum) };
          }),
        })),
      { higherIsBetter: true, labelWidth: LABEL },
    );
    out(`![Throughput by file size against Lightning CSS on ${title("node")}](benchmark/lightning.svg)`, "");

    const real = ["tailwind.css", "tailwind.min.css", "bulma.css", "primer.css", "bootstrap.css", "bootstrap.min.css", "foundation.css", "font-awesome.css"]
      .map((name) => files.find((file) => file.group === "npm" && file.name === name))
      .filter((file) => file !== undefined);
    out(
      "### Large real files",
      "",
      "Median time per parse, MB/s in parentheses. A dash marks a parse that reported errors, with the first error below.",
      "",
    );
    table(
      ["File", "Size", "Runtime", ...rivals.map(label), "yuku-css `transform` vs Lightning CSS"],
      real.flatMap((file) =>
        everywhere.map((runtime) => {
          const sums = rivals.map((config) => (file.key in results.gate.failed[config.id] ? undefined : sumOf(runtime, config, [file.key])));
          const cell = (sum: Total | undefined) => (sum ? `${ms(sum.median)} (${mbps(sum)})` : "–");
          const other = file.key in results.gate.failed[rival(runtime).id] ? undefined : sumOf(runtime, rival(runtime), [file.key]);
          return [file.name, kb(file.bytes), titleOf(runtime), ...sums.map(cell), verdict(sums[0], other)];
        }),
      ),
    );
    const rejected = real.filter((file) => file.key in results.gate.failed[native.id]);
    if (rejected.length)
      out(`Lightning CSS reports errors on ${list(rejected.map((file) => `${file.name} (${results.gate.failed[native.id][file.key]})`))}.`, "");

    const tiny = files.filter((file) => file.group === "overhead");
    if (tiny.length) {
      const called = [transforming, printing, offsets, yuku, twin, native, wasm, ...configs.filter((config) => config.library === "postcss")];
      out(
        "### Per call",
        "",
        "What one call costs when there is next to nothing to parse, so a lead on small files is not read as a lead in throughput. Median time per call.",
        "",
      );
      table(
        ["File", "Runtime", ...called.map((config) => (config === yuku ? "yuku-css, positions" : config === twin ? "css-tree, positions" : label(config)))],
        tiny.flatMap((file) =>
          everywhere.map((runtime) => [
            `${file.name} (${file.bytes} B)`,
            titleOf(runtime),
            ...called.map((config) => {
              const sum = sumOf(runtime, config, [file.key]);
              return sum ? us(sum.median) : "–";
            }),
          ]),
        ),
      );
      const empty = tiny[0]!.key;
      const call = (runtime: string, config: Config) => sumOf(runtime, config, [empty])?.median;
      const own = call("node", transforming);
      const addon = call("node", native);
      if (own !== undefined && addon !== undefined && own < addon)
        out(
          `On ${title("node")}, a call on an empty file costs yuku-css's \`transform\` ${us(own)} and the Lightning CSS addon ${us(addon)}, so on the smallest files part of yuku-css's lead is the cost of a call.`,
          "",
        );
    }

    const download = (entry: string) => results.bundle[entry]?.gzip as number | undefined;
    const cold = (lib: string) => {
      const runs = results.cold.node[lib]?.["npm/bootstrap.css"] as { load: number; first: number }[] | undefined;
      return runs && median(runs.map((run) => run.load + run.first));
    };
    const span = (values: number[]) =>
      `${Math.min(...values).toFixed(2)}× to ${Math.max(...values).toFixed(2)}×`;
    const wins: string[] = [];
    const losses: string[] = [];
    for (const runtime of everywhere) {
      const ahead = (leads[runtime] ?? []).filter(({ lead }) => lead >= 1);
      const behind = (leads[runtime] ?? []).filter(({ lead }) => lead < 1);
      const against = runtime === "chromium" ? "`lightningcss-wasm`" : "the addon";
      if (ahead.length)
        wins.push(`On ${titleOf(runtime)}, \`transform\` beats ${against} on ${behind.length ? `files of ${list(ahead.map(({ bucket }) => bucket))}` : "every size of file"}, by ${span(ahead.map(({ lead }) => lead))}.`);
      if (behind.length)
        losses.push(`On ${titleOf(runtime)}, \`transform\` is slower than ${against} on files of ${list(behind.map(({ bucket }) => bucket))}, by ${span(behind.map(({ lead }) => 1 / lead))}.`);
    }
    for (const runtime of everywhere) {
      const slower = files
        .filter((file) => file.group === "npm" || file.group === "synthetic")
        .flatMap((file) => {
          const own = file.key in results.gate.failed[transforming.id] ? undefined : sumOf(runtime, transforming, [file.key]);
          const other = file.key in results.gate.failed[rival(runtime).id] ? undefined : sumOf(runtime, rival(runtime), [file.key]);
          return own && other && other.median < own.median ? [`${file.name} (${times(own, other)})`] : [];
        });
      if (slower.length)
        losses.push(`On ${titleOf(runtime)}, \`transform\` is slower than ${runtime === "chromium" ? "`lightningcss-wasm`" : "the addon"} on ${list(slower)}.`);
    }
    const yukuBytes = download("yuku-css transform");
    if (yukuBytes && download("lightningcss-wasm"))
      wins.push(`A browser downloads ${kb(yukuBytes)} gzipped to transform with yuku-css, against ${kb(download("lightningcss-wasm")!)} for \`lightningcss-wasm\`.`);
    const coldYuku = cold("yuku-css transform");
    const coldNative = cold("lightningcss");
    if (coldYuku && coldNative)
      (coldYuku <= coldNative ? wins : losses).push(
        `In a fresh ${title("node")} process, loading the library and transforming bootstrap.css once takes yuku-css ${ms(coldYuku)}, compiling its WebAssembly included, and the Lightning CSS addon ${ms(coldNative)}.`,
      );
    losses.push(
      "Lightning CSS does more with the time: it types every value, so it can minify, lower syntax for older browsers and report invalid values, none of which yuku-css does. Its output is a normalized style sheet, where yuku-css prints its tree as written.",
    );
    out("### Where yuku-css wins", "", ...wins.map((line) => `- ${line}`), "", "### Where yuku-css loses", "", ...losses.map((line) => `- ${line}`), "");
  }
}

function sameMode(a: Mode, b: Mode): boolean {
  return a.values === b.values && a.positions === b.positions;
}

function describe({ values, positions }: Mode): string {
  return `values and preludes ${values}, ${positions ? "positions" : "no positions"}`;
}

function list(items: string[]): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

const bar = (label: string, color: string, value: number) => ({ label, color, value, text: ms(value) });
const per = (total: Total) => total.median / total.files;
const throughput = (total: Total) => total.bytes / 1e6 / (total.median / 1000);
const ratio = (slow: { median: number }, fast: { median: number }) => slow.median / fast.median;
const times = (slow: { median: number }, fast: { median: number }) => `${ratio(slow, fast).toFixed(2)}×`;
const mbps = (total: Total) => `${throughput(total).toFixed(1)} MB/s`;
const us = (milliseconds: number) => `${(milliseconds * 1000).toFixed(1)} µs`;
const ms = (milliseconds: number) => (milliseconds < 1 ? us(milliseconds) : `${milliseconds.toFixed(2)} ms`);
const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MB`;
const percent = (share: number) => `${Math.round(share * 100)}%`;

if (import.meta.main) {
  const directory = new URL("results/", import.meta.url);
  report(JSON.parse(readFileSync(process.argv[2] ?? new URL(readdirSync(directory).sort().at(-1)!, directory), "utf8")));
}
