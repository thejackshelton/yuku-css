// every declaration of test/corpus, as css-tree reads it: the property and the value's text
import { readdirSync, readFileSync } from "node:fs";
import * as csstree from "css-tree";

export interface Declaration {
  property: string;
  value: string;
}

const corpus = new URL("../corpus/", import.meta.url);

export const declarations: Declaration[] = readdirSync(corpus)
  .sort()
  .flatMap((file) => {
    const found: Declaration[] = [];
    const ast = csstree.parse(readFileSync(new URL(file, corpus), "utf8"), { parseValue: false, parseAtrulePrelude: false });
    csstree.walk(ast, {
      visit: "Declaration",
      enter: (node) => found.push({ property: node.property, value: (node.value as csstree.Raw).value.trim() }),
    });
    return found;
  });
