// yuku-css against css-tree, once css-tree parses as test/divergences.ts lists: the same tokens, the
// same tree with the same positions, and the same errors at the same offsets.
import { expect } from "bun:test";
import * as csstree from "css-tree";
import { parse, tokenize } from "yuku-css";
import { reference } from "./divergences";

// values and preludes are raw in yuku-css for now
const OPTIONS = { parseValue: false, parseAtrulePrelude: false, parseCustomProperty: false };

export function expectParity(source: string): void {
  const errors: [string, number][] = [];
  const expected = csstree.toPlainObject(
    reference.parse(source, {
      ...OPTIONS,
      positions: true,
      onParseError: (error) => errors.push([error.message, (error as unknown as { offset: number }).offset]),
    }),
  );
  const located = parse(source, { positions: true });
  expect(located.stylesheet).toEqual(expected as never);
  expect(located.diagnostics.map((d) => [d.message, d.start])).toEqual(errors);
  const { stylesheet } = parse(source);
  expect(withoutPositions(stylesheet)).toEqual(withoutPositions(csstree.toPlainObject(reference.parse(source, OPTIONS))));
}

export function expectTokens(source: string): void {
  const expected: number[] = [];
  csstree.tokenize(source, (type, _start, end) => expected.push(((type << 24) | Math.min(end, source.length)) >>> 0));
  expect(Array.from(tokenize(source))).toEqual(expected);
}

function withoutPositions(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutPositions);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== "loc" && key !== "start" && key !== "end") out[key] = withoutPositions(value);
  }
  return out;
}
