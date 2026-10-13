import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type * as csstree from "css-tree";
import * as yuku from "yuku-css";
import { divergences } from "./divergences";

interface Fixture {
  source: string;
  ast?: { type: string };
  error?: string;
  offset?: string;
  options?: csstree.ParseOptions;
}

// measured against css-tree's API, which yuku-css grows into
const { parse, tokenize, tokenNames } = yuku as unknown as typeof csstree;

const SUITE = new URL("suite/", import.meta.url);
const WRAPPER: Record<string, (ast: object) => object> = {
  stylesheet: (ast) => ({ type: "StyleSheet", children: [ast] }),
  mediaQuery: (ast) => ({ type: "MediaQuery", modifier: null, mediaType: null, condition: ast }),
  rule: (ast) => ({ type: "Rule", prelude: { type: "SelectorList", children: [] }, block: ast }),
  selector: (ast) => ({ type: "Selector", children: [ast] }),
  value: (ast) => ({ type: "Value", children: [ast] }),
};

const read = (path: string) => readFileSync(new URL(path, SUITE), "utf8");
const files = (dir: string) =>
  readdirSync(new URL(dir, SUITE), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "LICENSE")
    .map((entry) => relative(SUITE.pathname, join(entry.parentPath, entry.name)))
    .sort();
const json = (ast: unknown) => JSON.stringify(ast, (key, value) => (key === "loc" ? undefined : value), 4);
const normalize = (text: string) => text.replace(/\n|\r\n?|\f/g, "\n");
const diverges = (id: string, check: () => void) => (divergences[id] ? expect(check).toThrow() : check());

const ast: [string, string, Fixture][] = [];
for (const path of files("ast/")) {
  const scope = path.split("/")[1]!;
  for (const [key, value] of Object.entries<Fixture | Fixture[]>(JSON.parse(read(path)))) {
    if (!Array.isArray(value)) ast.push([`${path} ${key}`, scope, value]);
    else value.forEach((fixture, i) => ast.push([`${path} ${key}#${i + 1}`, scope, fixture]));
  }
}

test.each(ast)("%s", (id, scope, { source, ast, error, offset, options }) => {
  diverges(id, () => {
    if (error === undefined) {
      const expected = ast!.type.toLowerCase() !== scope.toLowerCase() && WRAPPER[scope] ? WRAPPER[scope](ast!) : ast;
      expect(json(parse(source, { ...options, context: scope }))).toBe(json(expected));
      return;
    }
    const at = offset!.indexOf("^");
    const lines = source.slice(0, at).split(/\r|\r\n|\n|\f/g);
    let thrown: unknown;
    try {
      parse(source, { ...options, context: scope, onParseError: (e) => { throw e; } });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ offset: at, line: lines.length, column: lines.pop()!.length + 1 });
  });
});

const tokens: [string, string, { type: string; chunk: string }[], boolean][] = [];
for (const path of files("tokenize/")) {
  const type = path.slice("tokenize/".length, -".json".length);
  for (const [kind, values] of Object.entries<(string | { value: string; tokens: [] })[]>(JSON.parse(read(path)))) {
    values.forEach((value, i) => {
      const { value: source, tokens: expected } =
        typeof value === "string" ? { value, tokens: [{ type, chunk: value }] } : value;
      tokens.push([`${path} ${kind}#${i + 1}`, source, expected, kind === "valid"]);
    });
  }
}

test.each(tokens)("%s", (id, source, expected, valid) => {
  diverges(id, () => {
    const actual: { type: string; chunk: string }[] = [];
    tokenize(source, (type, start, end) => actual.push({ type: tokenNames[type]!, chunk: source.slice(start, end) }));
    if (valid) expect(actual).toEqual(expected);
    else expect(actual).not.toEqual(expected);
  });
});

test("stringify.css", () => {
  diverges("stringify.css", () => {
    const actual = parse(normalize(read("stringify.css")), { filename: "stringify.css", positions: true });
    expect(JSON.stringify(actual, null, 4)).toBe(normalize(read("stringify.ast").trim()));
  });
});

test("every fixture runs or diverges", () => {
  const ids = new Set([...ast, ...tokens].map(([id]) => id));
  const run = (path: string) => /^(ast|tokenize)\/|^stringify\./.test(path) || path.split("/")[0]! in divergences;
  expect(files("").filter((path) => !run(path))).toEqual([]);
  expect(Object.keys(divergences).filter((id) => !ids.has(id) && !existsSync(new URL(id, SUITE)))).toEqual([]);
});
