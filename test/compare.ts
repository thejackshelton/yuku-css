// yuku-css against css-tree, once a fork of css-tree parses as test/divergences.ts lists: the same
// tokens, the same tree with the same positions, and the same errors at the same offsets, with the
// errors the specs read where css-tree reads none placed among css-tree's by offset.
import { expect } from "bun:test";
import * as csstree from "css-tree";
import { parse, tokenize } from "yuku-css";

type Error = [message: string, offset: number];

export interface Options {
  parseValue?: boolean;
  parseCustomProperty?: boolean;
  parseAtrulePrelude?: boolean;
}

/** `options` go to both parsers. */
export function expectParity(source: string, options: Options = {}): void {
  const errors: Error[] = [];
  reported = errors;
  const expected = csstree.toPlainObject(
    reference.parse(source, {
      ...options,
      positions: true,
      onParseError: (error) => errors.push([error.message, (error as unknown as { offset: number }).offset]),
    }),
  );
  reported = [];
  const located = parse(source, { ...options, positions: true });
  expect(located.ast).toEqual(expected as never);
  const sheet = expected as unknown as Node;
  const spec = [...selectorErrors(sheet), ...conditionErrors(sheet, source), ...tokenErrors(source)].sort((a, b) => a[1] - b[1]);
  expect(located.diagnostics.map((d) => [d.message, d.start])).toEqual(merge(errors, spec));
  const plain = csstree.toPlainObject(reference.parse(source, options));
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
  root?: Node | null;
  limit?: Node | null;
  value?: Node | null;
  mediaType?: string | null;
  condition?: Node | null;
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
  // selector lists of preludes: `@page`, `@nest`, `@scope` and `selector()`
  const prelude = (node: Node | null | undefined) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "SelectorList" || node.type === "Selector") return list(node, false);
    if (node.type === "FeatureFunction") return list(node.value, false);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(prelude);
      else if (value && typeof value === "object" && "type" in value) prelude(value as Node);
    }
  };
  const block = (children: Node[], style: boolean) => {
    for (const child of children) {
      if (child.type === "Rule") {
        list(child.prelude, style);
        block(child.block!.children!, true);
      } else if (child.type === "Atrule") {
        prelude(child.prelude);
        if (!child.block) continue;
        const name = child.name!.toLowerCase();
        const inner = STYLE.has(name) || (NESTED.has(name) && style);
        block(child.block.children!, inner || name === "scope");
      }
    }
  };
  block(sheet.children!, false);
  return errors;
}

const RESERVED_MEDIA_TYPES = new Set(["only", "not", "and", "or", "layer"]);

// the condition grammars of mediaqueries-4 §3, css-conditional-3 §6.1 and css-contain-3 §6.1, where
// css-tree reads any order of keywords and terms, and the media types Media Queries 4 reserves
function conditionErrors(sheet: Node, source: string): Error[] {
  const errors: Error[] = [];
  const start = (node: Node) => node.loc!.start.offset;
  const end = (node: Node) => node.loc!.end.offset;
  const keyword = (node: Node) => (node.type === "Identifier" ? node.name!.toLowerCase() : null);
  const check = (condition: Node, withoutOr: boolean) => {
    const items = condition.children!;
    if (keyword(items[0]!) === "not") {
      if (items.length === 1) errors.push(["Condition in parentheses is expected", end(items[0]!)]);
      else if (items[1]!.type === "Identifier") errors.push(["Condition in parentheses is expected", start(items[1]!)]);
      else if (items.length > 2) errors.push(['"not" cannot be combined without parentheses', start(items[2]!)]);
      return;
    }
    if (items[0]!.type === "Identifier") return void errors.push(["Condition in parentheses is expected", start(items[0]!)]);
    let joined: string | null = null;
    for (let i = 1; i < items.length; i += 2) {
      const word = keyword(items[i]!);
      if (word !== "and" && word !== "or") return void errors.push(['Identifier "and" or "or" is expected', start(items[i]!)]);
      if (word === "or" && withoutOr) return void errors.push(['"or" cannot follow a media type', start(items[i]!)]);
      if (joined !== null && joined !== word) return void errors.push(['"and" and "or" cannot be mixed without parentheses', start(items[i]!)]);
      joined = word;
      if (i + 1 === items.length) return void errors.push(["Condition in parentheses is expected", end(items[i]!)]);
      if (items[i + 1]!.type === "Identifier") return void errors.push(["Condition in parentheses is expected", start(items[i + 1]!)]);
    }
  };
  // a condition is checked once the conditions inside it are, as yuku-css builds them
  const visit = (node: Node, withoutOr = false) => {
    if (node.type === "MediaQuery" && node.mediaType != null) {
      if (RESERVED_MEDIA_TYPES.has(node.mediaType.toLowerCase())) errors.push(["Media type is expected", mediaTypeStart(source, node)]);
      if (node.condition) visit(node.condition, true);
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === "loc") continue;
      if (Array.isArray(value)) for (const child of value) visit(child);
      else if (value && typeof value === "object" && "type" in value) visit(value as Node);
    }
    if (node.type === "Condition") check(node, withoutOr);
  };
  visit(sheet);
  return errors;
}

// css-tree keeps no position for a media type: the first identifier of its query, or the second after a modifier
function mediaTypeStart(source: string, query: Node & { modifier?: string | null }): number {
  const from = query.loc!.start.offset;
  const starts: number[] = [];
  csstree.tokenize(source.slice(from, query.loc!.end.offset), (type, start) => {
    if (type === Ident) starts.push(from + start);
  });
  return starts[query.modifier ? 1 : 0]!;
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

const {
  Semicolon,
  LeftCurlyBracket,
  RightCurlyBracket,
  WhiteSpace,
  Comment,
  AtKeyword,
  Ident,
  Colon,
  Delim,
  Url,
  BadUrl,
  BadString,
  EOF,
  LeftParenthesis,
  RightParenthesis,
  Function: FunctionToken,
  String: StringToken,
  Number: NumberToken,
  Dimension,
} = csstree.tokenTypes;

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
  getTokenStart(index: number): number;
  isBlockOpenerTokenType(type: number): boolean;
  isDelim(code: number): boolean;
  lookupNonWSType(offset: number): number;
  lookupType(offset: number): number;
  error(message?: string, offset?: number): never;
  skipSC(): void;
  lookupTypeNonSC(index: number): number;
  lookupOffsetNonSC(index: number): number;
  cmpStr(start: number, end: number, text: string): boolean;
  consume(type: number): string;
  eatIdent(name: string): void;
  scope: { Value: unknown };
  readSequence(recognizer: unknown): unknown;
  Identifier(): Node;
  Number(): unknown;
  Dimension(): unknown;
  Ratio(): unknown;
  String(): unknown;
  Url(): unknown;
  Layer(): Node & { value?: string };
  SelectorList(): unknown;
  MediaQueryList(): unknown;
  Function(readSequence: unknown, recognizer: unknown): unknown;
  Feature(kind: string): unknown;
  FeatureRange(kind: string): unknown;
  FeatureFunction(kind: string): unknown;
  GeneralEnclosed(kind: string): unknown;
  SupportsDeclaration(): unknown;
  Condition(kind: string): unknown;
  Combinator(): unknown;
  next(): void;
  skip(count: number): void;
  eat(type: number): void;
  createList(): { push(node: unknown): void; isEmpty: boolean };
  createSingleNodeList(node: unknown): unknown;
  getLocation(start: number, end: number): unknown;
  getLocationFromList(list: unknown): unknown;
  parseWithFallback(consumer: () => unknown, fallback: () => unknown): unknown;
  consumeUntilSemicolonIncluded(code: number): number;
  Raw(consumeUntil: ((code: number) => number) | null, excludeWhiteSpace: boolean): Node & { value?: string };
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


// css-tree's prelude grammars, where the end of input closes an open feature, range, condition in
// parentheses, scope selector, or import function, as CSS Syntax closes every block there
function closes(this: Parser): boolean {
  const type = this.lookupNonWSType(0);
  return type === RightParenthesis || type === EOF;
}

function featureValue(this: Parser): unknown {
  switch (this.tokenType) {
    case NumberToken:
      return this.lookupNonWSType(1) === Delim ? this.Ratio() : this.Number();
    case Dimension:
      return this.Dimension();
    case Ident:
      return this.Identifier();
    case FunctionToken:
      return this.parseWithFallback(() => {
        const node = this.Function(this.readSequence, this.scope.Value);
        this.skipSC();
        if (this.isDelim(0x2f)) this.error();
        return node;
      }, () => this.Ratio());
    default:
      this.error("Number, dimension, ratio or identifier is expected");
  }
}

function Feature(this: Parser, kind: string): unknown {
  const start = this.tokenStart;
  let value = null;
  this.eat(LeftParenthesis);
  this.skipSC();
  const name = this.consume(Ident);
  this.skipSC();
  if (this.tokenType !== RightParenthesis && !this.eof) {
    this.eat(Colon);
    this.skipSC();
    value = featureValue.call(this);
    this.skipSC();
  }
  if (!this.eof) this.eat(RightParenthesis);
  return { type: "Feature", loc: this.getLocation(start, this.tokenStart), kind, name, value };
}

function rangeTerm(this: Parser): unknown {
  this.skipSC();
  if (this.tokenType === NumberToken) {
    const offset = this.lookupOffsetNonSC(1);
    const slash = offset ? this.lookupType(offset) === Delim && this.source.charCodeAt(lookupOffset.call(this, offset)) === 0x2f : this.isDelim(0x2f);
    return slash ? this.Ratio() : this.Number();
  }
  return featureValue.call(this);
}

function lookupOffset(this: Parser, offset: number): number {
  const index = this.tokenIndex + offset;
  return index < this.tokenCount ? this.getTokenStart(index) : this.source.length;
}

function comparison(this: Parser, expectColon: boolean): string {
  this.skipSC();
  if (this.isDelim(0x3c) || this.isDelim(0x3e)) {
    const value = this.source[this.tokenStart]!;
    this.next();
    if (this.isDelim(0x3d)) {
      this.next();
      return value + "=";
    }
    return value;
  }
  if (this.isDelim(0x3d)) return "=";
  this.error(`Expected ${expectColon ? '":", ' : ""}"<", ">", "=" or ")"`);
}

function FeatureRange(this: Parser, kind: string): unknown {
  const start = this.tokenStart;
  this.skipSC();
  this.eat(LeftParenthesis);
  const left = rangeTerm.call(this) as Node;
  const leftComparison = comparison.call(this, left.type === "Identifier");
  const middle = rangeTerm.call(this);
  let rightComparison = null;
  let right = null;
  if (!closes.call(this)) {
    rightComparison = comparison.call(this, false);
    right = rangeTerm.call(this);
  }
  this.skipSC();
  if (!this.eof) this.eat(RightParenthesis);
  return { type: "FeatureRange", loc: this.getLocation(start, this.tokenStart), kind, left, leftComparison, middle, rightComparison, right };
}

// the errors css-tree reports while the fork parses, so a reading it drops takes back its errors
let reported: Error[] = [];

function silently(this: Parser, consumer: () => unknown): unknown {
  const start = this.tokenIndex;
  const count = reported.length;
  try {
    return consumer();
  } catch {
    this.skip(start - this.tokenIndex);
    reported.length = count;
    return null;
  }
}

function Condition(this: Parser, kind = "media"): unknown {
  const children = this.createList();
  const inParens = () => {
    if (kind === "supports") return this.SupportsDeclaration();
    const likely = [Colon, RightParenthesis, EOF].includes(this.lookupTypeNonSC(2));
    return this.lookupTypeNonSC(1) === Ident && likely ? this.Feature(kind) : this.FeatureRange(kind);
  };
  scan: while (!this.eof) {
    switch (this.tokenType) {
      case Comment:
      case WhiteSpace:
        this.next();
        continue;
      case Ident:
        children.push(this.Identifier());
        break;
      case LeftParenthesis: {
        const nested = () => {
          this.eat(LeftParenthesis);
          const node = this.Condition(kind);
          if (!this.eof) this.eat(RightParenthesis);
          return node;
        };
        // each reading is as valid as the others, so none reports the errors of those tried before it
        let term = silently.call(this, inParens) ?? silently.call(this, nested);
        if (!term) {
          const count = reported.length;
          term = this.GeneralEnclosed(kind);
          reported.length = count;
        }
        children.push(term);
        break;
      }
      case FunctionToken:
        children.push(this.parseWithFallback(() => this.FeatureFunction(kind), () => null) ?? this.GeneralEnclosed(kind));
        break;
      default:
        break scan;
    }
  }
  if (children.isEmpty) this.error("Condition is expected");
  return { type: "Condition", loc: this.getLocationFromList(children), kind, children };
}

function Scope(this: Parser): unknown {
  let root = null;
  let limit = null;
  const selectors = () => {
    this.skipSC();
    const node = this.parseWithFallback(this.SelectorList, () => this.Raw(null, true));
    this.skipSC();
    if (!this.eof) this.eat(RightParenthesis);
    return node;
  };
  this.skipSC();
  const start = this.tokenStart;
  if (this.tokenType === LeftParenthesis) {
    this.next();
    root = selectors();
  }
  if (this.lookupNonWSType(0) === Ident) {
    this.skipSC();
    this.eatIdent("to");
    this.skipSC();
    this.eat(LeftParenthesis);
    limit = selectors();
  }
  return { type: "Scope", loc: this.getLocation(start, this.tokenStart), root, limit };
}

function closedFunction(this: Parser, parse: () => unknown, fallback?: () => unknown): unknown {
  return this.parseWithFallback(() => {
    try {
      return parse.call(this);
    } finally {
      this.skipSC();
      if (!closes.call(this)) this.error();
    }
  }, fallback ?? (() => this.Raw(null, true)));
}

const importFunctions = {
  layer(this: Parser) {
    this.skipSC();
    const children = this.createList();
    const node = closedFunction.call(this, this.Layer) as Node & { value?: string };
    if (node.type !== "Raw" || node.value !== "") children.push(node);
    return children;
  },
  supports(this: Parser) {
    this.skipSC();
    const children = this.createList();
    const node = closedFunction.call(this, this.Declaration, () => closedFunction.call(this, () => this.Condition("supports"))) as Node & { value?: string };
    if (node.type !== "Raw" || node.value !== "") children.push(node);
    return children;
  },
};

function importPrelude(this: Parser): unknown {
  const children = this.createList();
  switch (this.tokenType) {
    case StringToken:
      children.push(this.String());
      break;
    case Url:
    case FunctionToken:
      children.push(this.Url());
      break;
    default:
      this.error("String or url() is expected");
  }
  this.skipSC();
  if (this.tokenType === Ident && this.cmpStr(this.tokenStart, this.tokenEnd, "layer")) children.push(this.Identifier());
  else if (this.tokenType === FunctionToken && this.cmpStr(this.tokenStart, this.tokenEnd, "layer(")) children.push(this.Function(null, importFunctions));
  this.skipSC();
  if (this.tokenType === FunctionToken && this.cmpStr(this.tokenStart, this.tokenEnd, "supports(")) children.push(this.Function(null, importFunctions));
  if (this.lookupNonWSType(0) === Ident || this.lookupNonWSType(0) === LeftParenthesis) children.push(this.MediaQueryList());
  return children;
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

// mediaqueries-5's `@custom-media`: an extension name, then a media query list or `true` or `false`
function customMediaPrelude(this: Parser): unknown {
  const children = this.createList();
  if (this.tokenType !== Ident || !this.source.startsWith("--", this.tokenStart)) this.error("Extension name is expected");
  children.push(this.Identifier());
  this.skipSC();
  const word = this.source.slice(this.tokenStart, this.tokenEnd).toLowerCase();
  const ends = [Semicolon, LeftCurlyBracket, EOF].includes(this.lookupTypeNonSC(1));
  if (this.tokenType === Ident && (word === "true" || word === "false") && ends) children.push(this.Identifier());
  else children.push(this.MediaQueryList());
  return children;
}

export const reference: csstree.Syntax = csstree.fork({
  node: {
    Block: { parse: Block },
    Feature: { parse: Feature },
    FeatureRange: { parse: FeatureRange },
    Condition: { parse: Condition },
    Scope: { parse: Scope },
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
    import: { parse: { prelude: importPrelude, block: null } },
    "custom-media": { parse: { prelude: customMediaPrelude } },
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
