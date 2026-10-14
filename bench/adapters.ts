// Every call into a library goes through its adapter, so the suite runs unchanged when an API
// changes: only the adapter does.

/** What the parser builds: values and at-rule preludes parsed or kept raw, with or without positions. */
export interface Mode {
  values: "raw" | "parsed";
  positions: boolean;
}

// yuku-css's default, values parsed, first: the first mode a library supports is its headline
export const MODES: Mode[] = [
  { values: "parsed", positions: true },
  { values: "parsed", positions: false },
  { values: "raw", positions: true },
  { values: "raw", positions: false },
];

export type Parse = (source: string) => unknown;

/** Prints a css-tree tree back to CSS, with a source map when asked. */
export type Generate = (tree: unknown) => unknown;

export interface Library {
  name: string;
  color: string;
  /** How its work differs from the mode it runs in, when it does. */
  note?: string;
  /** What it builds beyond `mode`, in a mode where it does more. */
  extra?(mode: Mode): string | undefined;
  /** What a consumer imports to parse, and the files it fetches beside the JS, for the bundle cost. */
  entries: { entry: string; name: string; assets?: string[]; key?: string }[];
  browser: boolean;
  load(mode: Mode): Promise<Parse>;
  /** Whether `load(mode)` builds what `mode` asks for. */
  supports(mode: Mode): Promise<boolean>;
  /** Why `source` did not parse cleanly, or undefined. */
  check(source: string, mode: Mode): Promise<string | undefined>;
  tokenizer?(): Promise<(source: string) => number>;
  generator?(sourceMap: boolean): Promise<Generate>;
}

const SAMPLE = ".a { color: red }";

const yukuCss: Library = {
  name: "yuku-css",
  color: "#FF6B35",
  entries: [{ entry: "yuku-css", name: "parse" }],
  browser: true,
  // without positions every node still has start and end offsets, which css-tree leaves out
  extra: ({ positions }) => (positions ? undefined : "start and end offsets"),
  // `ast` is built when first read, so reading it here puts building the tree in the timing
  async load(mode) {
    const { parse } = await import("yuku-css");
    const options = cssTreeOptions(mode);
    return (source) => parse(source, options).ast;
  },
  async supports(mode) {
    return honours(await this.load(mode), mode);
  },
  async check(source, mode) {
    const { parse } = await import("yuku-css");
    return errors((report) => parse(source, cssTreeOptions(mode)).diagnostics.forEach(report));
  },
  async tokenizer() {
    const { tokenize } = await import("yuku-css");
    return (source) => tokenize(source).length;
  },
  async generator(sourceMap) {
    const { generate } = await import("yuku-css/codegen");
    return sourceMap ? (tree) => generate(tree as any, { sourceMap }).map.toString() : (tree) => generate(tree as any);
  },
};

// the closest yuku-css comes to Lightning CSS's `transform`: it parses, values and preludes included, and
// prints CSS back, where `transform` parses values into typed structures and prints them
const yukuCssPrint: Library = {
  name: "yuku-css print",
  color: "#FFA07A",
  note: "parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen`",
  entries: [{ entry: "yuku-css/codegen", name: "generate" }],
  browser: true,
  async load(mode) {
    const parse = await yukuCss.load(mode);
    const { generate } = await import("yuku-css/codegen");
    return (source) => generate(parse(source) as any);
  },
  async supports(mode) {
    return mode.values === "parsed" && !mode.positions;
  },
  check: (source, mode) => yukuCss.check(source, mode),
};

// a caller that only checks for errors: `ast` is never read, so no tree is built in JS
const yukuCssDiagnostics: Library = {
  name: "yuku-css diagnostics",
  color: "#FFD3B6",
  note: "diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS",
  entries: [],
  browser: true,
  async load(mode) {
    const { parse } = await import("yuku-css");
    const options = cssTreeOptions(mode);
    return (source) => parse(source, options).diagnostics;
  },
  async supports(mode) {
    return mode.values === "parsed" && !mode.positions;
  },
  check: (source, mode) => yukuCss.check(source, mode),
};

// parses and prints in one WebAssembly call and builds no tree in JS, as Lightning CSS's `transform` does
const yukuCssTransform: Library = {
  name: "yuku-css transform",
  color: "#C1440E",
  note: "parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree",
  entries: [{ entry: "yuku-css", name: "transform", key: "yuku-css transform" }],
  browser: true,
  async load(mode) {
    const { transform } = await import("yuku-css");
    const { positions: _, ...options } = cssTreeOptions(mode);
    return (source) => transform(source, options).code;
  },
  async supports(mode) {
    return mode.values === "parsed" && !mode.positions;
  },
  check: (source, mode) => yukuCss.check(source, mode),
};

const cssTree: Library = {
  name: "css-tree",
  color: "#3A86FF",
  entries: [
    { entry: "css-tree", name: "parse" },
    { entry: "css-tree/parser", name: "default" },
  ],
  browser: true,
  async load(mode) {
    const { parse } = await import("css-tree");
    const options = cssTreeOptions(mode);
    return (source) => parse(source, options);
  },
  async supports() {
    return true;
  },
  async check(source, mode) {
    const { parse } = await import("css-tree");
    return errors((report) => parse(source, { ...cssTreeOptions(mode), onParseError: report }));
  },
  async tokenizer() {
    const { tokenize } = await import("css-tree");
    return (source) => {
      let tokens = 0;
      tokenize(source, () => tokens++);
      return tokens;
    };
  },
  async generator(sourceMap) {
    const { generate } = await import("css-tree");
    return sourceMap
      ? (tree) => (generate(tree as any, { sourceMap }) as unknown as { map: object }).map.toString()
      : (tree) => generate(tree as any);
  },
};

// Lightning CSS returns no tree to JS: `transform` parses into typed Rust structures, values
// included, and prints CSS back, with no minifying and no targets, so nothing is lowered
function lightning(name: string, color: string, browser: boolean, specifier: string, load: () => Promise<any>): Library {
  type Transform = (options: object) => { code: Uint8Array; warnings: unknown[] };
  const encoder = new TextEncoder();
  const transform = async (): Promise<Transform> => {
    const module = await load();
    await module.default?.();
    return module.transform;
  };
  return {
    name,
    color,
    note: "parses values into typed structures and prints CSS back; returns no tree",
    entries: browser ? [{ entry: specifier, name: "transform", assets: [`${specifier}/lightningcss_node.wasm`] }] : [],
    browser,
    async load() {
      const run = await transform();
      return (source) => run({ filename: "bench.css", code: encoder.encode(source), minify: false }).code;
    },
    async supports(mode) {
      return mode.values === "parsed" && !mode.positions;
    },
    async check(source) {
      const run = await transform();
      return errors((report) =>
        run({ filename: "bench.css", code: encoder.encode(source), errorRecovery: true }).warnings.forEach(report),
      );
    },
  };
}

const postcss: Library = {
  name: "postcss",
  color: "#8338EC",
  note: "keeps selectors as strings",
  entries: [{ entry: "postcss", name: "parse" }],
  browser: true,
  async load() {
    const { parse } = await import("postcss");
    return (source) => parse(source);
  },
  async supports(mode) {
    return mode.values === "raw" && mode.positions;
  },
  async check(source) {
    const { parse } = await import("postcss");
    return errors(() => parse(source));
  },
};

export const LIBRARIES: Library[] = [
  yukuCss,
  yukuCssPrint,
  yukuCssTransform,
  yukuCssDiagnostics,
  cssTree,
  lightning("lightningcss", "#F7B801", false, "lightningcss", () => import("lightningcss")),
  lightning("lightningcss-wasm", "#2EC4B6", true, "lightningcss-wasm", () => import("lightningcss-wasm")),
  postcss,
];

function cssTreeOptions({ values, positions }: Mode) {
  const parsed = values === "parsed";
  return { positions, parseValue: parsed, parseAtrulePrelude: parsed, parseCustomProperty: false };
}

function honours(parse: Parse, mode: Mode): boolean {
  const root = parse(SAMPLE) as Record<string, unknown>;
  const positioned = root.loc != null;
  let parsed = false;
  walk(root, (node) => {
    if (node.type === "Declaration") parsed = (node.value as { type: string }).type !== "Raw";
  });
  return positioned === mode.positions && parsed === (mode.values === "parsed");
}

function errors(parse: (report: (error: unknown) => void) => void): string | undefined {
  const found: unknown[] = [];
  try {
    parse((error) => found.push(error));
  } catch (error) {
    return message(error);
  }
  if (!found.length) return undefined;
  return `${found.length} error${found.length > 1 ? "s" : ""}, first: ${message(found[0])}`;
}

/** Counts the objects with a string `type`, the same way for every tree. */
export function count(tree: unknown): number {
  let nodes = 0;
  walk(tree, () => nodes++);
  return nodes;
}

function walk(value: unknown, visit: (node: Record<string, any>) => void): void {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return;
  if (Symbol.iterator in value) {
    for (const item of value as Iterable<unknown>) walk(item, visit);
    return;
  }
  const node = value as Record<string, any>;
  if (typeof node.type !== "string") return;
  visit(node);
  for (const key in node) if (key !== "loc" && key !== "parent") walk(node[key], visit);
}

function message(error: unknown): string {
  return (error as { message?: string }).message ?? String(error);
}

export function label({ values, positions }: Mode): string {
  return `${values} values, ${positions ? "positions" : "no positions"}`;
}

/** Matches every declaration of a file, its input built untimed by `prepare`. */
export interface Matcher {
  prepare(source: string): Promise<unknown>;
  load(): Promise<(input: any) => void>;
}

// every declaration as property and value text, which every lexer matches as a string
async function declarations(source: string): Promise<[string, string][]> {
  const { parse, walk } = await import("css-tree");
  const found: [string, string][] = [];
  const ast = parse(source, { parseValue: false, parseAtrulePrelude: false });
  walk(ast, { visit: "Declaration", enter: (node) => found.push([node.property, (node.value as { value: string }).value.trim()]) });
  return found;
}

// every declaration as property and css-tree's tree of the value, which both lexers match node for node
async function declarationTrees(source: string): Promise<[string, unknown][]> {
  const { parse, walk } = await import("css-tree");
  const found: [string, unknown][] = [];
  walk(parse(source), { visit: "Declaration", enter: (node) => found.push([node.property, node.value]) });
  return found;
}

// reading `matched` and `error` builds the tree and error css-tree builds
async function yukuMatch(read: boolean) {
  const { lexer } = await import("yuku-css/lexer");
  return (list: [string, unknown][]) => {
    for (const [property, value] of list) {
      const result = lexer.matchProperty(property, value as string);
      if (read) {
        void result.matched;
        void result.error;
      }
    }
  };
}

async function cssTreeMatch(lexer: { matchProperty(property: string, value: unknown): unknown }) {
  return (list: [string, unknown][]) => {
    for (const [property, value] of list) lexer.matchProperty(property, value);
  };
}

export const MATCHERS: Record<string, Matcher> = {
  "yuku-css": { prepare: declarations, load: () => yukuMatch(true) },
  // neither read, so neither built, as a caller that keeps only valid values does not
  "yuku-css unread": { prepare: declarations, load: () => yukuMatch(false) },
  // css-tree's matcher over yuku-css's grammar
  "css-tree webref": {
    prepare: declarations,
    async load() {
      const { oracle } = await import("../test/grammar/webref.ts");
      return cssTreeMatch(oracle);
    },
  },
  "yuku-css tree": { prepare: declarationTrees, load: () => yukuMatch(true) },
  "css-tree tree": { prepare: declarationTrees, load: async () => cssTreeMatch((await import("css-tree")).lexer as any) },
  "css-tree": { prepare: declarations, load: async () => cssTreeMatch((await import("css-tree")).lexer as any) },
};

/** Validates a whole style sheet: every declaration matched, its result's tree and error read. */
export const VALIDATORS: Record<string, () => Promise<(source: string) => void>> = {
  async "yuku-css"() {
    const { lexer } = await import("yuku-css/lexer");
    return (source) => {
      for (const declaration of lexer.matchStylesheet(source)) {
        void declaration.matched;
        void declaration.error;
      }
    };
  },
  async "yuku-css unread"() {
    const { lexer } = await import("yuku-css/lexer");
    return (source) => void lexer.matchStylesheet(source);
  },
  // css-tree's way: parse with values, then match each declaration's tree, which builds its match tree and error
  async "css-tree"() {
    const { lexer, parse, walk } = await import("css-tree");
    return (source) => walk(parse(source), { visit: "Declaration", enter: (node) => void lexer.matchDeclaration(node) });
  },
};

/** The yuku-css tasks every other CSS tool is set against, in the order the report ranks them. */
export const TASKS = {
  tokenize: {
    title: "Tokenize",
    reference: "`tokenize` returns every token's type and end offset packed into a `Uint32Array`",
  },
  parse: {
    title: "Parse to an AST, values parsed",
    reference: "`parse(source).ast` with its defaults: selectors, values and at-rule preludes parsed into css-tree's tree, start and end offsets on every node, no line and column positions",
  },
  raw: {
    title: "Parse to an AST, values raw",
    reference: "`parse` with `parseValue` and `parseAtrulePrelude` off: selectors parsed, values and preludes kept as raw text, offsets, no positions",
  },
  print: {
    title: "Parse and print",
    reference: "`transform` parses, values and preludes included, and prints CSS back compactly in one WebAssembly call",
  },
  format: {
    title: "Format",
    reference: "yuku-css has no formatter; its `transform`, which prints compactly, is listed for scale only",
  },
  minify: {
    title: "Minify",
    reference: "yuku-css has no minifier; its `transform`, which prints compactly but drops nothing, is listed for scale only",
  },
} as const;
export type TaskName = keyof typeof TASKS;
export type Where = "node" | "bun" | "chromium";
type Run = (source: string) => unknown;

/** One tool doing one task, timed through `load` and gated through `check`. */
export interface Competitor {
  /** Unique across tasks: the task's rows show `label`. */
  name: string;
  label: string;
  task: TaskName;
  /** Exactly what one timed call does. */
  work: string;
  /** Whether it does what the task's yuku-css reference row does. */
  equal: boolean;
  /** The package whose version is reported. */
  package: string;
  runtimes: Where[];
  /** Where the call returns a promise, awaited inside the timing. */
  async?: Where[];
  load(where: Where): Promise<Run>;
  /** Why `source` did not read cleanly, or undefined. */
  check(source: string): Promise<string | undefined>;
}

const EVERYWHERE: Where[] = ["node", "bun", "chromium"];
const NATIVE: Where[] = ["node", "bun"];
const OXC_PACKAGE = new URL("oxc/pkg/oxc_css_parser_bench_wasm.js", import.meta.url).href;

// compiled off the main thread, as Chromium compiles no module over 8 MB on it
async function wasmModule(file: string, where: Where): Promise<WebAssembly.Module> {
  if (where === "chromium") return WebAssembly.compile(await (await fetch(new URL(file, location.href))).arrayBuffer());
  const { readFileSync } = await import("node:fs");
  return WebAssembly.compile(readFileSync(new URL(file, OXC_PACKAGE)));
}

type Oxc = { parseStylesheet(source: string, syntax: string): unknown; check(source: string): string };
let oxcModule: Promise<Oxc> | undefined;
function oxc(where: Where): Promise<Oxc> {
  return (oxcModule ??= (async () => {
    // @ts-ignore built by bench/oxc.ts, untyped
    const module = await import("./oxc/pkg/oxc_css_parser_bench_wasm.js");
    module.initSync({ module: await wasmModule("oxc_css_parser_bench_wasm_bg.wasm", where) });
    return module;
  })());
}

async function yukuParse(values: Mode["values"]): Promise<Run> {
  return yukuCss.load({ values, positions: false });
}
const yukuCheck = (values: Mode["values"]) => (source: string) => yukuCss.check(source, { values, positions: false });

async function esbuildTransform(where: Where, minify: boolean): Promise<Run> {
  if (where !== "chromium") {
    const { transformSync } = await import("esbuild");
    return (source) => transformSync(source, { loader: "css", minify }).code;
  }
  const esbuild = await import("esbuild-wasm");
  await esbuild.initialize({ wasmModule: await wasmModule("esbuild.wasm", where), worker: false }).catch(() => {});
  return (source) => esbuild.transform(source, { loader: "css", minify }).then((result) => result.code);
}
const esbuildCheck = async (source: string) => {
  const { transformSync } = await import("esbuild");
  return errors((report) => transformSync(source, { loader: "css" }).warnings.forEach((warning) => report(warning.text)));
};

async function bunBuild(minify: boolean): Promise<Run> {
  return async (source) => {
    const result = await Bun.build({ entrypoints: ["/bench.css"], files: { "/bench.css": source }, external: ["*"], minify, throw: false });
    return result.outputs[0]?.text();
  };
}
const bunCheck = async (source: string) => {
  const result = await Bun.build({ entrypoints: ["/bench.css"], files: { "/bench.css": source }, external: ["*"], throw: false });
  return errors((report) => result.logs.filter((log) => log.level === "error" || log.level === "warning").forEach(report));
};

async function swcCss(): Promise<typeof import("@swc/css")> {
  return import("@swc/css");
}
const swcCheck = async (source: string) => {
  const swc = await swcCss();
  return errors((report) => swc.transformSync(Buffer.from(source), {}).errors?.forEach(report));
};

async function lightningRun(where: Where, minify: boolean): Promise<Run> {
  const encoder = new TextEncoder();
  const module: any = where === "chromium" ? await import("lightningcss-wasm") : await import("lightningcss");
  await module.default?.();
  return (source) => module.transform({ filename: "bench.css", code: encoder.encode(source), minify }).code;
}
const lightningCheck = (source: string) => LIBRARIES.find(({ name }) => name === "lightningcss")!.check(source, { values: "parsed", positions: false });

const cssTreeCheck = (values: Mode["values"]) => (source: string) => cssTree.check(source, { values, positions: false });
const csstoolsCheck = async (source: string) => {
  const { tokenize } = await import("@csstools/css-tokenizer");
  const { parseListOfComponentValues } = await import("@csstools/css-parser-algorithms");
  return errors((report) => parseListOfComponentValues(tokenize({ css: source }, { onParseError: report }), { onParseError: report }));
};
const cssoCheck = async (source: string) => {
  const { syntax } = await import("csso");
  return errors((report) => syntax.parse(source, { onParseError: report } as object));
};
const adobeCheck = async (source: string) => {
  const { parse } = await import("@adobe/css-tools");
  return errors((report) => parse(source, { silent: true }).stylesheet.parsingErrors?.forEach(report));
};
const postcssCheck = (source: string) => postcss.check(source, { values: "raw", positions: true });

async function biome(where: Where): Promise<Run> {
  if (where === "chromium") {
    await (await import("@biomejs/wasm-web")).default({ module_or_path: await wasmModule("biome_wasm_bg.wasm", where) });
    const { Biome } = await import("@biomejs/js-api/web");
    const instance = new Biome();
    const { projectKey } = instance.openProject();
    return (source) => instance.formatContent(projectKey, source, { filePath: "bench.css" }).content;
  }
  const { Biome } = await import("@biomejs/js-api/nodejs");
  const instance = new Biome();
  const { projectKey } = instance.openProject();
  return (source) => instance.formatContent(projectKey, source, { filePath: "bench.css" }).content;
}
let biomeChecker: Promise<(source: string) => { diagnostics: { description: string }[] }> | undefined;
const biomeCheck = async (source: string) => {
  const format = await (biomeChecker ??= (async () => {
    const { Biome } = await import("@biomejs/js-api/nodejs");
    const instance = new Biome();
    const { projectKey } = instance.openProject();
    return (text: string) => instance.formatContent(projectKey, text, { filePath: "bench.css" });
  })());
  return errors((report) => format(source).diagnostics.forEach((diagnostic) => report(diagnostic.description)));
};

async function prettier(where: Where): Promise<Run> {
  if (where === "chromium") {
    const { format } = await import("prettier/standalone");
    const postcssPlugin = await import("prettier/plugins/postcss");
    return (source) => format(source, { parser: "css", plugins: [postcssPlugin] });
  }
  const { format } = await import("prettier");
  return (source) => format(source, { parser: "css" });
}

export const COMPETITORS: Competitor[] = [
  {
    name: "tokenize yuku-css",
    label: "yuku-css `tokenize`",
    task: "tokenize",
    work: TASKS.tokenize.reference,
    equal: true,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: async () => (await yukuCss.tokenizer!()),
    check: async () => undefined,
  },
  {
    name: "tokenize css-tree",
    label: "css-tree `tokenize`",
    task: "tokenize",
    work: "calls back once per token with its type and offsets, counted here",
    equal: true,
    package: "css-tree",
    runtimes: EVERYWHERE,
    load: async () => (await cssTree.tokenizer!()),
    check: async () => undefined,
  },
  {
    name: "tokenize csstools",
    label: "@csstools/css-tokenizer",
    task: "tokenize",
    work: "`tokenize({ css })` returns an array per token: its type, text, offsets and decoded value (number, unit, unescaped name)",
    equal: false,
    package: "@csstools/css-tokenizer",
    runtimes: EVERYWHERE,
    async load() {
      const { tokenize } = await import("@csstools/css-tokenizer");
      return (source) => tokenize({ css: source }).length;
    },
    async check(source) {
      const { tokenize } = await import("@csstools/css-tokenizer");
      return errors((report) => tokenize({ css: source }, { onParseError: report }));
    },
  },
  {
    name: "parse yuku-css",
    label: "yuku-css",
    task: "parse",
    work: TASKS.parse.reference,
    equal: true,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: () => yukuParse("parsed"),
    check: yukuCheck("parsed"),
  },
  {
    name: "parse css-tree",
    label: "css-tree",
    task: "parse",
    work: "`parse` with values and preludes parsed and positions off: the same tree, less yuku-css's start and end offsets",
    equal: true,
    package: "css-tree",
    runtimes: EVERYWHERE,
    load: () => cssTree.load({ values: "parsed", positions: false }),
    check: cssTreeCheck("parsed"),
  },
  {
    name: "parse csso",
    label: "csso `syntax.parse`",
    task: "parse",
    work: "csso's bundled css-tree 2 parser with its defaults: the same tree as css-tree, values and preludes parsed, no positions",
    equal: true,
    package: "csso",
    runtimes: EVERYWHERE,
    async load() {
      const { syntax } = await import("csso");
      return (source) => syntax.parse(source);
    },
    check: cssoCheck,
  },
  {
    name: "parse oxc",
    label: "oxc-css-parser (WebAssembly)",
    task: "parse",
    work: "oxc's parser for oxfmt, built from its own `wasm/` crate: parses into its typed Rust AST, values parsed, spans on every node, then converts it to JS objects with serde-wasm-bindgen. A different tree from css-tree's",
    equal: false,
    package: "oxc-css-parser",
    runtimes: EVERYWHERE,
    async load(where) {
      const { parseStylesheet } = await oxc(where);
      return (source) => parseStylesheet(source, "css");
    },
    async check(source) {
      return (await oxc("node")).check(source) || undefined;
    },
  },
  {
    name: "parse csstools",
    label: "@csstools/css-parser-algorithms",
    task: "parse",
    work: "`parseListOfComponentValues(tokenize({ css }))`: tokens grouped into blocks and functions, with no rules, declarations or selectors",
    equal: false,
    package: "@csstools/css-parser-algorithms",
    runtimes: EVERYWHERE,
    async load() {
      const { tokenize } = await import("@csstools/css-tokenizer");
      const { parseListOfComponentValues } = await import("@csstools/css-parser-algorithms");
      return (source) => parseListOfComponentValues(tokenize({ css: source }));
    },
    check: csstoolsCheck,
  },
  {
    name: "raw yuku-css",
    label: "yuku-css",
    task: "raw",
    work: TASKS.raw.reference,
    equal: true,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: () => yukuParse("raw"),
    check: yukuCheck("raw"),
  },
  {
    name: "raw css-tree",
    label: "css-tree",
    task: "raw",
    work: "`parse` with values and preludes raw and positions off: the same tree, less the offsets",
    equal: true,
    package: "css-tree",
    runtimes: EVERYWHERE,
    load: () => cssTree.load({ values: "raw", positions: false }),
    check: cssTreeCheck("raw"),
  },
  {
    name: "raw postcss",
    label: "postcss",
    task: "raw",
    work: "`parse`: rules, at-rules and declarations, with selectors, values and preludes kept as strings and a line and column on every node",
    equal: false,
    package: "postcss",
    runtimes: EVERYWHERE,
    load: () => postcss.load({ values: "raw", positions: true }),
    check: postcssCheck,
  },
  {
    name: "raw adobe",
    label: "@adobe/css-tools",
    task: "raw",
    work: "`parse`: rules and declarations, selectors split at commas into strings, values as strings, a line and column on every node",
    equal: false,
    package: "@adobe/css-tools",
    runtimes: EVERYWHERE,
    async load() {
      const { parse } = await import("@adobe/css-tools");
      return (source) => parse(source);
    },
    check: adobeCheck,
  },
  {
    name: "raw stylis",
    label: "stylis `compile`",
    task: "raw",
    work: "`compile`: a flat tree of rules and declarations with nesting resolved into full selectors, values as strings, no positions",
    equal: false,
    package: "stylis",
    runtimes: EVERYWHERE,
    async load() {
      const { compile } = await import("stylis");
      return (source) => compile(source);
    },
    check: async () => undefined,
  },
  {
    name: "print yuku-css",
    label: "yuku-css `transform`",
    task: "print",
    work: TASKS.print.reference,
    equal: true,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: async () => yukuCssTransform.load({ values: "parsed", positions: false }),
    check: yukuCheck("parsed"),
  },
  {
    name: "print yuku-css generate",
    label: "yuku-css `parse` and `generate`",
    task: "print",
    work: "`parse(source).ast` then `generate` from `yuku-css/codegen`: the same output as `transform`, through a tree built in JS",
    equal: true,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: async () => yukuCssPrint.load({ values: "parsed", positions: false }),
    check: yukuCheck("parsed"),
  },
  {
    name: "print css-tree",
    label: "css-tree `parse` and `generate`",
    task: "print",
    work: "`parse` with values and preludes parsed and positions off, then `generate`: the same tree and the same compact output",
    equal: true,
    package: "css-tree",
    runtimes: EVERYWHERE,
    async load() {
      const { parse, generate } = await import("css-tree");
      return (source) => generate(parse(source, { positions: false, parseValue: true, parseAtrulePrelude: true, parseCustomProperty: false }));
    },
    check: cssTreeCheck("parsed"),
  },
  {
    name: "print lightningcss",
    label: "Lightning CSS (native)",
    task: "print",
    work: "`transform({ minify: false })`: parses every value into typed Rust structures and pretty-prints them, no targets",
    equal: false,
    package: "lightningcss",
    runtimes: NATIVE,
    load: (where) => lightningRun(where, false),
    check: lightningCheck,
  },
  {
    name: "print lightningcss-wasm",
    label: "Lightning CSS (WebAssembly)",
    task: "print",
    work: "the same `transform` from `lightningcss-wasm`",
    equal: false,
    package: "lightningcss-wasm",
    runtimes: ["chromium"],
    load: (where) => lightningRun(where, false),
    check: lightningCheck,
  },
  {
    name: "print esbuild",
    label: "esbuild",
    task: "print",
    work: "`transformSync(source, { loader: \"css\" })` (in Chromium `esbuild-wasm`'s async `transform`): parses into esbuild's own AST and pretty-prints it, no minifying; nesting is kept, as the default target is esnext",
    equal: false,
    package: "esbuild",
    runtimes: EVERYWHERE,
    async: ["chromium"],
    load: (where) => esbuildTransform(where, false),
    check: esbuildCheck,
  },
  {
    name: "print bun",
    label: "Bun `Bun.build`",
    task: "print",
    work: "`Bun.build` of one in-memory .css entry, no minifying: Bun's bundler parses with its CSS parser (ported from Lightning CSS) and pretty-prints the bundle, every import and `url()` left external; an async call",
    equal: false,
    package: "bun",
    runtimes: ["bun"],
    async: ["bun"],
    load: () => bunBuild(false),
    check: bunCheck,
  },
  {
    name: "print swc",
    label: "@swc/css",
    task: "print",
    work: "`transformSync` with no options: parses into swc's typed AST, lowers nesting into flat rules, and pretty-prints",
    equal: false,
    package: "@swc/css",
    runtimes: NATIVE,
    async load() {
      const swc = await swcCss();
      return (source) => swc.transformSync(Buffer.from(source), {}).code;
    },
    check: swcCheck,
  },
  {
    name: "print postcss",
    label: "postcss `parse` and `toString`",
    task: "print",
    work: "`parse(source).toString()`: selectors, values and preludes kept as strings, and the source printed back with its own whitespace",
    equal: false,
    package: "postcss",
    runtimes: EVERYWHERE,
    async load() {
      const { parse } = await import("postcss");
      return (source) => parse(source).toString();
    },
    check: postcssCheck,
  },
  {
    name: "print adobe",
    label: "@adobe/css-tools `parse` and `stringify`",
    task: "print",
    work: "`stringify(parse(source))`: values as strings, pretty-printed",
    equal: false,
    package: "@adobe/css-tools",
    runtimes: EVERYWHERE,
    async load() {
      const { parse, stringify } = await import("@adobe/css-tools");
      return (source) => stringify(parse(source));
    },
    check: adobeCheck,
  },
  {
    name: "print stylis",
    label: "stylis `compile` and `serialize`",
    task: "print",
    work: "`serialize(compile(source), stringify)`: nesting resolved into full selectors, values as strings, printed compactly, no vendor prefixes",
    equal: false,
    package: "stylis",
    runtimes: EVERYWHERE,
    async load() {
      const { compile, serialize, stringify } = await import("stylis");
      return (source) => serialize(compile(source), stringify);
    },
    check: async () => undefined,
  },
  {
    name: "format yuku-css",
    label: "yuku-css `transform`",
    task: "format",
    work: "not a formatter: parses and prints compactly, for scale",
    equal: false,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: async () => yukuCssTransform.load({ values: "parsed", positions: false }),
    check: yukuCheck("parsed"),
  },
  {
    name: "format oxfmt",
    label: "oxfmt",
    task: "format",
    work: "`format(\"bench.css\", source)`: oxc's native formatter parses with oxc-css-parser and pretty-prints with Prettier's style; an async call that runs off the main thread",
    equal: false,
    package: "oxfmt",
    runtimes: NATIVE,
    async: NATIVE,
    async load() {
      const { format } = await import("oxfmt");
      return (source) => format("bench.css", source).then((result) => result.code);
    },
    async check(source) {
      const { format } = await import("oxfmt");
      const { errors: found } = await format("bench.css", source);
      return errors((report) => found.forEach((error) => report(error.message)));
    },
  },
  {
    name: "format biome",
    label: "Biome",
    task: "format",
    work: "`formatContent(project, source, { filePath: \"bench.css\" })` from `@biomejs/js-api`, Biome's WebAssembly build: parses into its lossless syntax tree and pretty-prints",
    equal: false,
    package: "@biomejs/js-api",
    runtimes: EVERYWHERE,
    load: biome,
    check: biomeCheck,
  },
  {
    name: "format prettier",
    label: "Prettier",
    task: "format",
    work: "`format(source, { parser: \"css\" })`: parses with postcss and its value parsers, then pretty-prints; an async call",
    equal: false,
    package: "prettier",
    runtimes: EVERYWHERE,
    async: EVERYWHERE,
    load: prettier,
    async check(source) {
      const { format } = await import("prettier");
      try {
        await format(source, { parser: "css" });
        return undefined;
      } catch (error) {
        return message(error).split("\n")[0];
      }
    },
  },
  {
    name: "minify yuku-css",
    label: "yuku-css `transform`",
    task: "minify",
    work: "not a minifier: parses and prints compactly, dropping nothing, for scale",
    equal: false,
    package: "yuku-css",
    runtimes: EVERYWHERE,
    load: async () => yukuCssTransform.load({ values: "parsed", positions: false }),
    check: yukuCheck("parsed"),
  },
  {
    name: "minify esbuild",
    label: "esbuild",
    task: "minify",
    work: "`transformSync(source, { loader: \"css\", minify: true })` (in Chromium `esbuild-wasm`'s async `transform`)",
    equal: false,
    package: "esbuild",
    runtimes: EVERYWHERE,
    async: ["chromium"],
    load: (where) => esbuildTransform(where, true),
    check: esbuildCheck,
  },
  {
    name: "minify lightningcss",
    label: "Lightning CSS (native)",
    task: "minify",
    work: "`transform({ minify: true })`, no targets",
    equal: false,
    package: "lightningcss",
    runtimes: NATIVE,
    load: (where) => lightningRun(where, true),
    check: lightningCheck,
  },
  {
    name: "minify lightningcss-wasm",
    label: "Lightning CSS (WebAssembly)",
    task: "minify",
    work: "the same `transform({ minify: true })` from `lightningcss-wasm`",
    equal: false,
    package: "lightningcss-wasm",
    runtimes: ["chromium"],
    load: (where) => lightningRun(where, true),
    check: lightningCheck,
  },
  {
    name: "minify bun",
    label: "Bun `Bun.build`",
    task: "minify",
    work: "`Bun.build` of one in-memory .css entry with `minify: true`; an async call",
    equal: false,
    package: "bun",
    runtimes: ["bun"],
    async: ["bun"],
    load: () => bunBuild(true),
    check: bunCheck,
  },
  {
    name: "minify csso",
    label: "csso",
    task: "minify",
    work: "`minify(source)`: parses with its bundled css-tree 2, restructures and merges rules, and prints",
    equal: false,
    package: "csso",
    runtimes: EVERYWHERE,
    async load() {
      const { minify } = await import("csso");
      return (source) => minify(source).css;
    },
    check: cssoCheck,
  },
  {
    name: "minify clean-css",
    label: "clean-css",
    task: "minify",
    work: "`new CleanCSS().minify(source)` at its default level 1, imports not inlined",
    equal: false,
    package: "clean-css",
    runtimes: NATIVE,
    async load() {
      const CleanCSS = (await import("clean-css")).default;
      const cleaner = new CleanCSS({ inline: false });
      return (source) => cleaner.minify(source).styles;
    },
    async check(source) {
      const CleanCSS = (await import("clean-css")).default;
      const { errors: found, warnings } = new CleanCSS({ inline: false }).minify(source);
      return errors((report) => [...found, ...warnings].forEach(report));
    },
  },
];
