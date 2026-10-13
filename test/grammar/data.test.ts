// the grammar against css-tree's mdn-data grammar on every corpus declaration: where they disagree
// on whether a value matches, the property is listed in test/divergences.ts with the reason
import { expect, test } from "bun:test";
import * as csstree from "css-tree";
import { lexer } from "yuku-css/lexer";
import { grammarDivergences } from "../divergences";
import { declarations } from "./declarations";

test("the corpus matches as with mdn-data, but for the listed properties", () => {
  const disagree = new Set<string>();
  for (const { property, value } of declarations) {
    const ours = lexer.matchProperty(property, value).matched !== null;
    const theirs = csstree.lexer.matchProperty(property, value).matched !== null;
    if (ours !== theirs) disagree.add(`${property} ${ours ? "matches" : "does not match"}`);
  }
  expect([...disagree].sort()).toEqual(grammarDivergences.map(({ property }) => property).sort());
});
