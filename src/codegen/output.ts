import { CHAR_BACKSLASH, CHAR_MINUS, CHAR_PLUS } from "../chars";
import type { Node } from "../ast/node";
import { print, type Printer } from "./printer";
import {
  AT_KEYWORD,
  BAD_URL,
  CDC,
  COLON,
  DELIM,
  DIMENSION,
  FUNCTION,
  HASH,
  IDENT,
  LEFT_PARENTHESIS,
  NUMBER,
  PERCENTAGE,
  RIGHT_PARENTHESIS,
  STRING,
  URL,
  bomLength,
  scan,
  tokenType,
} from "./scan";
import type { Tracker } from "./sourcemap";

// a token's kind: its type, or for a delim 32 plus its character, 160 for any non-ASCII one
const KINDS = 161;
const NON_ASCII = 160;

type Kind = number | string;

// css-tree's token-before.js: the pairs that would read back as other tokens unless spaced
const SPEC_PAIRS: [Kind, Kind][] = [];
for (const prev of [IDENT, AT_KEYWORD, HASH, DIMENSION, "#", "-"]) {
  for (const next of [IDENT, FUNCTION, URL, BAD_URL, "-", NUMBER, PERCENTAGE, DIMENSION, CDC]) SPEC_PAIRS.push([prev, next]);
}
SPEC_PAIRS.push([IDENT, LEFT_PARENTHESIS]);
for (const next of [IDENT, FUNCTION, URL, BAD_URL, NUMBER, PERCENTAGE, DIMENSION, "%", CDC]) SPEC_PAIRS.push([NUMBER, next]);
for (const next of [IDENT, FUNCTION, URL, BAD_URL, "-", CDC]) SPEC_PAIRS.push(["@", next]);
for (const prev of [".", "+"]) for (const next of [NUMBER, PERCENTAGE, DIMENSION]) SPEC_PAIRS.push([prev, next]);
SPEC_PAIRS.push(["/", "*"]);

const SAFE_PAIRS: [Kind, Kind][] = SPEC_PAIRS.concat([
  [IDENT, HASH],
  [DIMENSION, HASH],
  [HASH, HASH],
  [AT_KEYWORD, LEFT_PARENTHESIS],
  [AT_KEYWORD, STRING],
  [AT_KEYWORD, COLON],
  [PERCENTAGE, PERCENTAGE],
  [PERCENTAGE, DIMENSION],
  [PERCENTAGE, FUNCTION],
  [PERCENTAGE, "-"],
  [RIGHT_PARENTHESIS, IDENT],
  [RIGHT_PARENTHESIS, FUNCTION],
  [RIGHT_PARENTHESIS, PERCENTAGE],
  [RIGHT_PARENTHESIS, DIMENSION],
  [RIGHT_PARENTHESIS, HASH],
  [RIGHT_PARENTHESIS, "-"],
]);

function table(pairs: [Kind, Kind][]): Uint8Array {
  const spaced = new Uint8Array(KINDS * KINDS);
  const kind = (k: Kind): number => (typeof k === "string" ? 32 + k.charCodeAt(0) : k);
  for (const [prev, next] of pairs) spaced[kind(prev) * KINDS + kind(next)] = 1;
  return spaced;
}

export const SPEC: Uint8Array = table(SPEC_PAIRS);
export const SAFE: Uint8Array = table(SAFE_PAIRS);

function delimKind(code: number): number {
  return code < 128 ? 32 + code : code >= 128 ? NON_ASCII : 0;
}

export function kindOf(type: number, value: string): number {
  return type === DELIM ? delimKind(value.charCodeAt(0)) : type;
}

// the kind the pair table is read with: a `-` or `+` that starts a number reads as the delim
export function lookupKind(type: number, value: string, kind: number): number {
  const first = value.charCodeAt(0);
  if (first === CHAR_PLUS || (first === CHAR_MINUS && type !== IDENT && type !== FUNCTION && type !== CDC)) return 32 + first;
  return kind;
}

// css-tree packs a token's kind as `code` in token-before.js: the type, or a delim's character, shifted
export function kindToCode(kind: number): number {
  return kind < 32 ? kind << 1 : (kind - 32) << 7;
}

export function codeToKind(code: number): number {
  const masked = code & 0xfffe;
  return masked < 128 ? masked >> 1 : 32 + (masked >> 7);
}

export class Output implements Printer {
  css = "";
  prev = 0;
  readonly spaced: Uint8Array;
  readonly map: Tracker | null;

  constructor(spaced: Uint8Array, map: Tracker | null) {
    this.spaced = spaced;
    this.map = map;
  }

  node(node: Node): void {
    const map = this.map;
    if (map === null) return print(this, node);
    const tracked = map.enter(node);
    print(this, node);
    map.leave(tracked);
  }

  token(type: number, value: string): void {
    const first = value.charCodeAt(0);
    let kind = type;
    if (type === DELIM) {
      kind = delimKind(first);
      if (first === CHAR_BACKSLASH) value += "\n";
    }
    const lookup = first === CHAR_PLUS || (first === CHAR_MINUS && type !== IDENT && type !== FUNCTION && type !== CDC) ? 32 + first : kind;
    if (this.spaced[this.prev * KINDS + lookup] === 1) value = " " + value;
    this.prev = kind;
    this.write(value);
  }

  tokenize(raw: string): void {
    if (typeof raw !== "string") raw = String(raw || "");
    const length = raw.length;
    let start = bomLength(raw);
    if (start >= length) return;
    let end = scan(raw, start);
    let type = tokenType;
    if (start === 0) {
      const kind = type === DELIM ? delimKind(raw.charCodeAt(0)) : type;
      if (this.spaced[this.prev * KINDS + lookupKind(type, raw, kind)] === 1) this.write(" ");
    }
    let from = start;
    for (;;) {
      if (type === DELIM && raw.charCodeAt(start) === CHAR_BACKSLASH) {
        this.write(raw.slice(from, end) + "\n");
        from = end;
      }
      if (end >= length) break;
      start = end;
      end = scan(raw, start);
      type = tokenType;
    }
    if (from < length) this.write(from === 0 ? raw : raw.slice(from));
    this.prev = type === DELIM ? delimKind(raw.charCodeAt(start)) : type;
  }

  write(s: string): void {
    this.css += s;
    if (this.map !== null) this.map.emitted(s);
  }
}
