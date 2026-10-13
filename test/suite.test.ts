// css-tree's own fixtures against yuku-css, as yuku-tsrx runs its suite: diagnostics are the failure
// signal, a fixture's error is the first diagnostic, and trees compare without positions. A fixture
// css-tree recovers from has the errors css-tree reports on the way. A passing tree printed, read
// back and printed again gives the same text.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as csstree from "css-tree";
import { parse, tokenize, tokenNames, type ParseOptions } from "yuku-css";
import { generate } from "yuku-css/codegen";
import { listed, reasonOf } from "./divergences";

interface Fixture {
  source: string;
  ast?: { type: string };
  error?: string;
  offset?: string;
  options?: ParseOptions;
  /** Why css-tree's own round trip skips the fixture. */
  skipRoundtrip?: string;
}

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
const POSITION = new Set(["loc", "start", "end"]);
const json = (ast: unknown) => JSON.stringify(ast, (key, value) => (POSITION.has(key) ? undefined : value), 4);
const normalize = (text: string) => text.replace(/\n|\r\n?|\f/g, "\n");
// a listed fixture must fail, so it leaves the list once yuku-css matches it
const check = (id: string, run: () => void) => (reasonOf(id) === undefined ? run() : expect(run).toThrow());

const ast: [string, string, Fixture][] = [];
for (const path of files("ast/")) {
  const scope = path.split("/")[1]!;
  for (const [key, value] of Object.entries<Fixture | Fixture[]>(JSON.parse(read(path)))) {
    if (!Array.isArray(value)) ast.push([`${path} ${key}`, scope, value]);
    else value.forEach((fixture, i) => ast.push([`${path} ${key}#${i + 1}`, scope, fixture]));
  }
}

test.each(ast)("%s", (id, scope, { source, ast, error, offset, options, skipRoundtrip }) => {
  check(id, () => {
    const result = parse(source, { ...options, context: scope as ParseOptions["context"] });
    if (error === undefined) {
      const errors: [string, number][] = [];
      csstree.parse(source, {
        ...(options as csstree.ParseOptions),
        context: scope,
        onParseError: (e) => errors.push([e.message, (e as unknown as { offset: number }).offset]),
      });
      expect(result.diagnostics.map((d) => [d.message, d.start])).toEqual(errors);
      const expected = ast!.type.toLowerCase() !== scope.toLowerCase() && WRAPPER[scope] ? WRAPPER[scope](ast!) : ast;
      expect(json(result.ast)).toBe(json(expected));
      if (skipRoundtrip !== undefined) return;
      const css = generate(result.ast);
      expect(generate(parse(css, { ...options, context: scope as ParseOptions["context"] }).ast)).toBe(css);
      return;
    }
    expect(result.diagnostics[0]).toMatchObject({ message: error, start: offset!.indexOf("^") });
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
  check(id, () => {
    let start = 0;
    const actual = Array.from(tokenize(source), (packed) => {
      const end = packed & 0xffffff;
      const chunk = source.slice(start, end);
      start = end;
      return { type: tokenNames[packed >>> 24]!, chunk };
    });
    if (valid) expect(actual).toEqual(expected);
    else expect(actual).not.toEqual(expected);
  });
});

test("stringify.css", () => {
  check("stringify.css", () => {
    const { ast } = parse(normalize(read("stringify.css")), { filename: "stringify.css", positions: true });
    expect(JSON.stringify(ast, null, 4)).toBe(normalize(read("stringify.ast").trim()));
  });
});

test("every fixture runs or is listed", () => {
  const ids = new Set([...ast, ...tokens].map(([id]) => id));
  // test/grammar runs the definition syntax fixtures
  const run = (path: string) =>
    /^(ast|tokenize|definition-syntax(-match)?)\/|^stringify\./.test(path) || reasonOf(path) !== undefined;
  expect(files("").filter((path) => !run(path))).toEqual([]);
  const own = listed.filter((id) => !/^(definition-syntax|lexer)/.test(id));
  expect(own.filter((id) => !ids.has(id) && !existsSync(new URL(id, SUITE)))).toEqual([]);
});
