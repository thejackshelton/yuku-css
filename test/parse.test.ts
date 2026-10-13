import { describe, expect, test } from "bun:test";
import {
  parse,
  tokenize,
  tokenNames,
  tokenTypes,
  type Atrule,
  type CssNode,
  type Declaration,
  type ParseContext,
  type ParseOptions,
  type ParseResult,
  type Positions,
  type PseudoClassSelector,
  type Raw,
  type Rule,
  type Selector,
  type SelectorList,
} from "yuku-css";

function clean(source: string): ParseResult {
  const result = parse(source);
  expect(result.diagnostics).toEqual([]);
  return result;
}

function rule(source: string, index = 0): Rule {
  return clean(source).ast.children[index] as Rule;
}

function selector(source: string): Selector {
  return (rule(`${source} {}`).prelude as SelectorList).children[0]!;
}

function simple(source: string): CssNode {
  return selector(source).children[0]!;
}

// each node's type and the text its offsets slice
function outline(node: unknown, source: string, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) outline(child, source, out);
  } else if (node !== null && typeof node === "object") {
    const { type, start, end } = node as { type: string; start: number; end: number };
    out.push(`${type} ${source.slice(start, end)}`);
    for (const value of Object.values(node)) outline(value, source, out);
  }
  return out;
}

describe("style sheet", () => {
  test("empty", () => {
    expect(clean("").ast).toEqual({ type: "StyleSheet", start: 0, end: 0, children: [] });
    expect(clean(" /* dropped */ ").ast.children).toEqual([]);
  });

  test("offsets slice the source", () => {
    const source = "a > b.c, :is(d) { color: red !important; & e { --x: { y } } }";
    expect(outline(clean(source).ast, source)).toEqual([
      `StyleSheet ${source}`,
      `Rule ${source}`,
      "SelectorList a > b.c, :is(d)",
      "Selector a > b.c",
      "TypeSelector a",
      "Combinator >",
      "TypeSelector b",
      "ClassSelector .c",
      "Selector :is(d)",
      "PseudoClassSelector :is(d)",
      "SelectorList d",
      "Selector d",
      "TypeSelector d",
      "Block { color: red !important; & e { --x: { y } } }",
      "Declaration color: red !important",
      "Value red ",
      "Identifier red",
      "Rule & e { --x: { y } }",
      "SelectorList & e",
      "Selector & e",
      "NestingSelector &",
      "Combinator  ",
      "TypeSelector e",
      "Block { --x: { y } }",
      "Declaration --x: { y } ",
      "Raw  { y } ",
    ]);
  });

  test("keeps /*! comments, <!-- and -->", () => {
    expect(clean("/*! license */ <!-- a {} -->").ast.children).toEqual([
      { type: "Comment", start: 0, end: 14, value: "! license " },
      { type: "CDO", start: 15, end: 19 },
      expect.objectContaining({ type: "Rule" }),
      { type: "CDC", start: 25, end: 28 },
    ]);
  });
});

describe("rules", () => {
  test("rule", () => {
    expect(rule("a { }")).toEqual({
      type: "Rule",
      start: 0,
      end: 5,
      prelude: {
        type: "SelectorList",
        start: 0,
        end: 1,
        children: [{ type: "Selector", start: 0, end: 1, children: [{ type: "TypeSelector", start: 0, end: 1, name: "a" }] }],
      },
      block: { type: "Block", start: 2, end: 5, children: [] },
    });
  });

  test("nested rules, however they start", () => {
    const outer = rule(".a { color: red; .b {} & + & {} > .c {} :hover {} html.dark & {} html:is(.d) & {} }");
    expect(outer.block.children.map((child) => child.type)).toEqual(["Declaration", "Rule", "Rule", "Rule", "Rule", "Rule", "Rule"]);
  });

  test("a raw prelude", () => {
    expect(rule("a, b {}").prelude).toMatchObject({ type: "SelectorList" });
    expect(parse("a, b {}", { parseRulePrelude: false }).ast.children[0]).toMatchObject({
      prelude: { type: "Raw", start: 0, end: 4, value: "a, b" },
    });
  });
});

describe("at-rules", () => {
  test("without a block", () => {
    expect(clean("@import url(a.css) screen;").ast.children[0]).toEqual({
      type: "Atrule",
      start: 0,
      end: 26,
      name: "import",
      prelude: { type: "Raw", start: 8, end: 25, value: "url(a.css) screen" },
      block: null,
    });
  });

  test("blocks of rules and blocks of declarations", () => {
    const [media, fontFace, keyframes, property] = clean(
      "@media print { a {} } @font-face { b: c } @keyframes k { from {} 50% {} } @property --x { d: e }",
    ).ast.children as Atrule[];
    expect(media!.block!.children.map((child) => child.type)).toEqual(["Rule"]);
    expect(fontFace!.block!.children.map((child) => child.type)).toEqual(["Declaration"]);
    expect((keyframes!.block!.children[1] as Rule).prelude).toMatchObject({
      children: [{ type: "Selector", children: [{ type: "Percentage", value: "50" }] }],
    });
    expect(property!.block!.children.map((child) => child.type)).toEqual(["Declaration"]);
  });

  test("nested in a rule, a group rule holds declarations", () => {
    const at = rule("a { @media x { b: c; d {} } @layer y { e: f } }").block.children as Atrule[];
    expect(at.map((child) => child.block!.children.map((grandchild) => grandchild.type))).toEqual([
      ["Declaration", "Rule"],
      ["Declaration"],
    ]);
  });
});

describe("declarations", () => {
  test("important", () => {
    const [plain, important, other] = rule("a { b: c; d: e !important; f: g ! ie }").block.children as Declaration[];
    expect(plain).toEqual({
      type: "Declaration",
      start: 4,
      end: 8,
      important: false,
      property: "b",
      value: { type: "Value", start: 7, end: 8, children: [{ type: "Identifier", start: 7, end: 8, name: "c" }] },
    });
    expect(important!.important).toBe(true);
    expect(other!.important).toBe("ie");
  });

  test("hacks", () => {
    const properties = (rule("a { *zoom: 1; _x: 2; $y: 3; +z: 4; #w: 5; /v: 6; //u: 7 }").block.children as Declaration[]).map(
      (declaration) => declaration.property,
    );
    expect(properties).toEqual(["*zoom", "_x", "$y", "+z", "#w", "/v", "//u"]);
  });

  test("a custom property keeps its whitespace and any block", () => {
    expect(((rule("a { --x: { y } ; }").block.children[0] as Declaration).value as Raw).value).toBe(" { y } ");
  });
});

describe("selectors", () => {
  test("combinators", () => {
    expect(selector("a b>c + d ~e /deep/ f").children.filter((node) => node.type === "Combinator")).toEqual([
      { type: "Combinator", start: 1, end: 2, name: " " },
      { type: "Combinator", start: 3, end: 4, name: ">" },
      { type: "Combinator", start: 6, end: 7, name: "+" },
      { type: "Combinator", start: 10, end: 11, name: "~" },
      { type: "Combinator", start: 13, end: 19, name: "/deep/" },
    ]);
  });

  test("a comment between simple selectors is no whitespace", () => {
    expect(selector(".a:hover/**/.b").children.map((node) => node.type)).toEqual([
      "ClassSelector",
      "PseudoClassSelector",
      "ClassSelector",
    ]);
    expect(selector(".a /**/ .b").children.map((node) => node.type)).toEqual(["ClassSelector", "Combinator", "ClassSelector"]);
  });

  test("simple selectors", () => {
    expect(simple("svg|a")).toEqual({ type: "TypeSelector", start: 0, end: 5, name: "svg|a" });
    expect(simple("*|*")).toMatchObject({ type: "TypeSelector", name: "*|*" });
    expect(simple("#a")).toEqual({ type: "IdSelector", start: 0, end: 2, name: "a" });
    expect(simple(".a")).toEqual({ type: "ClassSelector", start: 0, end: 2, name: "a" });
    expect(simple("&")).toEqual({ type: "NestingSelector", start: 0, end: 1 });
  });

  test("attribute selectors", () => {
    expect(simple("[a]")).toMatchObject({ name: { type: "Identifier", name: "a" }, matcher: null, value: null, flags: null });
    expect(simple("[ns|a ~= b]")).toMatchObject({ name: { name: "ns|a" }, matcher: "~=", value: { type: "Identifier", name: "b" } });
    expect(simple('[a="\\41 b" i]')).toEqual({
      type: "AttributeSelector",
      start: 0,
      end: 13,
      name: { type: "Identifier", start: 1, end: 2, name: "a" },
      matcher: "=",
      value: { type: "String", start: 3, end: 10, value: "Ab" },
      flags: "i",
    });
  });

  test("pseudo-classes and their arguments", () => {
    const children = (source: string) => (simple(source) as PseudoClassSelector).children;
    expect(children(":hover")).toBeNull();
    expect(children(":is(a, b)")).toMatchObject([{ type: "SelectorList", children: [{}, {}] }]);
    expect(children(":has(> a)")).toMatchObject([{ type: "SelectorList", children: [{ children: [{ type: "Combinator" }, {}] }] }]);
    expect(children(":host(a)")).toMatchObject([{ type: "Selector" }]);
    expect(children(":dir(ltr)")).toMatchObject([{ type: "Identifier", name: "ltr" }]);
    expect(children(':lang(en, "fr")')).toMatchObject([{ type: "Identifier" }, { type: "Operator", value: "," }, { type: "String", value: "fr" }]);
    expect(children(":unknown( a b )")).toMatchObject([{ type: "Raw", value: " a b " }]);
    expect(children(":is()")).toEqual([]);
  });

  test("nth", () => {
    const nth = (source: string) => ((simple(`:nth-child(${source})`) as PseudoClassSelector).children![0] as { nth: unknown; selector: unknown });
    expect(nth("2n+1").nth).toMatchObject({ type: "AnPlusB", a: "2", b: "1" });
    expect(nth("-n- 3").nth).toMatchObject({ a: "-1", b: "-3" });
    expect(nth("+n").nth).toMatchObject({ a: "1", b: null });
    expect(nth("5").nth).toMatchObject({ a: null, b: "5" });
    expect(nth("odd").nth).toMatchObject({ type: "Identifier", name: "odd" });
    expect(nth("2n of .a").selector).toMatchObject({ type: "SelectorList" });
  });

  test("pseudo-elements", () => {
    expect(simple("::before")).toEqual({ type: "PseudoElementSelector", start: 0, end: 8, name: "before", children: null });
    expect(simple("::slotted(a)")).toMatchObject({ children: [{ type: "Selector" }] });
    expect(simple("::part(a b)")).toMatchObject({ children: [{ type: "Raw", value: "a b" }] });
  });
});

describe("positions", () => {
  test("loc in place of start and end", () => {
    const { ast: stylesheet } = parse("a {\n  b: c\n}", { positions: true, filename: "x.css" });
    expect(stylesheet).not.toHaveProperty("start");
    const declaration = (stylesheet.children[0] as Rule<Positions>).block.children[0]!;
    expect(declaration.loc).toEqual({
      source: "x.css",
      start: { offset: 6, line: 2, column: 3 },
      end: { offset: 11, line: 3, column: 1 },
    });
  });

  test("a fragment's offset, line, and column", () => {
    const { ast: stylesheet } = parse("a {}", { positions: true, offset: 100, line: 5, column: 10 });
    expect(stylesheet.loc).toEqual({
      source: "<unknown>",
      start: { offset: 100, line: 5, column: 10 },
      end: { offset: 104, line: 5, column: 14 },
    });
  });

  test("the descendant combinator has no loc", () => {
    const rule = parse("a b {}", { positions: true }).ast.children[0] as Rule<Positions>;
    expect((rule.prelude as SelectorList<Positions>).children[0]!.children[1]).toEqual({ type: "Combinator", loc: null, name: " " });
  });

  test("offsets are UTF-16 code units", () => {
    const source = "é😀 { a: 'ü' } .日本 {}";
    expect(outline(clean(source).ast, source).filter((line) => !line.startsWith("Style"))).toEqual([
      "Rule é😀 { a: 'ü' }",
      "SelectorList é😀",
      "Selector é😀",
      "TypeSelector é😀",
      "Block { a: 'ü' }",
      "Declaration a: 'ü' ",
      "Value 'ü' ",
      "String 'ü'",
      "Rule .日本 {}",
      "SelectorList .日本",
      "Selector .日本",
      "ClassSelector .日本",
      "Block {}",
    ]);
  });
});

describe("recovery", () => {
  test("what does not parse is kept as Raw, with css-tree's error", () => {
    const { ast: stylesheet, diagnostics } = parse("a; b { c: d; e } f[ {}");
    expect(stylesheet.children.map((child) => child.type)).toEqual(["Rule", "Raw"]);
    expect(diagnostics.map(({ message, start, end }) => ({ message, start, end }))).toEqual([
      { message: "Unexpected input", start: 1, end: 2 },
      { message: "Colon is expected", start: 15, end: 16 },
      { message: "Identifier is expected", start: 20, end: 21 },
      { message: '"{" is expected', start: 22, end: 22 },
    ]);
  });

  test("too deep", () => {
    const { ast: stylesheet, diagnostics } = parse("a{".repeat(300));
    expect(diagnostics.map((d) => d.message)).toContain("Nesting is too deep");
    let node = stylesheet.children[0] as Rule;
    for (let depth = 1; depth < 128; depth++) node = node.block.children[0] as Rule;
    expect(node.block.children[0]).toMatchObject({ type: "Raw" });
  });

  test("never throws, and offsets stay in the source", () => {
    const alphabet = ["a", "-", "1", ".", "#", ":", "::", "&", "*", "|", ",", ">", "+", " ", "\n", "{", "}", "(", ")", "[", "]", ";", "=", "!", "@", "'", '"', "\\", "/*", "*/", "é", "😀", "%", "url("];
    let seed = 1;
    const random = (n: number) => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n;
    const check = (node: unknown, length: number): void => {
      if (Array.isArray(node)) return node.forEach((child) => check(child, length));
      if (node === null || typeof node !== "object") return;
      const { start, end } = node as { start: number; end: number };
      expect(start >= 0 && start <= end && end <= length).toBe(true);
      for (const value of Object.values(node)) check(value, length);
    };
    for (let i = 0; i < 3000; i++) {
      let source = "";
      for (let j = random(60); j > 0; j--) source += alphabet[random(alphabet.length)];
      const { ast: stylesheet, diagnostics } = parse(source);
      check(stylesheet, source.length);
      check(diagnostics, source.length);
    }
  });
});

describe("tokenize", () => {
  test("types and ends, packed as css-tree packs them", () => {
    const tokens = Array.from(tokenize("a{b:1px}"), (token) => [tokenNames[token >>> 24], token & 0xffffff]);
    expect(tokens).toEqual([
      ["ident-token", 1],
      ["{-token", 2],
      ["ident-token", 3],
      ["colon-token", 4],
      ["dimension-token", 7],
      ["}-token", 8],
    ]);
    expect(tokenTypes.Dimension).toBe(12);
    expect(tokenTypes.Comment).toBe(25);
  });
});

describe("instances", () => {
  test("parses many sources in a row", () => {
    const source = "a { b: c } ".repeat(1000);
    for (let i = 0; i < 20; i++) expect(parse(source).ast.children).toHaveLength(1000);
  });

  test("a large source", () => {
    const source = ".a > .b:hover { color: red; } ".repeat(100_000);
    const { ast: stylesheet, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(stylesheet.children).toHaveLength(100_000);
    expect(stylesheet.children.at(-1)!.end).toBe(source.length - 1);
  });
});

const errors = (source: string, options?: ParseOptions) =>
  parse(source, options).diagnostics.map((d) => [d.message, d.start]);

describe("contexts", () => {
  test("each gives its node", () => {
    const roots: [ParseContext, string, string][] = [
      ["stylesheet", "a {}", "StyleSheet"],
      ["atrule", "@media x { a {} }", "Atrule"],
      ["rule", "a { b: c }", "Rule"],
      ["selectorList", "a, b", "SelectorList"],
      ["selector", "a > b", "Selector"],
      ["block", "{ a: b; c {} }", "Block"],
      ["declarationList", "a: b; c {} & d {}", "DeclarationList"],
      ["declaration", "a: b", "Declaration"],
      ["value", "1px solid", "Value"],
      ["atrulePrelude", "screen and (x)", "Raw"],
      ["mediaQueryList", "screen, print", "Raw"],
      ["mediaQuery", "screen", "Raw"],
    ];
    for (const [context, source, type] of roots) {
      const { ast, diagnostics } = parse(source, { context });
      expect([context, ast.type as string, diagnostics.length]).toEqual([context, type, 0]);
    }
  });

  test("a declaration list reads nested rules", () => {
    const { ast } = parse("a: b; .c { d: e } & f {}", { context: "declarationList" });
    expect(outline(ast, "a: b; .c { d: e } & f {}").filter((line) => /^(Declaration|Rule|DeclarationList) /.test(line))).toEqual([
      "DeclarationList a: b; .c { d: e } & f {}",
      "Declaration a: b",
      "Rule .c { d: e }",
      "Declaration d: e ",
      "Rule & f {}",
    ]);
  });

  test("what does not parse as the context is a Raw of the source", () => {
    expect(parse("a b", { context: "declaration" })).toMatchObject({
      ast: { type: "Raw", start: 0, end: 3, value: "a b" },
      diagnostics: [{ message: "Colon is expected", start: 2 }],
    });
  });

  test("input left after the node is reported", () => {
    const { ast, diagnostics } = parse("a {} b", { context: "rule" });
    expect(ast.type).toBe("Rule");
    expect(diagnostics.map((d) => [d.message, d.start])).toEqual([["Unexpected input", 4]]);
  });

  test("an unknown context throws", () => {
    expect(() => parse("a", { context: "nope" as ParseContext })).toThrow("unknown context");
  });
});

describe("options", () => {
  test("diagnostics take Yuku's shape", () => {
    expect(parse("a{b c}", { filename: "x.css" }).diagnostics).toEqual([
      { severity: "error", message: "Colon is expected", path: "x.css", start: 4, end: 5, labels: [], help: null },
    ]);
    expect(parse("a{b c}").diagnostics[0]!.path).toBeNull();
  });

  test("comments", () => {
    const source = "/*! a */ b { /* c */ d: e } /* f";
    expect(parse(source).comments).toEqual([
      { type: "Comment", start: 0, end: 8, value: "! a " },
      { type: "Comment", start: 13, end: 20, value: " c " },
      { type: "Comment", start: 28, end: 32, value: " f" },
    ]);
    expect(parse(source, { positions: true }).comments[1]).toEqual({
      type: "Comment",
      loc: { source: "<unknown>", start: { offset: 13, line: 1, column: 14 }, end: { offset: 20, line: 1, column: 21 } },
      value: " c ",
    });
    expect(parse("a {}").comments).toEqual([]);
  });

  test("onComment, as css-tree calls it", () => {
    const seen: unknown[] = [];
    parse("a { /* b */ }\n/*c*/", { onComment: (value, loc) => seen.push([value, loc?.start.line ?? null]) });
    parse("/*d*/", { positions: true, onComment: (value, loc) => seen.push([value, loc?.start.line ?? null]) });
    expect(seen).toEqual([[" b ", null], ["c", null], ["d", 1]]);
  });

  test("tokens and onToken", () => {
    const source = "a{b:é}";
    expect(parse(source).tokens).toBeUndefined();
    expect(Array.from(parse(source, { tokens: true }).tokens!)).toEqual(Array.from(tokenize(source)));
    const calls: unknown[] = [];
    const objects: { type: number; start: number; end: number }[] = [];
    const result = parse(source, { onToken: (type, start, end) => calls.push([tokenNames[type], start, end]) });
    parse(source, { onToken: objects });
    expect(result.tokens).toBeUndefined();
    expect(calls).toEqual([
      ["ident-token", 0, 1],
      ["{-token", 1, 2],
      ["ident-token", 2, 3],
      ["colon-token", 3, 4],
      ["ident-token", 4, 5],
      ["}-token", 5, 6],
    ]);
    expect(objects.map(({ type, start, end }): unknown => [tokenNames[type], start, end])).toEqual(calls);
  });

  test("onParseError gets css-tree's SyntaxError, after parsing", () => {
    const seen: [string, string, number, number, number][] = [];
    const result = parse("a{}\n b{c d}", {
      line: 3,
      offset: 10,
      onParseError: (error) => seen.push([error.name, error.message, error.offset, error.line, error.column]),
    });
    expect(result.ast.children).toHaveLength(2);
    expect(seen).toEqual([["SyntaxError", "Colon is expected", 19, 4, 6]]);
  });
});

describe("what the specs reject and css-tree reads", () => {
  // values raw, so no value grammar error joins them
  test("tokenizer parse errors (css-syntax-3 §4)", () => {
    const raw = { parseValue: false };
    expect(errors("/* x")).toEqual([["Unterminated comment", 4]]);
    expect(errors('.a { content: "x }', raw)).toEqual([["Unterminated string", 18]]);
    expect(errors(".a{b:'x\ny'}", raw)).toEqual([["Newline in string", 7], ["Unterminated string", 11]]);
    expect(errors(".a{b:url(x", raw)).toEqual([["Unterminated url", 10]]);
    expect(errors(".a{b:url(x) url(a\"b) url(a b) url(a\\\nb)}", raw)).toEqual([
      ["Unexpected character in url", 17],
      ["Invalid escape", 35],
    ]);
    expect(errors("a\\\n{}")).toEqual([["Unexpected input", 1], ["Invalid escape", 1]]);
  });

  // CSS Syntax 3 no longer reads EOF inside a block, function or at-rule as a parse error
  test("a source that ends inside a block is no error", () => {
    for (const source of [".a{", ".a { color: red", "@media (x", ".a { x: ( }", ".a { x: ({) } .b{}"]) {
      expect([source, errors(source, { parseValue: false })]).toEqual([source, []]);
    }
    expect(errors(".a { color: red")).toEqual([]);
  });

  // as css-tree reads it, a value holds no `{`, `}` or `;` outside a function or block it can read
  test("a value that holds a token css-tree cannot read is raw", () => {
    expect(errors(".a { x: ( }")).toEqual([['")" is expected', 10]]);
    expect(errors(".a { x: ({) } .b{}")).toEqual([['")" is expected', 9]]);
    expect(errors(".a{b:'x\ny'}")).toEqual([["Unexpected input", 5], ["Newline in string", 7], ["Unterminated string", 11]]);
  });

  test("a leading combinator outside a relative selector (selectors-4 §3.1)", () => {
    expect(errors("> .a {}")).toEqual([["Relative selector is not allowed here", 0]]);
    expect(errors(":is(> a) {}")).toEqual([["Relative selector is not allowed here", 4]]);
    expect(errors("> a", { context: "selector" })).toEqual([["Relative selector is not allowed here", 0]]);
    for (const source of [".a { > b {} }", ":has(> a) {}", "@scope (.a) { > b {} }", ".a { @media x { + b {} } }", "> b {}"]) {
      const context = source === "> b {}" ? "block" : "stylesheet";
      expect([source, errors(context === "block" ? `{${source}}` : source, { context })]).toEqual([source, []]);
    }
    expect(parse("> a", { context: "selector" }).ast).toMatchObject({ children: [{ type: "Combinator", name: ">" }, { name: "a" }] });
  });

  test("combinators sit between compounds (selectors-4 §18)", () => {
    expect(errors("a > > b {}")).toEqual([["Compound selector is expected", 4]]);
    expect(errors("a + {}")).toEqual([["Compound selector is expected", 3]]);
  });

  test("a type selector leads its compound (selectors-4 §18)", () => {
    expect(errors("a:hover|b {}")).toEqual([["Type selector must come first in a compound selector", 7]]);
    expect(errors(".a* {}")).toEqual([["Type selector must come first in a compound selector", 2]]);
    const { ast } = parse("a:hover|b", { context: "selector" });
    expect(ast.type === "Selector" && ast.children.map((child) => child.type)).toEqual(["TypeSelector", "PseudoClassSelector", "TypeSelector"]);
  });

  test("the column combinator (selectors-4 §15.1)", () => {
    expect(clean("col.a || td {}").ast.children).toHaveLength(1);
    expect(selector("a||b").children).toEqual([
      { type: "TypeSelector", start: 0, end: 1, name: "a" },
      { type: "Combinator", start: 1, end: 3, name: "||" },
      { type: "TypeSelector", start: 3, end: 4, name: "b" },
    ]);
    expect(selector("ns|a || *|b").children.map((child) => ("name" in child ? child.name : child.type))).toEqual(["ns|a", "||", "*|b"]);
  });
});
