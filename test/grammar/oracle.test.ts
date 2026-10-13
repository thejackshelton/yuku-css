// the matcher against css-tree's own, both over the same compiled grammar: every declaration of the
// corpus and every fixture value gets the same match tree, iteration count and error
import { expect, test } from "bun:test";
import { lexer, type MatchNode } from "yuku-css/lexer";
import { declarations } from "./declarations";
import { oracle } from "./webref";

const shape = (node: any): unknown =>
  node === null
    ? null
    : "match" in node
      ? [node.syntax && (node.syntax.name ?? node.syntax.type), node.match.map(shape)]
      : [node.syntax && (node.syntax.name ?? node.syntax.value ?? node.syntax.type), node.token];

function outcome(run: () => { matched: unknown; iterations?: number; error: any }) {
  const result = run();
  return {
    matched: shape(result.matched as MatchNode | null),
    iterations: result.iterations,
    message: result.error?.message,
    mismatchOffset: result.error?.mismatchOffset,
    mismatchLength: result.error?.mismatchLength,
  };
}

test(`every corpus declaration matches as css-tree matches it (${declarations.length})`, () => {
  const differ: string[] = [];
  for (const { property, value } of declarations) {
    const ours = outcome(() => lexer.matchProperty(property, value));
    const theirs = outcome(() => oracle.matchProperty(property, value) as never);
    if (!Bun.deepEquals(ours, theirs)) differ.push(`${property}: ${value}`);
  }
  expect(differ).toEqual([]);
});
