import { describe, expect, test } from "bun:test";
import {
  parse,
  type AtRule,
  type Block,
  type ComplexSelector,
  type CompoundSelector,
  type Declaration,
  type Node,
  type PseudoClassSelector,
  type Rule,
  type SelectorList,
} from "yuku-css";

function clean(source: string): ReturnType<typeof parse> {
  const result = parse(source);
  expect(result.diagnostics).toEqual([]);
  return result;
}

function rule(source: string, index = 0): Rule {
  return clean(source).stylesheet.children[index] as Rule;
}

function atRule(source: string, index = 0): AtRule {
  return clean(source).stylesheet.children[index] as AtRule;
}

function declarations(source: string): Declaration[] {
  return rule(source).block.children as Declaration[];
}

function selector(source: string): ComplexSelector {
  return (rule(`${source} {}`).prelude as SelectorList).children[0]!;
}

function compound(source: string): CompoundSelector {
  return selector(source).children[0] as CompoundSelector;
}

function simple(source: string): Node {
  return compound(source).children[0]!;
}

// every node's span slices out its own text
function spans(node: Node, source: string, out: string[] = []): string[] {
  out.push(`${node.type} ${source.slice(node.start, node.end)}`);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) spans(child, source, out);
    else if (value !== null && typeof value === "object") spans(value as Node, source, out);
  }
  return out;
}

describe("style sheet", () => {
  test("empty", () => {
    expect(clean("").stylesheet).toEqual({ type: "StyleSheet", start: 0, end: 0, children: [] });
    expect(clean(" /* only a comment */ ").stylesheet.children).toEqual([]);
  });

  test("rules and at-rules in order", () => {
    const { stylesheet } = clean("@import 'a.css'; a {} @media print { b {} }");
    expect(stylesheet.children.map((child) => child.type)).toEqual(["AtRule", "Rule", "AtRule"]);
  });

  test("spans slice the source", () => {
    const source = "a > b.c, :is(d) { color: red !important; &:hover { --x: { y } } }";
    expect(spans(clean(source).stylesheet, source)).toEqual([
      `StyleSheet ${source}`,
      `Rule ${source}`,
      "SelectorList a > b.c, :is(d)",
      "ComplexSelector a > b.c",
      "CompoundSelector a",
      "TypeSelector a",
      "Combinator >",
      "CompoundSelector b.c",
      "TypeSelector b",
      "ClassSelector .c",
      "ComplexSelector :is(d)",
      "CompoundSelector :is(d)",
      "PseudoClassSelector :is(d)",
      "SelectorList d",
      "ComplexSelector d",
      "CompoundSelector d",
      "TypeSelector d",
      "Block { color: red !important; &:hover { --x: { y } } }",
      "Declaration color: red !important",
      "Raw red",
      "Rule &:hover { --x: { y } }",
      "SelectorList &:hover",
      "ComplexSelector &:hover",
      "CompoundSelector &:hover",
      "NestingSelector &",
      "PseudoClassSelector :hover",
      "Block { --x: { y } }",
      "Declaration --x: { y }",
      "Raw { y }",
    ]);
  });

  test("ignores <!-- and -->", () => {
    expect(clean("<!-- a {} -->").stylesheet.children).toHaveLength(1);
  });
});

describe("rules", () => {
  test("rule", () => {
    expect(rule("a { }")).toMatchObject({
      type: "Rule",
      start: 0,
      end: 5,
      prelude: { type: "SelectorList", start: 0, end: 1 },
      block: { type: "Block", start: 2, end: 5, children: [] },
    });
  });

  test("nested rules", () => {
    const outer = rule(".a { color: red; .b { color: blue; } & + & {} > .c {} :hover {} }");
    expect(outer.block.children.map((child) => child.type)).toEqual(["Declaration", "Rule", "Rule", "Rule", "Rule"]);
    const relative = outer.block.children[3] as Rule;
    expect((relative.prelude as SelectorList).children[0]!.children[0]).toMatchObject({ type: "Combinator", name: ">" });
  });

  test("a nested rule led by a type selector", () => {
    const outer = rule(".a { html.dark & { color: red } html:is(.b) & { color: blue } }");
    expect(outer.block.children.map((child) => child.type)).toEqual(["Rule", "Rule"]);
  });

  test("deep nesting", () => {
    const depth = 50;
    let source = "a {}";
    for (let i = 0; i < depth; i++) source = `a { ${source} }`;
    let node = rule(source);
    for (let i = 0; i < depth; i++) node = node.block.children[0] as Rule;
    expect(node.block.children).toEqual([]);
  });
});

describe("at-rules", () => {
  test("without a block", () => {
    expect(atRule("@import url(a.css) screen;")).toEqual({
      type: "AtRule",
      start: 0,
      end: 26,
      name: "import",
      prelude: { type: "Raw", start: 8, end: 25, value: "url(a.css) screen" },
      block: null,
    });
    expect(atRule("@layer a, b;").prelude?.value).toBe("a, b");
  });

  test("without a prelude", () => {
    expect(atRule("@font-face { font-family: x }")).toMatchObject({ name: "font-face", prelude: null });
    expect(atRule("@starting-style { a { opacity: 0 } }").prelude).toBeNull();
  });

  test("blocks that hold rules", () => {
    for (const name of ["media screen", "supports (display: grid)", "layer base", "container card (width > 40em)", "scope (.a) to (.b)", "starting-style", "document url-prefix()", "-moz-document url-prefix()"]) {
      const block = atRule(`@${name} { a { color: red } b {} }`).block!;
      expect(block.children.map((child) => child.type)).toEqual(["Rule", "Rule"]);
      expect((block.children[0] as Rule).prelude.type).toBe("SelectorList");
    }
  });

  test("blocks that hold declarations", () => {
    for (const name of ["font-face", "page :first", "property --x", "counter-style thumbs"]) {
      const block = atRule(`@${name} { a: b; c: d }`).block!;
      expect(block.children.map((child) => (child as Declaration).property)).toEqual(["a", "c"]);
    }
    const page = atRule("@page { margin: 1in; @top-left { content: 'x' } }").block!;
    expect(page.children.map((child) => child.type)).toEqual(["Declaration", "AtRule"]);
  });

  test("keyframes", () => {
    for (const name of ["keyframes", "-webkit-keyframes", "-moz-keyframes", "KEYFRAMES"]) {
      const at = atRule(`@${name} spin { from { a: b } 50%, 75% { c: d } to {} }`);
      expect(at.name).toBe(name);
      const rules = at.block!.children as Rule[];
      expect(rules.map((child) => child.prelude)).toMatchObject([
        { type: "Raw", value: "from" },
        { type: "Raw", value: "50%, 75%" },
        { type: "Raw", value: "to" },
      ]);
      expect((rules[0]!.block.children[0] as Declaration).property).toBe("a");
    }
  });

  test("nested in a rule", () => {
    const outer = rule(".a { color: red; @media (width > 1px) { color: blue; > b {} } }");
    const media = outer.block.children[1] as AtRule;
    expect(media.block!.children.map((child) => child.type)).toEqual(["Declaration", "Rule"]);
  });

  test("unknown at-rules", () => {
    expect(atRule("@custom-thing a { b: c; d {} }").block!.children.map((child) => child.type)).toEqual([
      "Declaration",
      "Rule",
    ]);
  });

  test("ends without a semicolon before a closing brace or the end", () => {
    expect(atRule("@charset 'utf-8'")).toMatchObject({ end: 16, block: null });
    const inner = rule("a { @apply b }").block.children[0] as AtRule;
    expect(inner).toMatchObject({ name: "apply", end: 12, prelude: { value: "b" } });
  });
});

describe("declarations", () => {
  test("declaration", () => {
    expect(declarations("a { color : red ; }")[0]).toEqual({
      type: "Declaration",
      start: 4,
      end: 15,
      property: "color",
      value: { type: "Raw", start: 12, end: 15, value: "red" },
      important: false,
    });
  });

  test("!important", () => {
    const [first, second, third] = declarations("a { a: b !important; c: d!IMPORTANT ; e: f ! important }");
    expect(first).toMatchObject({ important: true, end: 19, value: { value: "b" } });
    expect(second).toMatchObject({ important: true, value: { value: "d" } });
    expect(third).toMatchObject({ important: true, value: { value: "f" } });
    expect(declarations("a { content: '!important' }")[0]!.important).toBe(false);
  });

  test("values keep comments, strings, functions, and urls as written", () => {
    const values = declarations(
      "a { a: red /* note */; b: 'x;y}'; c: calc(1px + (2px * 3)); d: url(data:image/png;base64,AB==); e: url( 'a;b' ) }",
    ).map((declaration) => declaration.value.value);
    expect(values).toEqual([
      "red /* note */",
      "'x;y}'",
      "calc(1px + (2px * 3))",
      "url(data:image/png;base64,AB==)",
      "url( 'a;b' )",
    ]);
  });

  test("custom properties keep braces and any value", () => {
    const [a, b, c] = declarations("a { --a: { b: c; d }; --b:; --c: [1, 2] !important }");
    expect(a).toMatchObject({ property: "--a", value: { value: "{ b: c; d }" } });
    expect(b).toMatchObject({ property: "--b", value: { value: "" } });
    expect(c).toMatchObject({ property: "--c", value: { value: "[1, 2]" }, important: true });
  });

  test("the last declaration needs no semicolon", () => {
    expect(declarations("a{b:c}")[0]).toMatchObject({ property: "b", value: { value: "c" } });
  });

  test("empty statements", () => {
    expect(declarations("a { ; b: c;; ; }")).toHaveLength(1);
  });
});

describe("selectors", () => {
  test("selector list", () => {
    const prelude = rule("a , b,c {}").prelude as SelectorList;
    expect(prelude.children.map((child) => [child.start, child.end])).toEqual([[0, 1], [4, 5], [6, 7]]);
  });

  test("combinators", () => {
    const children = selector("a b>c + d ~ e || f\n\tg").children;
    expect(children.filter((child) => child.type === "Combinator").map((child) => child.name)).toEqual([
      " ",
      ">",
      "+",
      "~",
      "||",
      " ",
    ]);
    expect(children[1]).toEqual({ type: "Combinator", start: 1, end: 2, name: " " });
    expect(children[3]).toEqual({ type: "Combinator", start: 3, end: 4, name: ">" });
  });

  test("comments between compounds", () => {
    expect(selector("a /* x */ > /* y */ b").children.map((child) => child.type)).toEqual([
      "CompoundSelector",
      "Combinator",
      "CompoundSelector",
    ]);
  });

  test("type selectors", () => {
    expect(simple("div")).toEqual({ type: "TypeSelector", start: 0, end: 3, namespace: null, name: "div" });
    expect(simple("*")).toMatchObject({ namespace: null, name: "*" });
    expect(simple("svg|rect")).toMatchObject({ namespace: "svg", name: "rect" });
    expect(simple("*|*")).toMatchObject({ namespace: "*", name: "*" });
    expect(simple("|a")).toMatchObject({ namespace: "", name: "a", start: 0, end: 2 });
    expect(simple("ns|*")).toMatchObject({ namespace: "ns", name: "*" });
  });

  test("id, class, and nesting selectors", () => {
    expect(compound("a#b.c-d.-e._f&").children).toEqual([
      { type: "TypeSelector", start: 0, end: 1, namespace: null, name: "a" },
      { type: "IdSelector", start: 1, end: 3, name: "b" },
      { type: "ClassSelector", start: 3, end: 7, name: "c-d" },
      { type: "ClassSelector", start: 7, end: 10, name: "-e" },
      { type: "ClassSelector", start: 10, end: 13, name: "_f" },
      { type: "NestingSelector", start: 13, end: 14 },
    ]);
    expect(simple("#1a")).toMatchObject({ type: "IdSelector", name: "1a" });
  });

  test("attribute selectors", () => {
    expect(simple("[href]")).toEqual({
      type: "AttributeSelector",
      start: 0,
      end: 6,
      namespace: null,
      name: "href",
      matcher: null,
      value: null,
      modifier: null,
    });
    expect(simple("[ data-x = 'a b' i ]")).toMatchObject({ name: "data-x", matcher: "=", value: "'a b'", modifier: "i" });
    expect(simple('[lang|="en"]')).toMatchObject({ name: "lang", matcher: "|=", value: '"en"' });
    for (const matcher of ["~=", "^=", "$=", "*="]) {
      expect(simple(`[a${matcher}b s]`)).toMatchObject({ matcher, value: "b", modifier: "s" });
    }
    expect(simple("[xlink|href]")).toMatchObject({ namespace: "xlink", name: "href" });
    expect(simple("[*|a]")).toMatchObject({ namespace: "*", name: "a" });
    expect(simple("[|a=b]")).toMatchObject({ namespace: "", name: "a", value: "b" });
  });

  test("pseudo-classes", () => {
    expect(simple(":hover")).toEqual({ type: "PseudoClassSelector", start: 0, end: 6, name: "hover", argument: null });
    expect(simple(":before")).toMatchObject({ type: "PseudoClassSelector", name: "before" });
    expect(simple(":dir( rtl )")).toMatchObject({ argument: { type: "Raw", value: "rtl", start: 6, end: 9 } });
    expect(simple(":lang(en, fr)")).toMatchObject({ argument: { type: "Raw", value: "en, fr" } });
    expect(simple(":global(.a)")).toMatchObject({ argument: { type: "Raw", value: ".a" } });
    expect(simple(":state()")).toMatchObject({ argument: { type: "Raw", value: "" } });
  });

  test("pseudo-classes that take selectors", () => {
    for (const name of ["is", "where", "not", "matches", "-webkit-any", "-moz-any", "host", "host-context", "IS"]) {
      const argument = (simple(`:${name}(.a, b c)`) as PseudoClassSelector).argument as SelectorList;
      expect(argument.type).toBe("SelectorList");
      expect(argument.children).toHaveLength(2);
    }
    expect((simple(":is()") as PseudoClassSelector).argument).toMatchObject({ type: "SelectorList", children: [] });
    expect((simple(":where()") as PseudoClassSelector).argument).toMatchObject({ type: "SelectorList", children: [] });
    expect(simple(":not(:is(a, :where(.b)))")).toMatchObject({ argument: { type: "SelectorList" } });
  });

  test(":has() takes relative selectors", () => {
    const argument = (simple(":has(> img, + p, ~ q, r)") as PseudoClassSelector).argument as SelectorList;
    expect(argument.children.map((child) => child.children[0]!.type)).toEqual([
      "Combinator",
      "Combinator",
      "Combinator",
      "CompoundSelector",
    ]);
  });

  test(":nth-*()", () => {
    expect(simple(":nth-child(2n + 1)")).toMatchObject({
      argument: { type: "Nth", nth: "2n + 1", selector: null, start: 11, end: 17 },
    });
    expect(simple(":nth-child( -n+3 of .a, b )")).toMatchObject({
      argument: { type: "Nth", nth: "-n+3", selector: { type: "SelectorList", children: [{}, {}] } },
    });
    for (const name of ["nth-last-child", "nth-of-type", "nth-last-of-type"]) {
      expect(simple(`:${name}(odd)`)).toMatchObject({ argument: { type: "Nth", nth: "odd" } });
    }
    expect(simple(":nth-child(EVEN)")).toMatchObject({ argument: { nth: "EVEN" } });
  });

  test("pseudo-elements", () => {
    expect(simple("::before")).toEqual({
      type: "PseudoElementSelector",
      start: 0,
      end: 8,
      name: "before",
      argument: null,
    });
    expect(simple("::part( label )")).toMatchObject({ argument: { type: "Raw", value: "label" } });
    expect(simple("::slotted(.a)")).toMatchObject({ argument: { type: "Raw", value: ".a" } });
    expect(compound("a::before:hover").children.map((child) => child.type)).toEqual([
      "TypeSelector",
      "PseudoElementSelector",
      "PseudoClassSelector",
    ]);
  });
});

describe("lexing", () => {
  test("comments anywhere", () => {
    const { stylesheet } = clean("/* a */ a /* b */ { /* c */ color /* d */ : red /* e */ ; } /* f */");
    const declaration = (stylesheet.children[0] as Rule).block.children[0] as Declaration;
    expect(declaration).toMatchObject({ property: "color", value: { value: "red /* e */" } });
  });

  test("strings hide braces, semicolons, and comments", () => {
    const [first, second] = declarations(`a { content: "} ; /* x */"; quotes: '\\'' "\\"" }`);
    expect(first!.value.value).toBe('"} ; /* x */"');
    expect(second!.value.value).toBe(`'\\'' "\\""`);
  });

  test("a string continues over an escaped newline", () => {
    expect(declarations('a { content: "a\\\nb" }')[0]!.value.value).toBe('"a\\\nb"');
  });

  test("escapes in names stay as written", () => {
    expect(simple(".a\\:b")).toMatchObject({ name: "a\\:b" });
    expect(simple(".\\31 23")).toMatchObject({ name: "\\31 23", end: 7 });
    expect(simple("#\\{x")).toMatchObject({ name: "\\{x" });
    expect(declarations("a { \\--x: y }")[0]!.property).toBe("\\--x");
  });

  test("non-ASCII offsets are UTF-16 code units", () => {
    const source = ".é😀 { --ü: '😀😀'; content: \"ß\" } .b {}";
    const { stylesheet } = clean(source);
    expect(spans(stylesheet, source)).toContain("ClassSelector .é😀");
    expect(spans(stylesheet, source)).toContain("Raw '😀😀'");
    expect(spans(stylesheet, source)).toContain("ClassSelector .b");
    const [first, second] = stylesheet.children as Rule[];
    expect(first!.end).toBe(source.indexOf(" .b"));
    expect(second!.start).toBe(source.indexOf(".b"));
  });

  test("a lone surrogate is one code unit", () => {
    const source = ".a\ud800 {} .b {}";
    const second = clean(source).stylesheet.children[1] as Rule;
    expect(second.start).toBe(source.indexOf(".b"));
  });

  test("CRLF and form feeds are whitespace", () => {
    expect(clean("a\r\n{\r\n\tb:\fc\r\n}").stylesheet.children).toHaveLength(1);
  });
});

describe("recovery", () => {
  function diagnose(source: string): string[] {
    return parse(source).diagnostics.map(({ message, start, end }) => `${message}: ${source.slice(start, end)}`);
  }

  test("unclosed block", () => {
    const { stylesheet, diagnostics } = parse("a { color: red");
    expect(diagnostics).toEqual([{ message: "Unclosed block", start: 2, end: 3 }]);
    expect((stylesheet.children[0] as Rule).block).toMatchObject({ end: 14, children: [{ property: "color" }] });
  });

  test("unclosed comment", () => {
    expect(diagnose("a {} /* x")).toEqual(["Unclosed comment: /* x"]);
  });

  test("unclosed string ends at the newline", () => {
    const { stylesheet, diagnostics } = parse('a { content: "x\n; color: red }');
    expect(diagnostics).toMatchObject([{ message: "Unclosed string", start: 13, end: 15 }]);
    expect((stylesheet.children[0] as Rule).block.children).toHaveLength(2);
  });

  test("unclosed parenthesis", () => {
    expect(diagnose("a { b: f(c }")).toEqual(["Unclosed block: (", "Unclosed block: {"]);
  });

  test("stray closing brace", () => {
    const { stylesheet, diagnostics } = parse("} a {} } b {}");
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual(["Unexpected '}'", "Unexpected '}'"]);
    expect(stylesheet.children).toHaveLength(2);
  });

  test("declaration outside a rule", () => {
    const { stylesheet } = parse("color: red; a {}");
    expect(diagnose("color: red; a {}")).toEqual(["Declaration outside of a rule: color: red"]);
    expect(stylesheet.children).toHaveLength(1);
  });

  test("bad declarations are dropped, the rest kept", () => {
    const source = "a { color; : red; 1px: x; b: c }";
    expect(diagnose(source)).toEqual([
      "Expected ':' after the property name: color",
      "Expected a property name: : red",
      "Expected a property name: 1px: x",
    ]);
    expect(((parse(source).stylesheet.children[0] as Rule).block.children as Declaration[]).map((d) => d.property)).toEqual(["b"]);
  });

  test("an invalid selector keeps the rule with a raw prelude", () => {
    const { stylesheet, diagnostics } = parse("a ! b { color: red } c {}");
    expect(diagnostics).toMatchObject([{ message: "Unexpected character in selector", start: 2, end: 3 }]);
    expect(stylesheet.children[0]).toMatchObject({
      type: "Rule",
      prelude: { type: "Raw", value: "a ! b" },
      block: { children: [{ property: "color" }] },
    });
    expect((stylesheet.children[1] as Rule).prelude.type).toBe("SelectorList");
  });

  test("selector errors", () => {
    expect(diagnose("{}")).toEqual(["Expected a selector: "]);
    expect(diagnose("a,,b {}")).toEqual(["Expected a selector: ,"]);
    expect(diagnose("a, {}")).toEqual(["Expected a selector: ,"]);
    expect(diagnose("> a {}")).toEqual(["Expected a selector: >"]);
    expect(diagnose("a > {}")).toEqual(["Expected a selector: >"]);
    expect(diagnose("a > > b {}")).toEqual(["Unexpected character in selector: >"]);
    expect(diagnose(". {}")).toEqual(["Expected a name: ."]);
    expect(diagnose("# {}")).toEqual(["Expected a name: #"]);
    expect(diagnose(".1a {}")).toEqual(["Expected a name: ."]);
    expect(diagnose("a: {}")).toEqual(["Expected a name: :"]);
    expect(diagnose("[a {}")).toEqual(["Unclosed block: [", "Declaration outside of a rule: [a {}"]);
    expect(diagnose("[a=] {}")).toEqual(["Invalid attribute selector: [a=]"]);
    expect(diagnose("[a~b] {}")).toEqual(["Invalid attribute selector: [a~"]);
    expect(diagnose("[a=b c d] {}")).toEqual(["Expected ']': [a=b c d"]);
    expect(diagnose(":not() {}")).toEqual(["Expected a selector: "]);
    expect(diagnose(":is(a {}")).toEqual(["Unclosed block: (", "Declaration outside of a rule: :is(a {}"]);
    expect(diagnose(":nth-child(foo) {}")).toEqual(["Invalid An+B expression: foo"]);
    expect(diagnose(":nth-of-type(2n of a) {}")).toEqual(["Invalid An+B expression: 2n of a"]);
    expect(diagnose("a&b {}")).toEqual(["Unexpected character in selector: b"]);
    expect(diagnose("a* {}")).toEqual(["Unexpected character in selector: *"]);
  });

  test("keyframes hold only keyframe rules", () => {
    expect(diagnose("@keyframes x { a: b; from {} }")).toEqual(["Expected a keyframe rule: a: b"]);
  });

  test("at-rule without a name", () => {
    expect(diagnose("@ x; a {}")).toEqual(["Expected an at-rule name after '@': @"]);
  });

  test("too deep", () => {
    const deep = "a { ".repeat(200) + "}".repeat(200);
    const { stylesheet, diagnostics } = parse(deep);
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.message))).toEqual(new Set(["Nesting is too deep"]));
    expect(stylesheet.children).toHaveLength(1);
    expect(parse(":is(".repeat(300) + "a" + ")".repeat(300) + " {}").diagnostics[0]!.message).toBe("Nesting is too deep");
    expect(parse("a { b: " + "(".repeat(300) + ")".repeat(300) + " }").diagnostics[0]!.message).toBe("Nesting is too deep");
  });

  test("never throws", () => {
    for (const source of ["{", "}", "@", "(", "[", "'", '"', "/*", "\\", "a{b:", "a{b", ":", "::", "a,", "@media{", "--x:{"]) {
      expect(() => parse(source)).not.toThrow();
    }
  });
});

describe("instances", () => {
  test("parses many sources in a row", () => {
    const source = "a { b: c } ".repeat(1000);
    for (let i = 0; i < 20; i++) expect(parse(source).stylesheet.children).toHaveLength(1000);
  });

  test("a large source", () => {
    const source = ".a > .b:hover { color: red; } ".repeat(100_000);
    const { stylesheet, diagnostics } = parse(source);
    expect(diagnostics).toEqual([]);
    expect(stylesheet.children).toHaveLength(100_000);
    expect(stylesheet.children.at(-1)!.end).toBe(source.length - 1);
  });

  test("block children have their types", () => {
    const block: Block = rule("a { b: c; d {} @e; }").block;
    expect(block.children.map((child) => child.type)).toEqual(["Declaration", "Rule", "AtRule"]);
  });
});

describe("nodes", () => {
  test("every node type", () => {
    const source = "@media x { a#b.c[d]:is(e)::f(g):nth-child(1 of h) > i, & j {} } @font-face { k: l }";
    const types = new Set(spans(clean(source).stylesheet, source).map((line) => line.split(" ")[0]));
    expect([...types].sort()).toEqual([
      "AtRule",
      "AttributeSelector",
      "Block",
      "ClassSelector",
      "Combinator",
      "ComplexSelector",
      "CompoundSelector",
      "Declaration",
      "IdSelector",
      "NestingSelector",
      "Nth",
      "PseudoClassSelector",
      "PseudoElementSelector",
      "Raw",
      "Rule",
      "SelectorList",
      "StyleSheet",
      "TypeSelector",
    ]);
  });

  test("random input never throws, and every span nests in its parent's", () => {
    const alphabet = ["a", "b", "-", "_", "1", ".", "#", ":", "::", "&", "*", "|", ",", ">", "+", "~", " ", "\n", "{", "}", "(", ")", "[", "]", ";", "=", "!", "@", "'", '"', "\\", "/*", "*/", "é", "😀", "%"];
    let seed = 1;
    const random = (n: number) => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % n;
    const check = (node: Node, start: number, end: number): void => {
      expect(node.start >= start && node.start <= node.end && node.end <= end).toBe(true);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) for (const child of value) check(child, node.start, node.end);
        else if (value !== null && typeof value === "object") check(value as Node, node.start, node.end);
      }
    };
    for (let i = 0; i < 3000; i++) {
      let source = "";
      for (let j = random(60); j > 0; j--) source += alphabet[random(alphabet.length)];
      const { stylesheet, diagnostics } = parse(source);
      check(stylesheet, 0, source.length);
      for (const diagnostic of diagnostics) expect(diagnostic.start <= diagnostic.end && diagnostic.end <= source.length).toBe(true);
    }
  });
});
