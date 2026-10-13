// yuku-css/codegen against css-tree's generate: css-tree's lib/__tests/generate.js, with every output
// also compared to css-tree's own, and the corpus round trip
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as csstree from "css-tree";
import { parse } from "yuku-css";
import { walk } from "yuku-css/ast";
import { generate, type GenerateOptions, type Handlers, type Node } from "yuku-css/codegen";
import { astTests, FIXTURES } from "./csstree";
import { reference as fork } from "./compare";

const CORPUS = new URL("corpus/", import.meta.url);

function reference(ast: unknown, options?: GenerateOptions): any {
  return csstree.generate(ast as csstree.CssNode, options as never);
}

function expectSame(ast: unknown, options?: GenerateOptions): string {
  const actual = generate(ast as Node, options);
  expect(actual).toBe(reference(ast, options));
  return actual;
}

function expectSameMap(ast: unknown, options?: GenerateOptions): string {
  const actual = generate(ast as Node, { ...options, sourceMap: true });
  const expected = reference(ast, { ...options, sourceMap: true });
  expect(actual.css).toBe(expected.css);
  expect(actual.map.toString()).toBe(expected.map.toString());
  return actual.css;
}

describe("generate", () => {
  for (const fixture of astTests) {
    const expected = "generate" in fixture ? fixture.generate : fixture.source;
    test.skipIf(fixture.skip === true)(fixture.name, () => {
      const ast = csstree.parse(fixture.source, fixture.options);
      expect(expectSame(ast)).toBe(expected!);
      expectSame(ast, { mode: "spec" });
    });
    test.skipIf(fixture.skip === true)(fixture.name + " (plain object)", () => {
      const ast = csstree.toPlainObject(csstree.parse(fixture.source, fixture.options));
      expect(expectSame(ast)).toBe(expected!);
    });
  }

  test("throws on unknown node type", () => {
    expect(() => generate({ type: "xxx" })).toThrow(/Unknown node type/);
  });

  describe("sourceMap", () => {
    for (const fixture of astTests) {
      test.skipIf(fixture.skip === true)(fixture.name, () => {
        const ast = csstree.parse(fixture.source, { ...fixture.options, positions: true });
        expect(expectSameMap(ast)).toBe("generate" in fixture ? fixture.generate! : fixture.source);
      });
    }

    test("should generate a map", () => {
      const ast = csstree.parse(".a {\n  color: red;\n}\n", { filename: "test.css", positions: true });
      const result = generate(ast, { sourceMap: true });
      expect(result.css).toBe(".a{color:red}");
      expect(result.map.toString()).toBe('{"version":3,"sources":["test.css"],"names":[],"mappings":"AAAA,E,CACE,S"}');
    });

    test("complex CSS", () => {
      const ast = csstree.parse(".a { color: #ff0000; } .b { display: block; float: left; } @media foo { .c { color: red } }", {
        filename: "test.css",
        positions: true,
      });
      const result = generate(ast, { sourceMap: true });
      expect(result.css).toBe(".a{color:#ff0000}.b{display:block;float:left}@media foo{.c{color:red}}");
      expect(result.map.toString()).toBe(
        '{"version":3,"sources":["test.css"],"names":[],"mappings":"AAAA,E,CAAK,a,CAAkB,E,CAAK,a,CAAgB,U,CAAe,WAAa,E,CAAK,W"}',
      );
    });

    test("fixtures/sourceMaps", () => {
      for (const name of readdirSync(FIXTURES + "sourceMaps")) {
        const source = readFileSync(FIXTURES + "sourceMaps/" + name, "utf8");
        expectSameMap(csstree.parse(source, { filename: name, positions: true }));
      }
    });

    test("sources in first-use order, from several files", () => {
      const a = csstree.parse(".a { color: red } @media x { .b { c: d } }", { filename: "a.css", positions: true }) as any;
      const b = csstree.parse("\n\n.c { e: f; g: h }", { filename: "b.css", positions: true }) as any;
      a.children.appendList(b.children);
      expectSameMap(a);
    });

    test("setSourceContent", () => {
      const ast = csstree.parse(".a { color: red }", { filename: "a.css", positions: true });
      const actual = generate(ast, { sourceMap: true }).map;
      const expected = reference(ast, { sourceMap: true }).map;
      actual.setSourceContent("a.css", ".a { color: red }");
      expected.setSourceContent("a.css", ".a { color: red }");
      expect(actual.toString()).toBe(expected.toString());
    });
  });

  describe("spec mode", () => {
    for (const fixture of autoEmitWhiteSpace()) {
      const { id, ws, left, right } = fixture;
      test(id, () => {
        const ast = { type: "Value", children: [{ type: "Raw", value: left }, { type: "Raw", value: right }] };
        const actual = expectSame(ast, { mode: "spec" });
        if (ws) expect(actual).toBe(`${left} ${right}`);
        else if (actual !== `${left}${right}`) expect(actual).toBe(`${left} ${right}`);
        expectSame(ast, { mode: "safe" });
      });
    }
  });

  describe("auto-emit whitespace", () => {
    test("should auto insert whitespaces where necessary", () => {
      const ast = csstree.parse("span#foo { border: 1%var(--a)#ff0000; }");
      expect(expectSame(ast)).toBe("span#foo{border:1% var(--a) #ff0000}");
    });

    test("should not insert whitespaces for values passed to tokenize() by default", () => {
      const ast = csstree.parse("span#foo { border: 1%var(--a)#ff0000; }", { parseRulePrelude: false, parseValue: false });
      expect(expectSame(ast)).toBe("span#foo{border:1%var(--a)#ff0000}");
    });

    test("a delim backslash gets a newline after it", () => {
      expectSame({ type: "Raw", value: "a\\\nb" });
      expectSame({ type: "Value", children: [{ type: "Identifier", name: "a" }, { type: "Raw", value: "\\" }, { type: "Raw", value: "\\b" }] });
    });

    test("a byte order mark starting a raw is dropped, and spaces nothing", () => {
      expectSame({ type: "Value", children: [{ type: "Identifier", name: "a" }, { type: "Raw", value: "﻿b" }] });
      expectSame({ type: "Raw", value: "﻿" });
    });
  });

  describe("decorator", () => {
    const decorator = (log: string[]) => (handlers: Handlers): Handlers => {
      const { node, emit, token } = handlers;
      handlers.node = function (this: Handlers, child) {
        log.push("node " + child.type);
        node.call(this, child);
      };
      handlers.token = function (this: Handlers, type, value, suppress) {
        log.push(`token ${type} ${value} ${suppress}`);
        token.call(this, type, value, suppress);
      };
      handlers.emit = (value, type, auto) => {
        log.push(`emit ${value} ${type} ${auto}`);
        emit(value, type, auto);
      };
      return handlers;
    };

    const sources = [
      ".a { color: red; margin: 1px -2px +3px } @media (min-width: 1px) and (aspect-ratio: 1/2) { b:nth-child(2n-1) { x: y !ie } }",
      '@import url("a b") layer(x) supports(display: grid); a[x~="y" i]::slotted(b) > c { --x: { a: b } }',
      "@font-face { unicode-range: U+0025-00FF; src: url(a\\(.woff) } @scope (.a) to (.b) { :scope { color: red } }",
    ];

    for (const source of sources) {
      for (const mode of [undefined, "spec", "safe"] as const) {
        test(`${source.slice(0, 32)} (${mode ?? "default"})`, () => {
          const ast = csstree.parse(source, { positions: true, filename: "d.css" });
          const actual: string[] = [];
          const expected: string[] = [];
          expect(generate(ast, { decorator: decorator(actual), mode })).toBe(reference(ast, { decorator: decorator(expected), mode }));
          expect(actual).toEqual(expected);
          actual.length = expected.length = 0;
          const mapped = generate(ast, { decorator: decorator(actual), mode, sourceMap: true }) as any;
          const original = reference(ast, { decorator: decorator(expected), mode, sourceMap: true });
          expect(mapped.css).toBe(original.css);
          expect(mapped.map.toString()).toBe(original.map.toString());
          expect(actual).toEqual(expected);
        });
      }
    }

    test("a decorator replacing result", () => {
      const ast = csstree.parse(".a{b:c}");
      const decorator = (handlers: Handlers): Handlers => {
        const chunks: string[] = [];
        handlers.emit = (value) => chunks.push(value);
        handlers.result = () => chunks;
        return handlers;
      };
      expect(generate(ast, { decorator }) as unknown).toEqual(reference(ast, { decorator }));
    });
  });
});

describe("node types", () => {
  test("all 49, in fixtures/stringify.css", () => {
    const source = readFileSync(FIXTURES + "stringify.css", "utf8");
    const ast = csstree.parse(source, { positions: true, filename: "stringify.css" });
    const types = new Set<string>();
    walk(ast, (node) => void types.add(node.type));
    const list = csstree.parse("a: b; c: d", { context: "declarationList" });
    const space = { type: "Value", children: [{ type: "Identifier", name: "a" }, { type: "WhiteSpace", value: " " }, { type: "Identifier", name: "b" }] };
    walk(list, (node) => void types.add(node.type));
    walk(space, (node) => void types.add(node.type));
    expect([...types].sort()).toEqual(Object.keys((csstree.parse as any).config.node).sort());
    expectSame(ast);
    expectSame(ast, { mode: "spec" });
    expectSameMap(ast);
    expectSame(list);
    expectSame(space);
  });

  // css-tree throws "Unknown node type: undefined", passing a token type to `this.node`
  test("a Ratio without a right term prints it as 1", () => {
    const ratio = { type: "Ratio", left: { type: "Number", value: "16" }, right: null };
    expect(generate(ratio)).toBe("16/1");
    expect(() => reference(ratio)).toThrow("Unknown node type: undefined");
  });
});

describe("yuku-css trees", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    test(name, () => {
      const source = readFileSync(new URL(name, CORPUS), "utf8");
      const options = { parseAtrulePrelude: false };
      expect(generate(parse(source).ast)).toBe(reference(fork.parse(source, options)));
      const located = generate(parse(source, { positions: true, filename: name }).ast, { sourceMap: true });
      const expected = reference(fork.parse(source, { ...options, positions: true, filename: name }), { sourceMap: true });
      expect(located.css).toBe(expected.css);
      expect(located.map.toString()).toBe(expected.map.toString());
    });
  }
});

describe("corpus", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    test(name, () => {
      const source = readFileSync(new URL(name, CORPUS), "utf8");
      const ast = csstree.parse(source, { positions: true, filename: name });
      expectSame(ast);
      expectSame(ast, { mode: "spec" });
      expectSameMap(ast);
      expectSame(csstree.parse(source, { parseValue: false, parseAtrulePrelude: false, parseCustomProperty: true }));
    });
  }
});

// css-tree's lib/__tests/fixture/generate-auto-emit-ws.js: each pair of tokens, and whether it reads back
// as the two tokens without a space between
function autoEmitWhiteSpace(): { id: string; ws: boolean; left: string; right: string }[] {
  const num = (postfix = "") => ["-.5", "-1", "-1e-2", "-1e2", "-1.5", "0", ".5", "1", "1e-2", "1e2", "1.5"].map((v) => v + postfix);
  const names = new Map(Object.entries(csstree.tokenTypes).map(([k, v]) => [v, k]));
  const tokens: Record<string, string[]> = {
    Ident: ["foo", "--foo", "--"],
    Function: ["fn(", "--fn(", "--("],
    AtKeyword: ["@test"],
    Hash: ["#f00"],
    String: ['"foo"', "'foo'"],
    Url: ["url(#)"],
    Delim: ["@", "#", "-", "+", ".", "/", "*", "%"],
    Number: num(),
    Percentage: num("%"),
    Dimension: num("px"),
    CDO: ["<!--"],
    CDC: ["-->"],
    Colon: [":"],
    Semicolon: [";"],
    Comma: [","],
    LeftSquareBracket: ["["],
    RightSquareBracket: ["]"],
    LeftParenthesis: ["("],
    RightParenthesis: [")"],
    LeftCurlyBracket: ["{"],
    RightCurlyBracket: ["}"],
    Comment: ["/**/"],
  };
  const fixture: { id: string; ws: boolean; left: string; right: string }[] = [];
  for (const [leftType, lefts] of Object.entries(tokens)) {
    lefts.forEach((left, leftIndex) => {
      for (const [rightType, rights] of Object.entries(tokens)) {
        rights.forEach((right, rightIndex) => {
          const source = left + right;
          const read: { type: string; value: string }[] = [];
          csstree.tokenize(source, (type, start, end) => read.push({ type: names.get(type)!, value: source.slice(start, end) }));
          const apart =
            read.length === 2 &&
            read[0]!.type === leftType &&
            read[0]!.value === left &&
            read[1]!.type === rightType &&
            read[1]!.value === right;
          fixture.push({ id: `${leftType}[${leftIndex}]/${rightType}[${rightIndex}]`, ws: !apart, left, right });
        });
      }
    });
  }
  return fixture;
}
