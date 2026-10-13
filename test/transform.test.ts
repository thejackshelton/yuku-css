// transform against parse then generate, and against css-tree's generate over the tree test/compare.ts's
// fork of css-tree reads: every css-tree fixture in its context, the corpus, css-tree's source map
// fixtures and edge cases, in both spacing modes, with and without a map. Where css-tree's text
// differs, its tree must differ too.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as csstree from "css-tree";
import { parse, transform, type ParseOptions, type TransformOptions } from "yuku-css";
import { generate } from "yuku-css/codegen";
import { reference } from "./compare";
import { FIXTURES } from "./csstree";

const SUITE = new URL("suite/", import.meta.url);
const CORPUS = new URL("corpus/", import.meta.url);
const MODES = ["safe", "spec"] as const;

type Options = Pick<
  TransformOptions,
  "context" | "atrule" | "parseValue" | "parseCustomProperty" | "parseRulePrelude" | "parseAtrulePrelude"
>;

function expectTransform(source: string, options: Options = {}, filename = "input.css"): void {
  for (const mode of MODES) {
    const plain = transform(source, { ...options, mode });
    const parsed = parse(source, { ...options, filename });
    expect(plain.code).toBe(generate(parsed.ast, { mode }));
    expect(plain.map).toBeUndefined();
    const mapped = transform(source, { ...options, mode, filename, sourceMap: true });
    const located = parse(source, { ...options, filename, positions: true });
    const expected = generate(located.ast, { mode, sourceMap: true });
    expect(mapped.code).toBe(expected.css);
    expect(mapped.map).toBe(expected.map.toString());
    expect(mapped.diagnostics).toEqual(located.diagnostics);
    expect(plain.diagnostics).toEqual(parse(source, options).diagnostics);
    expectCssTree(source, options, filename, mode, mapped.code, mapped.map);
  }
}

const POSITION = new Set(["loc", "start", "end"]);
const json = (ast: unknown) => JSON.stringify(ast, (key, value) => (POSITION.has(key) ? undefined : value));

function expectCssTree(source: string, options: Options, filename: string, mode: "safe" | "spec", code: string, map: string): void {
  let tree: csstree.CssNode;
  try {
    tree = reference.parse(source, { ...(options as csstree.ParseOptions), positions: true, filename, onParseError() {} });
  } catch {
    // css-tree gives up on what yuku-css recovers from, so there is no text to compare
    return;
  }
  const expected = csstree.generate(tree, { mode, sourceMap: true } as never) as unknown as { css: string; map: object };
  if (code === expected.css && map === expected.map.toString()) return;
  // only a tree test/divergences.ts lists may print otherwise
  expect(json(parse(source, options).ast)).not.toBe(json(csstree.toPlainObject(tree)));
}

const files = (root: URL, dir: string) =>
  readdirSync(new URL(dir, root), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => relative(root.pathname, join(entry.parentPath, entry.name)))
    .sort();

const fixtures: [string, string, Options][] = [];
for (const path of files(SUITE, "ast/")) {
  const context = path.split("/")[1] as ParseOptions["context"];
  const file = JSON.parse(readFileSync(new URL(path, SUITE), "utf8"));
  for (const [key, value] of Object.entries<any>(file)) {
    const entries = Array.isArray(value) ? value : [value];
    entries.forEach((fixture, i) => {
      const id = Array.isArray(value) ? `${path} ${key}#${i + 1}` : `${path} ${key}`;
      fixtures.push([id, fixture.source, { ...fixture.options, context }]);
    });
  }
}

describe("css-tree fixtures", () => {
  test.each(fixtures)("%s", (_id, source, options) => expectTransform(source, options));
});

describe("css-tree source map fixtures", () => {
  for (const name of readdirSync(FIXTURES + "sourceMaps").filter((name) => name !== "LICENSE")) {
    test(name, () => expectTransform(readFileSync(FIXTURES + "sourceMaps/" + name, "utf8"), {}, name));
  }
  test("stringify.css", () => expectTransform(readFileSync(FIXTURES + "stringify.css", "utf8")));
});

describe("corpus", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    test(name, () => {
      const source = readFileSync(new URL(name, CORPUS), "utf8");
      expectTransform(source);
      expectTransform(source, { parseValue: false });
      expectTransform(source, { parseCustomProperty: true });
      expectTransform(source, { parseRulePrelude: false });
      expectTransform(source, { parseAtrulePrelude: false });
    });
  }
});

describe("edge cases", () => {
  const cases: [string, string][] = [
    ["empty", ""],
    ["byte order mark", "﻿a { b: c }"],
    ["byte order mark alone", "﻿"],
    ["non-ASCII", "é.ü { content: \"日本😀\"; x: 😀 } .é😀 { y: z }"],
    ["line breaks", "a {\r\n  b: c;\r  d: e;\f  f: g;\n}\n@media x {\r\n a { b: c } }"],
    ["NUL", "a { b: \"\0x\" url(\0) \0 }"],
    ["escapes", "a { b: \"\\0 \\D800 \\110000 a\\\nb\" url(a\\(b\\ c\\\"\\'\\7f) }"],
    ["control characters", "a { b: \"\u0001a\u001f \u007f\"; c: url(\u0001f) }"],
    ["an+b", "a:nth-child(+n) b:nth-child(-n+3) c:nth-child(2n-1) d:nth-child(-2n) e:nth-child(odd) f:nth-last-of-type(+5)"],
    ["nested at-rules", "@media a { @supports b { .c { d: e } .f { g: h } } } .i { j: k }"],
    ["empty important", "a { b: c ! ; d: e !IMPORTANT; f: g !ie }"],
    ["raws", "a { --x: { a: b } ; --y:  1  2\\\n ; --z: \\ }"],
    ["comments", "/*! keep */ a { /* drop */ b: c } /*! and \n this */"],
    ["unclosed", "a { b: url(x"],
    ["bad url", "a { b: url(a b) c }"],
    ["deep nesting", "a { b: " + "f(".repeat(200) + ")".repeat(200) + " }"],
    ["deep rules", "a { ".repeat(200) + "}".repeat(200)],
    ["ratios", "@media (aspect-ratio: 16/9) { a { b: c } }"],
    ["attribute selectors", "[a] [b=c] [d~='e' i] [f|=g s] [h^=\"i\"] [j$=k] [l*=m] [n|o] [*|p]"],
    ["pseudo", "a::before:hover:not(.b, #c):is(d) ::slotted(e) :host(f) :-moz-any(g)"],
    ["media", "@media not screen and (color), only print and ((min-width: 1px) or (hover)) {} @media (1px < width <= 2px) {} @media (width >= 600px) and (aspect-ratio: 16/9) {} @media x( y ) , ( z ) {}"],
    ["supports", "@supports (display: grid) and (not (a: b)) or selector(a > b) or font-tech(color-COLRv1) {}"],
    ["container", "@container card (min-width: 400px) and style(--x: y) { a { b: c } } @container (inline-size > 30em) {}"],
    ["layer and import", "@layer a.b, c; @layer d { } @import url(x.css) layer(e) supports(display: grid) screen and (color); @import 'y.css' layer;"],
    ["scope", "@scope (.a) to (.b > c) { d { e: f } } @scope to (.x) {} @scope (.y) {}"],
    ["prelude recovery", "@media (min-width: ; @supports (a: { } @container ( {} @scope ("],
  ];
  for (const [name, source] of cases) {
    test(name, () => {
      expectTransform(source);
      expectTransform(source, { parseValue: false, parseRulePrelude: false });
    });
  }

  for (const context of ["value", "selectorList", "declarationList", "rule", "atrule"] as const) {
    test(context, () => expectTransform("a  b , c( 1  +  2 ) ; d: e", { context }));
  }

  for (const atrule of ["media", "supports", "container", "import", "layer", "scope", "font-face"]) {
    test("atrulePrelude of @" + atrule, () => {
      expectTransform("screen and (a: b) , (c < 1px) layer(x) to (y)", { context: "atrulePrelude", atrule });
    });
  }

  test("a map lists no source when nothing maps", () => {
    expect(transform("/*! a */", { sourceMap: true }).map).toBe('{"version":3,"sources":[],"names":[],"mappings":""}');
  });

  test("filename defaults to <unknown>", () => {
    expect(JSON.parse(transform("a{}", { sourceMap: true }).map).sources).toEqual(["<unknown>"]);
  });

  test("throws on an unknown context", () => {
    expect(() => transform("a", { context: "nope" as never })).toThrow(TypeError);
  });
});
