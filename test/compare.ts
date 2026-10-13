// yuku-css against css-tree, once a fork of css-tree parses as test/divergences.ts lists: the same
// tokens, the same tree with the same positions, and the same errors at the same offsets, with the
// errors the specs read where css-tree reads none placed among css-tree's by offset.
import { expect } from "bun:test";
import * as csstree from "css-tree";
import { parse, tokenize } from "yuku-css";

// preludes are raw in yuku-css for now
const OPTIONS = { parseAtrulePrelude: false };

type Error = [message: string, offset: number];

/** `options` go to both parsers, beside at-rule preludes kept raw. */
export function expectParity(source: string, options: { parseValue?: boolean; parseCustomProperty?: boolean } = {}): void {
  const errors: Error[] = [];
  const expected = csstree.toPlainObject(
    reference.parse(source, {
      ...options,
      ...OPTIONS,
      positions: true,
      onParseError: (error) => errors.push([error.message, (error as unknown as { offset: number }).offset]),
    }),
  );
  const located = parse(source, { ...options, positions: true });
  expect(located.ast).toEqual(expected as never);
  const spec = [...selectorErrors(expected as unknown as Node), ...tokenErrors(source)].sort((a, b) => a[1] - b[1]);
  expect(located.diagnostics.map((d) => [d.message, d.start])).toEqual(merge(errors, spec));
  const plain = csstree.toPlainObject(reference.parse(source, { ...options, ...OPTIONS }));
  expect(withoutPositions(parse(source, options).ast)).toEqual(withoutPositions(plain));
}

export function expectTokens(source: string): void {
  const expected: number[] = [];
  csstree.tokenize(source, (type, _start, end) => expected.push(((type << 24) | Math.min(end, source.length)) >>> 0));
  expect(Array.from(tokenize(source))).toEqual(expected);
}

function merge(own: Error[], spec: Error[]): Error[] {
  const out: Error[] = [];
  let i = 0;
  for (const error of spec) {
    while (i < own.length && own[i]![1] <= error[1]) out.push(own[i++]!);
    out.push(error);
  }
  return out.concat(own.slice(i));
}

interface Node {
  type: string;
  loc: { start: { offset: number }; end: { offset: number } } | null;
  name?: string;
  children?: Node[] | null;
  prelude?: Node | null;
  block?: Node | null;
  selector?: Node | null;
}

const STYLE = new Set(["font-face", "page", "nest"]);
const NESTED = new Set(["container", "media", "scope", "starting-style", "supports", "layer"]);

// Selectors 4's grammar where css-tree reads more: a combinator leads only a relative selector, sits
// between compounds, and a type selector leads its compound
function selectorErrors(sheet: Node): Error[] {
  const errors: Error[] = [];
  const at = (node: Node) => node.loc!.start.offset;
  const selector = (node: Node, relative: boolean) => {
    const children = node.children!;
    children.forEach((child, i) => {
      const previous = children[i - 1];
      if (child.type === "Combinator") {
        if (previous === undefined && !relative) errors.push(["Relative selector is not allowed here", at(child)]);
        else if (previous?.type === "Combinator") errors.push(["Compound selector is expected", at(child)]);
      } else if (child.type === "TypeSelector" && previous !== undefined && previous.type !== "Combinator") {
        errors.push(["Type selector must come first in a compound selector", at(child)]);
      }
      pseudo(child);
    });
    const last = children.at(-1)!;
    if (last.type === "Combinator") errors.push(["Compound selector is expected", last.loc!.end.offset]);
  };
  const list = (node: Node | null | undefined, relative: boolean) => {
    if (node?.type === "SelectorList") for (const child of node.children!) selector(child, relative);
    if (node?.type === "Selector") selector(node, relative);
  };
  const pseudo = (node: Node) => {
    if (node.type === "AttributeSelector" || !node.children) return;
    for (const child of node.children) {
      if (child.type === "Nth") list(child.selector, false);
      else list(child, node.name!.toLowerCase() === "has");
    }
  };
  const block = (children: Node[], style: boolean) => {
    for (const child of children) {
      if (child.type === "Rule") {
        list(child.prelude, style);
        block(child.block!.children!, true);
      } else if (child.type === "Atrule" && child.block) {
        const name = child.name!.toLowerCase();
        const inner = STYLE.has(name) || (NESTED.has(name) && style);
        block(child.block.children!, inner || name === "scope");
      }
    }
  };
  block(sheet.children!, false);
  return errors;
}

// CSS Syntax's tokenizer errors, from css-tree's tokens
function tokenErrors(source: string): Error[] {
  const errors: Error[] = [];
  const end = source.length;
  csstree.tokenize(source, (type, start, stop) => {
    const text = source.slice(start, stop);
    if (type === Comment && (text.length < 4 || !text.endsWith("*/"))) errors.push(["Unterminated comment", end]);
    if (type === csstree.tokenTypes.String && !closed(text)) errors.push(["Unterminated string", end]);
    if (type === BadString) errors.push(["Newline in string", stop - (text.endsWith("\r\n") ? 2 : 1)]);
    if (type === Url || type === BadUrl) {
      const error = urlError(source, start, Math.min(stop, end));
      if (error) errors.push(error);
    }
    if (type === Delim && text === "\\") errors.push(stop >= end ? ["Unexpected end of input", end] : ["Invalid escape", start]);
  });
  return errors;
}

function closed(text: string): boolean {
  for (let i = 1; i < text.length; ) {
    if (text[i] === text[0]) return i === text.length - 1;
    i += text[i] !== "\\" ? 1 : text.startsWith("\r\n", i + 1) ? 3 : 2;
  }
  return false;
}

const SPACE = /[ \t\n\r\f]/;
const NON_PRINTABLE = /[\x00-\x08\x0b\x0e-\x1f\x7f]/;

function urlError(source: string, start: number, stop: number): Error | null {
  let i = start + 4;
  while (i < stop && SPACE.test(source[i]!)) i++;
  while (i < stop) {
    const c = source[i]!;
    if (c === ")") return null;
    if (SPACE.test(c)) {
      while (i < source.length && SPACE.test(source[i]!)) i++;
      return i === source.length ? ["Unterminated url", source.length] : null;
    }
    if (c === '"' || c === "'" || c === "(" || NON_PRINTABLE.test(c)) return ["Unexpected character in url", i];
    if (c === "\\") {
      if (i + 1 === source.length) break;
      if (/[\n\r\f]/.test(source[i + 1]!)) return ["Invalid escape", i];
      i += escapeLength(source, i);
    } else i++;
  }
  return ["Unterminated url", source.length];
}

// `at` is the backslash
function escapeLength(source: string, at: number): number {
  let i = at + 2;
  if (/[0-9a-f]/i.test(source[i - 1]!)) {
    while (i < at + 7 && /[0-9a-f]/i.test(source[i] ?? "")) i++;
    if (SPACE.test(source[i] ?? "")) i += source.startsWith("\r\n", i) ? 2 : 1;
  }
  return i - at;
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

const { Semicolon, LeftCurlyBracket, RightCurlyBracket, WhiteSpace, Comment, AtKeyword, Ident, Colon, Delim, Url, BadUrl, BadString } =
  csstree.tokenTypes;

// css-tree's parser internals the fork calls; its typings leave them out
interface Parser {
  source: string;
  eof: boolean;
  tokenIndex: number;
  tokenCount: number;
  tokenType: number;
  tokenStart: number;
  tokenEnd: number;
  balance: Uint32Array;
  getTokenType(index: number): number;
  isBlockOpenerTokenType(type: number): boolean;
  isDelim(code: number): boolean;
  lookupNonWSType(offset: number): number;
  lookupType(offset: number): number;
  error(message?: string): never;
  Combinator(): unknown;
  next(): void;
  eat(type: number): void;
  createList(): unknown;
  createSingleNodeList(node: unknown): unknown;
  getLocation(start: number, end: number): unknown;
  parseWithFallback(consumer: () => unknown, fallback: () => unknown): unknown;
  consumeUntilSemicolonIncluded(code: number): number;
  Raw(consumeUntil: ((code: number) => number) | null, excludeWhiteSpace: boolean): unknown;
  Rule(): unknown;
  Declaration(): unknown;
  Atrule(isDeclaration: boolean): unknown;
  Block(isStyleBlock: boolean): unknown;
  LayerList(): unknown;
}

function nestedRuleAhead(this: Parser): boolean {
  const first = this.tokenIndex;
  for (let i = first; i < this.tokenCount; i++) {
    if (this.balance[i]! < first) return false;
    const type = this.getTokenType(i);
    if (type === Semicolon) return false;
    if (type === LeftCurlyBracket) return !customPropertyAhead.call(this);
    if (this.isBlockOpenerTokenType(type)) i = this.balance[i]!;
  }
  return false;
}

function customPropertyAhead(this: Parser): boolean {
  return this.tokenType === Ident && this.source.startsWith("--", this.tokenStart) && this.lookupNonWSType(1) === Colon;
}

// css-tree's Block, which reads a nested rule where a `{}` block comes before any `;`
function Block(this: Parser, isStyleBlock: boolean): unknown {
  const consumeRaw = () => this.Raw(null, true);
  const consumeRule = () => this.parseWithFallback(this.Rule, consumeRaw);
  const consumeDeclaration = () => {
    if (this.tokenType === Semicolon) return this.Raw(this.consumeUntilSemicolonIncluded, true);
    const node = this.parseWithFallback(this.Declaration, () => this.Raw(this.consumeUntilSemicolonIncluded, true));
    if (this.tokenType === Semicolon) this.next();
    return node;
  };
  const start = this.tokenStart;
  const children = this.createList() as { push(node: unknown): void };
  this.eat(LeftCurlyBracket);
  scan: while (!this.eof) {
    switch (this.tokenType) {
      case RightCurlyBracket:
        break scan;
      case WhiteSpace:
      case Comment:
        this.next();
        break;
      case AtKeyword:
        children.push(this.parseWithFallback(this.Atrule.bind(this, isStyleBlock), consumeRaw));
        break;
      default:
        if (!isStyleBlock || this.isDelim(0x26) || nestedRuleAhead.call(this)) children.push(consumeRule());
        else children.push(consumeDeclaration());
    }
  }
  if (!this.eof) this.eat(RightCurlyBracket);
  return { type: "Block", loc: this.getLocation(start, this.tokenStart), children };
}

const VERTICAL_LINE = 0x7c;
const base = (csstree.parse as unknown as { config: { scope: { Selector: { getNode(this: Parser): unknown } }; node: Record<string, (this: Parser) => unknown> } }).config;

function columnAhead(this: Parser): boolean {
  return this.isDelim(VERTICAL_LINE) && this.lookupType(1) === Delim && this.source.charCodeAt(this.tokenEnd) === VERTICAL_LINE;
}

// css-tree's TypeSelector, which leaves a `||` that follows to the column combinator
function TypeSelector(this: Parser): unknown {
  const start = this.tokenStart;
  const name = () => {
    if (this.tokenType !== Ident && !this.isDelim(0x2a)) this.error("Identifier or asterisk is expected");
    this.next();
  };
  if (this.isDelim(VERTICAL_LINE)) {
    this.next();
    name();
  } else {
    name();
    if (this.isDelim(VERTICAL_LINE) && !columnAhead.call(this)) {
      this.next();
      name();
    }
  }
  return { type: "TypeSelector", loc: this.getLocation(start, this.tokenStart), name: this.source.substring(start, this.tokenStart) };
}

export const reference: csstree.Syntax = csstree.fork({
  node: {
    Block: { parse: Block },
    TypeSelector: { parse: TypeSelector },
    Combinator: {
      parse(this: Parser) {
        if (!columnAhead.call(this)) return base.node.Combinator!.call(this);
        const start = this.tokenStart;
        this.next();
        this.next();
        return { type: "Combinator", loc: this.getLocation(start, this.tokenStart), name: "||" };
      },
    },
  },
  scope: {
    Selector: {
      getNode(this: Parser) {
        return columnAhead.call(this) ? this.Combinator() : base.scope.Selector.getNode.call(this);
      },
    },
  },
  atrule: {
    // css-tree's `@layer`, whose block nested in a style rule holds declarations too
    layer: {
      parse: {
        prelude(this: Parser) {
          return this.createSingleNodeList(this.LayerList());
        },
        block(this: Parser, nested = false) {
          return this.Block(nested);
        },
      },
    },
  },
} as unknown as Parameters<typeof csstree.fork>[0]);
