// yuku-css against css-tree on every file of test/corpus, the CSS of the Markless repository.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yuku-css";
import { expectParity, expectTokens } from "./compare";

const CORPUS = new URL("corpus/", import.meta.url);

describe("parity with css-tree", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    test(name, () => {
      const source = readFileSync(new URL(name, CORPUS), "utf8");
      expectTokens(source);
      expectParity(source);
      expect(parse(source).diagnostics).toEqual([]);
    });
  }
});
