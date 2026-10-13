// matchStylesheet against matchProperty: every declaration of every corpus file, matched in one call
// over the parser's tokens, gets the result matching its value's text alone gets
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { lexer, type MatchNode } from "yuku-css/lexer";

const corpus = new URL("../corpus/", import.meta.url);
const shape = (node: any): unknown =>
  node === null
    ? null
    : "match" in node
      ? [node.syntax && (node.syntax.name ?? node.syntax.type), node.match.map(shape)]
      : [node.syntax && (node.syntax.name ?? node.syntax.value ?? node.syntax.type), node.token];

test("every corpus declaration matches as its value alone does", () => {
  const differ: string[] = [];
  let count = 0;
  for (const file of readdirSync(corpus).sort()) {
    const source = readFileSync(new URL(file, corpus), "utf8");
    for (const declaration of lexer.matchStylesheet(source)) {
      count++;
      const value = source.slice(declaration.start, declaration.end);
      const alone = lexer.matchProperty(declaration.property, value);
      const ours = [shape(declaration.matched as MatchNode | null), declaration.iterations, declaration.error?.message];
      const theirs = [shape(alone.matched), alone.iterations, alone.error?.message];
      if (!Bun.deepEquals(ours, theirs)) differ.push(`${file}: ${declaration.property}: ${value}`);
    }
  }
  expect(count).toBeGreaterThan(12000);
  expect(differ).toEqual([]);
});

test("a mismatch is placed in the style sheet", () => {
  const [, margin] = lexer.matchStylesheet("a {\n  color: red;\n  margin: 1px foo;\n}");
  expect(margin!.error).toMatchObject({ rawMessage: "Mismatch", mismatchOffset: 4, line: 3, column: 15 });
  expect(margin!.error).toMatchObject({ loc: { start: { offset: 32 }, end: { offset: 35 } } });
});
