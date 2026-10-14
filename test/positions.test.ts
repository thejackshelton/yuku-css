// With positions, the tree and each comment's loc must be css-tree's for anything a caller can observe of plain data:
// deep equality with prototypes, JSON, structured clones, and each object's own keys, key order,
// property kinds, prototype and extensibility, walked in step with css-tree's own tree, as well as
// which objects are shared between nodes.
import { describe, expect, test } from "bun:test";
import { deepStrictEqual } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import * as csstree from "css-tree";
import { parse } from "yuku-css";
import { reference } from "./compare";

const CORPUS = new URL("corpus/", import.meta.url);

interface Case {
  name: string;
  source: string;
  options?: { filename?: string; offset?: number; line?: number; column?: number };
}

const cases: Case[] = [
  { name: "byte order mark", source: "﻿a { color: red }\n" },
  { name: "every line break", source: "a {\r\n  color: red;\r  margin: 0;\f}\n/* x\r\ny */\nb { c: 'd' }" },
  { name: "located elsewhere", source: "a {\n  b: c d;\n}\n", options: { filename: "x.css", offset: 7, line: 3, column: 5 } },
  { name: "empty", source: "" },
  ...readdirSync(CORPUS)
    .sort()
    .map((name) => ({ name, source: readFileSync(new URL(name, CORPUS), "utf8") })),
];

// every own key and how it is held, per object, in walk order, with the first index each object was
// reached at so that sharing shows
function shape(root: unknown): unknown[] {
  const seen = new Map<object, number>();
  const out: unknown[] = [];
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    const index = seen.get(value);
    out.push(index ?? seen.size);
    if (index !== undefined) return;
    seen.set(value, seen.size);
    const forIn: string[] = [];
    for (const key in value) forIn.push(key);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    out.push(
      Object.getPrototypeOf(value) === Object.prototype ? "object" : Array.isArray(value) ? "array" : "other",
      Object.isExtensible(value),
      Reflect.ownKeys(value).map(String),
      forIn,
      Object.keys(value),
      Object.entries(descriptors).map(([key, d]) => [key, "value" in d, d.writable, d.enumerable, d.configurable]),
    );
    for (const key of Reflect.ownKeys(value)) visit((value as Record<PropertyKey, unknown>)[key]);
  };
  visit(root);
  return out;
}

describe("positions are css-tree's", () => {
  for (const { name, source, options = {} } of cases) {
    test(name, () => {
      const result = parse(source, { ...options, positions: true });
      const comments: unknown[] = [];
      const tree = reference.parse(source, { ...options, positions: true, onComment: (_, loc) => comments.push(loc) });
      const actual = [result.ast, result.comments.map((comment) => comment.loc)];
      const expected = [csstree.toPlainObject(tree), comments];
      deepStrictEqual(actual, expected);
      expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
      deepStrictEqual(structuredClone(actual), structuredClone(expected));
      expect(shape(actual)).toEqual(shape(expected));
      expect(shape(structuredClone(actual))).toEqual(shape(structuredClone(expected)));
    });
  }
});
