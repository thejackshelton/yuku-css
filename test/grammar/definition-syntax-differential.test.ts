// definitionSyntax.parse against css-tree's on every syntax of @webref/css and mdn-data, and on
// malformed ones: the same tree, or the same error at the same offset
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { definitionSyntax as theirs } from "css-tree";
import { definitionSyntax as ours } from "yuku-css/lexer";

const root = new URL("../../", import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const webref = read("node_modules/@webref/css/css.json");
const sources: string[] = [];
for (const category of ["properties", "types", "functions"]) {
  for (const feature of webref[category]) if (feature.syntax) sources.push(feature.syntax);
}
for (const atrule of webref.atrules) {
  if (atrule.syntax) sources.push(atrule.syntax);
  for (const descriptor of atrule.descriptors) if (descriptor.syntax) sources.push(descriptor.syntax);
}
for (const file of ["syntaxes", "properties"]) {
  for (const entry of Object.values<{ syntax: string }>(read(`node_modules/mdn-data/css/${file}.json`))) {
    sources.push(entry.syntax);
  }
}
sources.push(
  ...["'x", "<x>{}", "<x>{,2}", "<>", "<''>", "<x>&&", "&&<x>", "<x>&&||", "#", "!", "[]]", "{1}", "a&b", "<a"],
  ...["<number [-∞,∞]>", "<x [0px,5]>", "<x [-0,1]>", "a( b() )", "x+#{1,2}?", "a{0}", "∞ × é", "<x [1 ,2 ]>"],
  ...["a ||", "| a", "a b |", "[a | b]!{1,2}", "a b   |   c ||   d &&   e f", "<boolean-expr[ a | b ]>#"],
);

const outcome = (parse: (source: string) => unknown, source: string) => {
  try {
    return JSON.stringify(parse(source));
  } catch (error) {
    return `${(error as Error).message}`;
  }
};

test(`every syntax reads as css-tree reads it (${sources.length})`, () => {
  const differ = sources.filter((source) => outcome(ours.parse, source) !== outcome(theirs.parse, source));
  expect(differ).toEqual([]);
});
