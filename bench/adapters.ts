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
