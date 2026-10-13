// css-tree's `Lexer` over the wasm matcher: names resolve and values match in Zig, and the match
// tree, errors and dictionaries are built here in css-tree's shapes
import { keyword, property } from "../ast/names";
import { generate as generateCss, type Handlers } from "../codegen";
import { List } from "../ast/list";
import type { AnyNode, Node } from "../ast/node";
import { walk as walkTree } from "../ast/walk";
import { STRUCTURES } from "./structure";
import { MESSAGES } from "./tables";
import {
  customError,
  definitionSyntaxError,
  plainError,
  generate,
  parse,
  SyntaxReader,
  walk,
  type SyntaxNode,
  type SyntaxRange,
} from "./syntax";
import { encode, release, take, text, utf16Offset, wasm } from "./wasm";

const encoder = new TextEncoder();

// the UTF-16 offset of byte `offset` in `source`
function utf16OffsetOf(source: string, offset: number): number {
  return utf16Offset(source, { pointer: 0, len: 0, capacity: 0, ascii: false }, offset);
}

const NONE = 0xffffffff;
const NO_PRELUDE = NONE - 1;
const NO_DESCRIPTORS = NONE - 1;
const KIND = { type: 0, property: 1, prelude: 2, descriptor: 3, anonymous: 4 } as const;
const ENTRY_TOKEN = 1;
const ENTRY_OPEN = 2;
const STATUS = ["Match", "Mismatch", "Maximum iteration number exceeded (please fill an issue on https://github.com/csstree/csstree/issues)"];
const HEADER = 10;

/** css-tree's unit groups, as the lexer reads dimensions. */
export const unitGroups = ["length", "angle", "time", "frequency", "resolution", "flex", "decibel", "semitones"] as const;
export type Units = Record<(typeof unitGroups)[number], string[]>;

const DEFAULT_UNITS: Units = {
  length: [
    "cm", "mm", "q", "in", "pt", "pc", "px", "em", "rem", "ex", "rex", "cap", "rcap", "ch", "rch", "ic", "ric",
    "lh", "rlh", "vw", "svw", "lvw", "dvw", "vh", "svh", "lvh", "dvh", "vi", "svi", "lvi", "dvi", "vb", "svb",
    "lvb", "dvb", "vmin", "svmin", "lvmin", "dvmin", "vmax", "svmax", "lvmax", "dvmax", "cqw", "cqh", "cqi",
    "cqb", "cqmin", "cqmax",
  ],
  angle: ["deg", "grad", "rad", "turn"],
  time: ["s", "ms"],
  frequency: ["hz", "khz"],
  resolution: ["dpi", "dpcm", "dppx", "x"],
  flex: ["fr"],
  decibel: ["db"],
  semitones: ["st"],
};
const CSS_WIDE_KEYWORDS = ["initial", "inherit", "unset", "revert", "revert-layer"];

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  createLexer(builtin: number, generic: number): number;
  define(id: number, kind: number, pointer: number, nameLen: number, atruleLen: number, syntaxLen: number): number;
  declareAtrule(id: number, pointer: number, len: number): number;
  failureWord(i: number): number;
  setUnits(id: number, group: number, pointer: number, len: number): number;
  setCssWide(id: number, pointer: number, len: number): number;
  find(id: number, kind: number, pointer: number, nameLen: number, atruleLen: number): number;
  descriptorRoot(id: number, descriptor: number): number;
  inputBuffer(len: number): number;
  tokenBuffer(count: number): number;
  match(id: number, descriptor: number, cssWide: number, len: number): number;
  matchTokens(id: number, descriptor: number, cssWide: number, len: number, count: number): number;
  validate(id: number, len: number): number;
  names(id: number): number;
  defsLayout(): number;
}

const exports = (): Exports => wasm() as unknown as Exports;

/** A syntax a lexer is given: definition syntax as text or as a tree. */
export type SyntaxSource = string | SyntaxNode;

/** What `createLexer` and `fork` take, as css-tree's lexer config. */
export interface LexerConfig {
  generic?: boolean;
  cssWideKeywords?: string[];
  units?: Partial<Record<string, string[]>>;
  types?: Record<string, SyntaxSource | null | undefined>;
  properties?: Record<string, SyntaxSource | null | undefined>;
  atrules?: Record<string, { prelude?: SyntaxSource | null; descriptors?: Record<string, SyntaxSource | null> | null } | null | undefined>;
}

/** A definition a lexer holds, as css-tree's descriptors. */
export interface Descriptor {
  readonly type: "Type" | "Property" | "AtrulePrelude" | "AtruleDescriptor";
  readonly name: string;
  readonly parent: string | null;
  readonly serializable: boolean;
  /** The definition as a tree, null for a generic type. */
  readonly syntax: SyntaxNode | null;
}

export interface AtruleDescriptor {
  readonly type: "Atrule";
  readonly name: string;
  readonly prelude: Descriptor | null;
  readonly descriptors: Record<string, Descriptor> | null;
}

/** A node of a match tree: a definition with what it matched, or a token. */
export type MatchNode =
  | { syntax: SyntaxNode | { type: string; name: string } | null; match: MatchNode[] }
  | { syntax: SyntaxNode | null; token: string; node: unknown };

/** css-tree's match result. */
export interface MatchResult {
  matched: MatchNode | null;
  iterations: number | undefined;
  error: Error | SyntaxMatchError | null;
  getTrace(node: unknown): (SyntaxNode | { type: string; name: string })[] | null;
  isType(node: unknown, type: string): boolean;
  isProperty(node: unknown, property: string): boolean;
  isKeyword(node: unknown): boolean;
}

export interface Position {
  offset: number;
  line: number;
  column: number;
}

/** css-tree's `SyntaxMatchError`. */
export interface SyntaxMatchError extends SyntaxError, Position {
  rawMessage: string;
  syntax: string;
  css: string;
  mismatchOffset: number;
  mismatchLength: number;
  loc: { source: string; start: Position; end: Position };
}

/** css-tree's `SyntaxReferenceError`. */
export interface SyntaxReferenceError extends SyntaxError {
  reference: string | undefined;
}

export function syntaxReferenceError(type: string, referenceName?: string): SyntaxReferenceError {
  const error = customError("SyntaxReferenceError", type + (referenceName ? " `" + referenceName + "`" : ""), false);
  (error as SyntaxReferenceError).reference = referenceName;
  return error as SyntaxReferenceError;
}

// the trees the matcher's definitions are, decoded once each and shared, so a match tree's
// `syntax` is the very node of its descriptor's `syntax`
const memo: (SyntaxNode | SyntaxRange | undefined)[] = [];
const layoutWords = new Uint32Array(8);

function syntaxAt(index: number): SyntaxNode {
  const known = memo[index];
  if (known !== undefined) return known as SyntaxNode;
  const e = exports();
  layoutWords.set(new Uint32Array(e.memory.buffer, e.defsLayout(), 8));
  const [builtinNodes, builtinCount, builtinText, builtinTextLen, nodes, count, chars, charsLen] = layoutWords;
  // a holey array past its length falls back to a slow dictionary, so it grows filled
  while (memo.length < builtinCount! + count!) memo.push(undefined);
  const buffer = e.memory.buffer;
  const builtin = index < builtinCount!;
  const words = builtin
    ? new Uint32Array(buffer, builtinNodes!, builtinCount!)
    : new Uint32Array(buffer, nodes!, count! * 2);
  const bytes = builtin ? new Uint8Array(buffer, builtinText!, builtinTextLen!) : new Uint8Array(buffer, chars!, charsLen!);
  const base = builtin ? 0 : builtinCount!;
  const reader = new SyntaxReader(words, (start, len) => text(bytes, start, len), memo, base, builtin);
  return reader.read(index - base)[0];
}

function getTrace(this: MatchResult, node: unknown) {
  const put = (syntax: MatchNode["syntax"]) =>
    syntax !== null && (syntax.type === "Type" || syntax.type === "Property" || syntax.type === "Keyword");
  let result: (SyntaxNode | { type: string; name: string })[] | null = null;
  const has = (match: MatchNode): boolean => {
    if ("match" in match) {
      for (const inner of match.match) {
        if (has(inner)) {
          if (put(match.syntax)) result!.unshift(match.syntax as SyntaxNode);
          return true;
        }
      }
    } else if (match.node === node) {
      result = put(match.syntax) ? [match.syntax as SyntaxNode] : [];
      return true;
    }
    return false;
  };
  if (this.matched !== null) has(this.matched);
  return result;
}

function testNode(match: MatchResult, node: unknown, fn: (syntax: { type: string; name?: string }) => boolean) {
  const trace = match.getTrace(node);
  return trace !== null && trace.some(fn);
}

const trace: Pick<MatchResult, "getTrace" | "isType" | "isProperty" | "isKeyword"> = {
  getTrace,
  isType(this: MatchResult, node: unknown, type: string) {
    return testNode(this, node, (match) => match.type === "Type" && match.name === type);
  },
  isProperty(this: MatchResult, node: unknown, property: string) {
    return testNode(this, node, (match) => match.type === "Property" && match.name === property);
  },
  isKeyword(this: MatchResult, node: unknown) {
    return testNode(this, node, (match) => match.type === "Keyword");
  },
};

// a match result whose tree and error are built on first read, so checking a value pays for neither
class Result implements MatchResult {
  declare iterations: number | undefined;
  declare private tree: MatchNode | null | (() => MatchNode);
  declare private failure: MatchResult["error"] | (() => MatchResult["error"]);

  constructor(
    matched: MatchNode | null | (() => MatchNode),
    error: MatchResult["error"] | (() => MatchResult["error"]),
    iterations?: number,
  ) {
    this.tree = matched;
    this.failure = error;
    this.iterations = iterations;
  }

  get matched(): MatchNode | null {
    if (typeof this.tree === "function") this.tree = this.tree();
    return this.tree;
  }

  set matched(value: MatchNode | null) {
    this.tree = value;
  }

  get error(): Error | SyntaxMatchError | null {
    if (typeof this.failure === "function") this.failure = this.failure();
    return this.failure;
  }

  set error(value: Error | SyntaxMatchError | null) {
    this.failure = value;
  }

  toJSON(): { matched: MatchNode | null; iterations: number | undefined; error: MatchResult["error"] } {
    return { matched: this.matched, iterations: this.iterations, error: this.error };
  }

  getTrace(node: unknown): ReturnType<MatchResult["getTrace"]> {
    return trace.getTrace.call(this, node);
  }

  isType(node: unknown, type: string): boolean {
    return trace.isType.call(this, node, type);
  }

  isProperty(node: unknown, property: string): boolean {
    return trace.isProperty.call(this, node, property);
  }

  isKeyword(node: unknown): boolean {
    return trace.isKeyword.call(this, node);
  }
}

function buildMatchResult(matched: MatchNode | null, error: MatchResult["error"], iterations?: number): MatchResult {
  return new Result(matched, error, iterations);
}

function buildLoc({ offset, line, column }: Position, extra?: string): Position {
  const loc = { offset, line, column };
  if (extra) {
    const lines = extra.split(/\n|\r\n?|\f/);
    loc.offset += extra.length;
    loc.line += lines.length - 1;
    loc.column = lines.length === 1 ? loc.column + extra.length : lines.pop()!.length + 1;
  }
  return loc;
}

function syntaxMatchError(
  message: string,
  generated: string,
  css: string,
  mismatchOffset: number,
  mismatchLength: number,
  atEnd: boolean,
  at?: Position,
  until?: Position,
): SyntaxMatchError {
  const error = customError("SyntaxMatchError", message, false) as SyntaxMatchError;
  let start: Position;
  let end: Position;
  if (at !== undefined) {
    start = at;
    end = until!;
  } else if (atEnd) {
    start = buildLoc({ offset: 0, line: 1, column: 1 }, css);
    end = buildLoc(start);
  } else {
    start = buildLoc({ offset: 0, line: 1, column: 1 }, css.slice(0, mismatchOffset));
    end = buildLoc(start, css.substr(mismatchOffset, mismatchLength));
  }
  error.rawMessage = message;
  error.syntax = generated;
  error.css = css;
  error.mismatchOffset = mismatchOffset;
  error.mismatchLength = mismatchLength;
  error.message =
    message + "\n  syntax: " + generated + "\n   value: " + (css || "<empty string>") + "\n  --------" +
    "-".repeat(mismatchOffset) + "^";
  error.offset = start.offset;
  error.line = start.line;
  error.column = start.column;
  error.loc = { source: "<unknown>", start, end };
  return error;
}

// what a tree prints as tokens, each with the node that printed it, as css-tree's prepare-tokens
interface Printed {
  values: string[];
  types: number[];
  nodes: unknown[];
}

function printTokens(value: Node): Printed {
  const printed: Printed = { values: [], types: [], nodes: [] };
  let current: unknown = null;
  generateCss(value, {
    decorator: (handlers): Handlers => ({
      ...handlers,
      node(node) {
        const outer = current;
        current = node;
        handlers.node.call(this, node);
        current = outer;
      },
      emit(text, type, auto) {
        printed.values.push(text);
        printed.types.push(type);
        printed.nodes.push(auto ? null : current);
      },
      result: () => "",
    }),
  });
  return printed;
}

function utf8Length(text: string): number {
  let len = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) len += 1;
    else if (c < 0x800) len += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      len += 4;
      i++;
    } else len += 3;
  }
  return len;
}

type Located = { loc?: { source?: string; start?: Position; end?: Position } | null } | null;

function fromLoc(node: unknown, point: "start" | "end"): Position | null {
  const value = (node as Located)?.loc?.[point];
  if (!value) return null;
  return "line" in value ? buildLoc(value) : value;
}

// css-tree's `SyntaxMatchError` over printed tokens: where the mismatch is, by the node it is in
// when the value is a tree
function treeMatchError(message: string, generated: string, printed: Printed, longest: number, node: unknown): SyntaxMatchError {
  const { values, nodes } = printed;
  const mismatchNode = longest < values.length ? (nodes[longest] ?? null) : null;
  const badNode = mismatchNode !== node ? mismatchNode : null;
  let mismatchOffset = 0;
  let mismatchLength = 0;
  let entries = 0;
  let css = "";
  for (let i = 0; i < values.length; i++) {
    const token = values[i]!;
    if (i === longest) {
      mismatchLength = token.length;
      mismatchOffset = css.length;
    }
    if (badNode !== null && nodes[i] === badNode) entries = i <= longest ? entries + 1 : 0;
    css += token;
  }
  const origin = { offset: 0, line: 1, column: 1 };
  let start: Position;
  let end: Position;
  if (longest === values.length || entries > 1) {
    start = fromLoc(badNode || node, "end") || buildLoc(origin, css);
    end = buildLoc(start);
  } else {
    start = fromLoc(badNode, "start") || buildLoc(fromLoc(node, "start") || origin, css.slice(0, mismatchOffset));
    end = fromLoc(badNode, "end") || buildLoc(start, css.substr(mismatchOffset, mismatchLength));
  }
  const error = syntaxMatchError(message, generated, css, mismatchOffset, mismatchLength, false);
  return Object.assign(error, {
    ...start,
    loc: { source: (node as Located)?.loc?.source || "<unknown>", start, end },
  });
}

function firstNode(match: MatchNode): unknown {
  return "node" in match ? match.node : firstNode(match.match[0]!);
}

function lastNode(match: MatchNode): unknown {
  return "node" in match ? match.node : lastNode(match.match[match.match.length - 1]!);
}

/** A run of sibling nodes a definition matched, as css-tree's fragment search finds it. */
export interface Fragment {
  parent: List<AnyNode> | AnyNode[];
  nodes: List<AnyNode> | AnyNode[];
}

// css-tree's `matchFragments`: for each match of the named definition, the siblings from its first
// node to its last
function matchFragments(ast: unknown, match: MatchResult, type: string, name: string): Fragment[] {
  const fragments: Fragment[] = [];
  const find = (match: MatchNode): void => {
    const syntax = match.syntax as { type?: string; name?: string } | null;
    if (syntax !== null && syntax.type === type && syntax.name === name) {
      const start = firstNode(match);
      const end = lastNode(match);
      walkTree(ast as Node, (node, item, list) => {
        if (node !== start || list === undefined) return;
        if (Array.isArray(list)) {
          const nodes: AnyNode[] = [];
          for (let i = item as number; i < list.length; i++) {
            nodes.push(list[i]!);
            if (list[i] === end) break;
          }
          fragments.push({ parent: list, nodes });
          return;
        }
        const nodes = new List<AnyNode>();
        for (let cursor = item as { data: AnyNode; next: unknown } | null; cursor !== null; cursor = cursor.next as never) {
          nodes.appendData(cursor.data);
          if (cursor.data === end) break;
        }
        fragments.push({ parent: list, nodes });
      });
    }
    if ("match" in match) match.match.forEach(find);
  };
  if (match.matched !== null) find(match.matched);
  return fragments;
}

/** A node `checkStructure` finds malformed, and why. */
export interface StructureWarning {
  node: unknown;
  message: string;
}

function isValidNumber(value: unknown): boolean {
  return typeof value === "number" && isFinite(value) && Math.floor(value) === value && value >= 0;
}

function isValidLocation(loc: unknown): boolean {
  const at = loc as Position | undefined;
  return Boolean(at) && isValidNumber(at!.offset) && isValidNumber(at!.line) && isValidNumber(at!.column);
}

// css-tree's structure check of one node; a yuku-css node's numeric `start` and `end` stand for `loc`
function checkNode(node: any, warn: (node: unknown, message: string) => void): void {
  const fields = STRUCTURES[node?.type];
  if (fields === undefined) return warn(node, "Unknown node type `" + node?.type + "`");
  const type: string = node.type;
  if (!node || node.constructor !== Object) return warn(node, "Type of node should be an Object");
  const offsets = isValidNumber(node.start) && isValidNumber(node.end) && !Object.hasOwn(node, "loc");
  for (let key in node) {
    if (!Object.hasOwn(node, key)) continue;
    let valid = true;
    if (key === "type") {
      if (node.type !== type) warn(node, "Wrong node type `" + node.type + "`, expected `" + type + "`");
    } else if (key === "loc") {
      if (node.loc === null) continue;
      if (node.loc && node.loc.constructor === Object) {
        if (typeof node.loc.source !== "string") key += ".source";
        else if (!isValidLocation(node.loc.start)) key += ".start";
        else if (!isValidLocation(node.loc.end)) key += ".end";
        else continue;
      }
      valid = false;
    } else if (offsets && (key === "start" || key === "end")) {
      continue;
    } else if (Object.hasOwn(fields, key)) {
      const value = node[key];
      valid = fields[key]!.some((field) =>
        field === "string"
          ? typeof value === "string"
          : field === "boolean"
            ? typeof value === "boolean"
            : field === "null"
              ? value === null
              : field === "list"
                ? value instanceof List || Array.isArray(value)
                : Boolean(value) && value.type === field,
      );
    } else {
      warn(node, "Unknown field `" + key + "` for " + type + " node type");
    }
    if (!valid) warn(node, "Bad value for `" + type + "." + key + "`");
  }
  if (!offsets && !Object.hasOwn(node, "loc")) warn(node, "Field `" + type + ".loc` is missed");
  for (const key in fields) {
    if (Object.hasOwn(fields, key) && !Object.hasOwn(node, key)) {
      warn(node, "Field `" + type + "." + key + "` is missed");
    }
  }
}

// what every declaration of one `matchStylesheet` call shares: the source, its offsets and lines
class Sheet {
  declare readonly lexer: Lexer;
  declare readonly source: string;
  declare readonly words: Uint32Array;

  declare private lines: number[] | undefined;
  /** Match trees by where their entries start, as declarations written alike share their entries. */
  declare readonly trees: Map<number, MatchNode>;

  constructor(lexer: Lexer, source: string, words: Uint32Array) {
    this.lexer = lexer;
    this.source = source;
    this.words = words;
    this.lines = undefined;
    this.trees = new Map();
  }

  /** The UTF-16 offset the WebAssembly gives, which it has turned from bytes already. */
  at(offset: number): number {
    return offset;
  }

  /** css-tree's position of UTF-16 offset `offset`: lines break at \n, \r\n, \r and \f. */
  position(offset: number): Position {
    if (this.lines === undefined) {
      const lines = [0];
      const source = this.source;
      if (source.indexOf("\r") === -1 && source.indexOf("\f") === -1) {
        // the native search runs far faster than a loop over each character
        for (let at = source.indexOf("\n"); at !== -1; at = source.indexOf("\n", at + 1)) lines.push(at + 1);
      } else {
        for (let i = 0; i < source.length; i++) {
          const c = source.charCodeAt(i);
          if (c === 10 || c === 12 || (c === 13 && source.charCodeAt(i + 1) !== 10)) lines.push(i + 1);
        }
      }
      this.lines = lines;
    }
    const lines = this.lines;
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (lines[mid]! <= offset) low = mid;
      else high = mid - 1;
    }
    return { offset, line: low + 1, column: offset - lines[low]! + 1 };
  }
}

const RECORD = {
  propertyStart: 0,
  propertyEnd: 1,
  valueStart: 2,
  valueEnd: 3,
  status: 4,
  iterations: 5,
  longestStart: 6,
  longestEnd: 7,
  entries: 8,
  entryCount: 9,
  reference: 10,
  wide: 11,
} as const;

/** A declaration `matchStylesheet` matched: where it is, and its match result. */
export interface DeclarationMatch extends MatchResult {
  /** The property as written. */
  readonly property: string;
  /** Where the value starts and ends in the source, as UTF-16 offsets. */
  readonly start: number;
  readonly end: number;
}

// a declaration's result, read from the words the WebAssembly wrote when first asked
class Declaration implements DeclarationMatch {
  declare private readonly sheet: Sheet;
  declare private readonly base: number;
  declare private tree: MatchNode | null | undefined;
  declare private failure: MatchResult["error"] | undefined;

  constructor(sheet: Sheet, base: number) {
    this.sheet = sheet;
    this.base = base;
    this.tree = undefined;
    this.failure = undefined;
  }

  private word(field: number): number {
    return this.sheet.words[this.base + field]!;
  }

  get property(): string {
    const sheet = this.sheet;
    return sheet.source.slice(sheet.at(this.word(RECORD.propertyStart)), sheet.at(this.word(RECORD.propertyEnd)));
  }

  get start(): number {
    return this.sheet.at(this.word(RECORD.valueStart));
  }

  get end(): number {
    return this.sheet.at(this.word(RECORD.valueEnd));
  }

  get iterations(): number | undefined {
    return this.word(RECORD.status) >= 4 ? undefined : this.word(RECORD.iterations);
  }

  get matched(): MatchNode | null {
    if (this.tree === undefined) {
      if (this.word(RECORD.status) !== 0) this.tree = null;
      else {
        // a declaration written as an earlier one shares its tree, which holds no nodes of its own
        const trees = this.sheet.trees;
        const key = this.word(RECORD.entryCount) === 0 ? -1 : this.word(RECORD.entries);
        let tree = trees.get(key);
        if (tree === undefined) {
          tree = this.buildTree();
          if (key !== -1) trees.set(key, tree);
        }
        this.tree = tree;
      }
    }
    return this.tree;
  }

  get error(): Error | SyntaxMatchError | null {
    if (this.failure === undefined) this.failure = this.buildError();
    return this.failure;
  }

  private descriptor(): Descriptor {
    return this.sheet.lexer.getProperty(this.property)!;
  }

  private buildTree(): MatchNode {
    const sheet = this.sheet;
    const descriptor = this.word(RECORD.wide) ? null : this.descriptor();
    const root: MatchNode = { syntax: descriptor === null ? null : sheet.lexer.referenceOf(descriptor), match: [] };
    const stack: { match: MatchNode[] }[] = [root];
    let host = root as { match: MatchNode[] };
    const words = sheet.words;
    const end = this.word(RECORD.entries) + 4 * this.word(RECORD.entryCount);
    for (let at = this.word(RECORD.entries); at < end; at += 4) {
      const kind = words[at]! & 0xff;
      const syntax = words[at + 1]!;
      if (kind === ENTRY_TOKEN) {
        host.match.push({
          syntax: syntax === NONE ? null : syntaxAt(syntax),
          token: sheet.source.slice(sheet.at(words[at + 2]!), sheet.at(words[at + 3]!)),
          node: null,
        });
      } else if (kind === ENTRY_OPEN) {
        const next = { syntax: syntaxAt(syntax), match: [] as MatchNode[] };
        host.match.push(next);
        stack.push(next);
        host = next;
      } else {
        stack.pop();
        host = stack[stack.length - 1]!;
      }
    }
    return root;
  }

  private buildError(): Error | SyntaxMatchError | null {
    const status = this.word(RECORD.status);
    const sheet = this.sheet;
    switch (status) {
      case 0:
        return null;
      case 3: {
        const node = syntaxAt(this.word(RECORD.reference)) as { type: string; name: string };
        return plainError("Bad syntax reference: " + (node.type === "Type" ? "<" + node.name + ">" : "<'" + node.name + "'>"));
      }
      case 4:
        return plainError("Matching for a tree with var() is not supported");
      case 5:
        return plainError("Lexer matching doesn't applicable for custom properties");
      case 6:
        return syntaxReferenceError("Unknown property", this.property);
    }
    const valueStart = this.start;
    const css = sheet.source.slice(valueStart, this.end);
    const atEnd = this.word(RECORD.longestStart) === NONE;
    const mismatchStart = atEnd ? valueStart : sheet.at(this.word(RECORD.longestStart));
    const mismatchEnd = atEnd ? valueStart : sheet.at(this.word(RECORD.longestEnd));
    const start = sheet.position(atEnd ? this.end : mismatchStart);
    const end = atEnd ? start : sheet.position(mismatchEnd);
    return syntaxMatchError(
      STATUS[status]!,
      sheet.lexer.generatedOf(this.descriptor()),
      css,
      mismatchStart - valueStart,
      mismatchEnd - mismatchStart,
      atEnd,
      start,
      end,
    );
  }

  toJSON(): { property: string; start: number; end: number; matched: MatchNode | null; iterations: number | undefined; error: MatchResult["error"] } {
    return {
      property: this.property,
      start: this.start,
      end: this.end,
      matched: this.matched,
      iterations: this.iterations,
      error: this.error,
    };
  }

  getTrace(node: unknown): ReturnType<MatchResult["getTrace"]> {
    return trace.getTrace.call(this, node);
  }

  isType(node: unknown, type: string): boolean {
    return trace.isType.call(this, node, type);
  }

  isProperty(node: unknown, property: string): boolean {
    return trace.isProperty.call(this, node, property);
  }

  isKeyword(node: unknown): boolean {
    return trace.isKeyword.call(this, node);
  }
}

/** css-tree's lexer: matches values against the grammar it holds. */
export class Lexer {
  readonly cssWideKeywords: string[];
  readonly units: Units;
  readonly generic: boolean;
  /** @internal */
  readonly id: number;
  private readonly cache: Map<string, number>[] = [new Map(), new Map(), new Map(), new Map()];
  private readonly descriptors = new Map<number, Descriptor>();
  private readonly ids = new Map<Descriptor, number>();
  private readonly anonymous = new Map<string, number>();
  private dictionaries?: { types: Record<string, Descriptor>; properties: Record<string, Descriptor>; atrules: Record<string, AtruleDescriptor> };

  /** @internal */
  constructor(id: number, generic: boolean, cssWideKeywords: string[], units: Units) {
    this.id = id;
    this.generic = generic;
    this.cssWideKeywords = cssWideKeywords;
    this.units = units;
  }

  private call<T>(strings: string[], run: (pointer: number, lens: number[]) => T): T {
    const encoded = encode(strings.join(""));
    try {
      const lens = strings.map((s) => (encoded.ascii ? s.length : new TextEncoder().encode(s).length));
      return run(encoded.pointer, lens);
    } finally {
      release(encoded);
    }
  }

  private find(kind: number, name: string, atrule = ""): number {
    const key = atrule === "" ? name : `${atrule}\n${name}`;
    let id = this.cache[kind]!.get(key);
    if (id === undefined) {
      id = this.call([name, atrule], (pointer, [nameLen, atruleLen]) =>
        exports().find(this.id, kind, pointer, nameLen!, atruleLen!),
      ) >>> 0;
      this.cache[kind]!.set(key, id);
    }
    return id;
  }

  private descriptor(id: number, type: Descriptor["type"], name: string, parent: string | null = null): Descriptor {
    let descriptor = this.descriptors.get(id);
    if (descriptor === undefined) {
      const root = exports().descriptorRoot(this.id, id) >>> 0;
      let syntax: SyntaxNode | null | undefined;
      descriptor = {
        type,
        name,
        parent,
        serializable: root !== NONE,
        get syntax() {
          return (syntax ??= root === NONE ? null : syntaxAt(root));
        },
      };
      this.descriptors.set(id, descriptor);
      this.ids.set(descriptor, id);
    }
    return descriptor;
  }

  private matchSyntax(id: number, descriptor: Descriptor | null, value: unknown, useCssWideKeywords: boolean): MatchResult {
    const e = exports();
    if (typeof value !== "string" && value !== null && typeof value === "object" && typeof (value as Node).type === "string") {
      return this.matchTree(id, descriptor, value as Node, useCssWideKeywords);
    }
    const source = typeof value === "string" ? value : String(value ?? "");
    const capacity = source.length * 3;
    const pointer = e.inputBuffer(capacity);
    if (pointer === 0 && capacity > 0) throw new Error("yuku-css: out of memory");
    const len = encoder.encodeInto(source, new Uint8Array(e.memory.buffer, pointer, capacity)).written;
    const at = e.match(this.id, id, useCssWideKeywords ? 1 : 0, len);
    if (at === 0) throw new Error("yuku-css: out of memory");
    return this.readMatch(new Uint32Array(e.memory.buffer, at), source, len === source.length, descriptor, null, null);
  }

  // a tree is matched as the tokens it prints, each naming the node that printed it, as css-tree does
  private matchTree(id: number, descriptor: Descriptor | null, value: Node, useCssWideKeywords: boolean): MatchResult {
    const e = exports();
    const printed = printTokens(value);
    const source = printed.values.join("");
    const count = printed.values.length;
    const capacity = source.length * 3;
    const pointer = e.inputBuffer(capacity);
    if (pointer === 0 && capacity > 0) throw new Error("yuku-css: out of memory");
    const len = encoder.encodeInto(source, new Uint8Array(e.memory.buffer, pointer, capacity)).written;
    const tokens = e.tokenBuffer(count);
    if (tokens === 0 && count > 0) throw new Error("yuku-css: out of memory");
    const words = new Uint32Array(e.memory.buffer, tokens, count * 2);
    const ascii = len === source.length;
    for (let i = 0, end = 0; i < count; i++) {
      const text = printed.values[i]!;
      end += ascii ? text.length : utf8Length(text);
      words[i * 2] = end;
      words[i * 2 + 1] = printed.types[i]!;
    }
    const at = e.matchTokens(this.id, id, useCssWideKeywords ? 1 : 0, len, count);
    if (at === 0) throw new Error("yuku-css: out of memory");
    return this.readMatch(new Uint32Array(e.memory.buffer, at), source, ascii, descriptor, printed, value);
  }

  private readMatch(
    words: Uint32Array,
    source: string,
    ascii: boolean,
    descriptor: Descriptor | null,
    printed: Printed | null,
    value: unknown,
  ): MatchResult {
    const status = words[0]!;
    const iterations = words[1]!;
    if (status === 4) {
      return new Result(null, () => plainError("Matching for a tree with var() is not supported"));
    }
    if (status === 3) {
      const node = syntaxAt(words[6]!) as { type: string; name: string };
      throw new Error("Bad syntax reference: " + (node.type === "Type" ? "<" + node.name + ">" : "<'" + node.name + "'>"));
    }
    const at = ascii ? (offset: number) => offset : (offset: number) => utf16OffsetOf(source, offset);
    if (status !== 0) {
      const longest = words[3]!;
      if (printed !== null) {
        const error = () => treeMatchError(STATUS[status]!, this.generated(descriptor), printed, longest, value);
        return new Result(null, error, iterations);
      }
      const atEnd = longest >= words[2]!;
      const first = words[8]!;
      const start = words[4]!;
      const end = words[5]!;
      const error = () => {
        const css = source.slice(at(first));
        const offset = atEnd ? 0 : at(start) - at(first);
        const length = atEnd ? 0 : at(end) - at(start);
        return syntaxMatchError(STATUS[status]!, this.generated(descriptor), css, offset, length, atEnd);
      };
      return new Result(null, error, iterations);
    }
    const wide = words[7] !== 0;
    const entries = words.slice(HEADER, HEADER + 4 * words[9]!);
    return new Result(() => this.tree(entries, source, at, wide ? null : descriptor, printed), null, iterations);
  }

  private tree(
    entries: Uint32Array,
    source: string,
    at: (offset: number) => number,
    descriptor: Descriptor | null,
    printed: Printed | null,
  ): MatchNode {
    const root: MatchNode = { syntax: descriptor === null ? null : this.reference(descriptor), match: [] };
    const stack: { match: MatchNode[] }[] = [root];
    let host = root as { match: MatchNode[] };
    for (let base = 0; base < entries.length; base += 4) {
      const kind = entries[base]! & 0xff;
      const syntax = entries[base + 1]!;
      if (kind === ENTRY_TOKEN) {
        const index = entries[base]! >>> 8;
        host.match.push({
          syntax: syntax === NONE ? null : syntaxAt(syntax),
          token: printed === null ? source.slice(at(entries[base + 2]!), at(entries[base + 3]!)) : printed.values[index]!,
          node: printed === null ? null : printed.nodes[index],
        });
      } else if (kind === ENTRY_OPEN) {
        const next = { syntax: syntaxAt(syntax), match: [] as MatchNode[] };
        host.match.push(next);
        stack.push(next);
        host = next;
      } else {
        stack.pop();
        host = stack[stack.length - 1]!;
      }
    }
    return root;
  }

  private readonly generatedSyntax = new Map<Descriptor, string>();

  // a descriptor's syntax as an error shows it, written once
  private generated(descriptor: Descriptor | null): string {
    if (descriptor === null || descriptor.syntax === null) return "<generic>";
    let text = this.generatedSyntax.get(descriptor);
    if (text === undefined) {
      text = generate(descriptor.syntax);
      this.generatedSyntax.set(descriptor, text);
    }
    return text;
  }

  private references = new Map<Descriptor, { type: string; name: string }>();

  /** @internal */
  referenceOf(descriptor: Descriptor): { type: string; name: string } {
    return this.reference(descriptor);
  }

  /** @internal */
  generatedOf(descriptor: Descriptor | null): string {
    return this.generated(descriptor);
  }

  /**
   * Parses `source` as a style sheet and matches every declaration's value against its
   * property, in one call into the WebAssembly, over the tokens the parse read. Each result's
   * tree and error are built when first read; an error's position is in `source`.
   */
  matchStylesheet(source: string): DeclarationMatch[] {
    const e = exports();
    const capacity = source.length * 3;
    const pointer = e.inputBuffer(capacity);
    if (pointer === 0 && capacity > 0) throw new Error("yuku-css: out of memory");
    const len = encoder.encodeInto(source, new Uint8Array(e.memory.buffer, pointer, capacity)).written;
    const at = e.validate(this.id, len);
    if (at === 0) throw new Error("yuku-css: out of memory");
    const header = new Uint32Array(e.memory.buffer, at, 3);
    const count = header[0]!;
    const size = header[1]!;
    const words = new Uint32Array(e.memory.buffer, at, header[2]!).slice();
    const sheet = new Sheet(this, source, words);
    const result: DeclarationMatch[] = new Array(count);
    for (let i = 0; i < count; i++) result[i] = new Declaration(sheet, 3 + i * size);
    return result;
  }

  // css-tree's `ref`, the root syntax of a descriptor's match tree
  private reference(descriptor: Descriptor): { type: string; name: string } {
    let ref = this.references.get(descriptor);
    if (ref === undefined) {
      ref = { type: descriptor.type, name: descriptor.name };
      this.references.set(descriptor, ref);
    }
    return ref;
  }

  checkAtruleName(atruleName: string): SyntaxReferenceError | undefined {
    if (!this.getAtrule(atruleName)) return syntaxReferenceError("Unknown at-rule", "@" + atruleName);
    return undefined;
  }

  checkAtrulePrelude(atruleName: string, prelude?: unknown): Error | undefined {
    const error = this.checkAtruleName(atruleName);
    if (error) return error;
    const atrule = this.getAtrule(atruleName)!;
    if (!atrule.prelude && prelude) return new SyntaxError("At-rule `@" + atruleName + "` should not contain a prelude");
    if (atrule.prelude && !prelude) {
      if (!this.matchDescriptor(atrule.prelude, "", false).matched) {
        return new SyntaxError("At-rule `@" + atruleName + "` should contain a prelude");
      }
    }
    return undefined;
  }

  checkAtruleDescriptorName(atruleName: string, descriptorName: string): Error | undefined {
    const error = this.checkAtruleName(atruleName);
    if (error) return error;
    const atrule = this.getAtrule(atruleName)!;
    const descriptor = keyword(descriptorName);
    if (!atrule.descriptors) return new SyntaxError("At-rule `@" + atruleName + "` has no known descriptors");
    if (!atrule.descriptors[descriptor.name] && !atrule.descriptors[descriptor.basename]) {
      return syntaxReferenceError("Unknown at-rule descriptor", descriptorName);
    }
    return undefined;
  }

  checkPropertyName(propertyName: string): SyntaxReferenceError | undefined {
    if (!this.getProperty(propertyName)) return syntaxReferenceError("Unknown property", propertyName);
    return undefined;
  }

  private idOf(descriptor: Descriptor): number {
    const id = this.ids.get(descriptor);
    if (id === undefined) throw new Error("yuku-css: a descriptor of another lexer");
    return id;
  }

  private matchDescriptor(descriptor: Descriptor, value: unknown, useCssWideKeywords: boolean): MatchResult {
    return this.matchSyntax(this.idOf(descriptor), descriptor, value, useCssWideKeywords);
  }

  matchAtrulePrelude(atruleName: string, prelude?: unknown): MatchResult {
    const error = this.checkAtrulePrelude(atruleName, prelude);
    if (error) return buildMatchResult(null, error);
    const atrule = this.getAtrule(atruleName)!;
    if (!atrule.prelude) return buildMatchResult(null, null);
    return this.matchDescriptor(atrule.prelude, prelude || "", false);
  }

  matchAtruleDescriptor(atruleName: string, descriptorName: string, value: unknown): MatchResult {
    const error = this.checkAtruleDescriptorName(atruleName, descriptorName);
    if (error) return buildMatchResult(null, error);
    const atrule = this.getAtrule(atruleName)!;
    const descriptor = keyword(descriptorName);
    return this.matchDescriptor(atrule.descriptors![descriptor.name] || atrule.descriptors![descriptor.basename]!, value, false);
  }

  matchDeclaration(node: { type: string; property: string; value: unknown }): MatchResult {
    if (node.type !== "Declaration") return buildMatchResult(null, plainError("Not a Declaration node"));
    return this.matchProperty(node.property, node.value);
  }

  // what `matchProperty` resolves a name to: its descriptor and id, or why it matches nothing
  private readonly propertyTargets = new Map<string, [Descriptor, number] | (() => Error)>();

  matchProperty(propertyName: string, value: unknown): MatchResult {
    let target = this.propertyTargets.get(propertyName);
    if (target === undefined) {
      if (property(propertyName).custom) {
        target = () => plainError("Lexer matching doesn't applicable for custom properties");
      } else {
        const descriptor = this.getProperty(propertyName);
        target = descriptor ? [descriptor, this.idOf(descriptor)] : () => syntaxReferenceError("Unknown property", propertyName);
      }
      this.propertyTargets.set(propertyName, target);
    }
    if (typeof target === "function") return new Result(null, target);
    return this.matchSyntax(target[1], target[0], value, true);
  }

  matchType(typeName: string, value: unknown): MatchResult {
    const type = this.getType(typeName);
    if (!type) return buildMatchResult(null, syntaxReferenceError("Unknown type", typeName));
    return this.matchDescriptor(type, value, false);
  }

  match(syntax: SyntaxSource, value: unknown): MatchResult {
    if (typeof syntax !== "string" && (!syntax || !syntax.type)) {
      return buildMatchResult(null, syntaxReferenceError("Bad syntax"));
    }
    if (this.ids.has(syntax as Descriptor)) return this.matchDescriptor(syntax as Descriptor, value, false);
    const source = typeof syntax === "string" ? syntax : generate(syntax);
    let id = this.anonymous.get(source);
    if (id === undefined) {
      id = this.define(KIND.anonymous, "", "", source);
      this.anonymous.set(source, id);
    }
    return this.matchSyntax(id, this.descriptor(id, "Type", "anonymous"), value, false);
  }

  /** @internal */
  define(kind: number, name: string, atrule: string, source: string): number {
    const id = this.call([name, atrule, source], (pointer, [nameLen, atruleLen, syntaxLen]) =>
      exports().define(this.id, kind, pointer, nameLen!, atruleLen!, syntaxLen!),
    ) >>> 0;
    if (id === NONE) {
      const e = exports();
      let message = MESSAGES[e.failureWord(0)]!;
      if (message.includes("{c}")) message = message.replace("{c}", String.fromCharCode(e.failureWord(1)));
      const offset = e.failureWord(3) === 0 ? e.failureWord(2) : e.failureWord(2) - e.failureWord(3);
      throw definitionSyntaxError(message, source, offset);
    }
    return id;
  }

  /** Each run of nodes in `value` a definition named `name`, of `type`, matched in the property. */
  findValueFragments(propertyName: string, value: unknown, type: string, name: string): Fragment[] {
    return matchFragments(value, this.matchProperty(propertyName, value), type, name);
  }

  findDeclarationValueFragments(declaration: { type: string; property: string; value: unknown }, type: string, name: string): Fragment[] {
    return matchFragments(declaration.value, this.matchDeclaration(declaration), type, name);
  }

  /** `findDeclarationValueFragments` over every declaration in `ast`. */
  findAllFragments(ast: unknown, type: string, name: string): Fragment[] {
    const result: Fragment[] = [];
    walkTree(ast as Node, {
      visit: "Declaration",
      enter: (declaration) => {
        result.push(...this.findDeclarationValueFragments(declaration as never, type, name));
      },
    });
    return result;
  }

  /** Every node of `ast` that breaks css-tree's node structure, or false when none does. */
  checkStructure(ast: unknown): StructureWarning[] | false {
    const warns: StructureWarning[] = [];
    const warn = (node: unknown, message: string) => {
      warns.push({ node, message });
    };
    walkTree(ast as Node, (node) => checkNode(node, warn));
    return warns.length ? warns : false;
  }

  getAtrule(atruleName: string, fallbackBasename = true): AtruleDescriptor | null {
    const atrule = keyword(atruleName);
    return (
      (atrule.vendor && fallbackBasename
        ? this.atrule(atrule.name) || this.atrule(atrule.basename)
        : this.atrule(atrule.name)) || null
    );
  }

  private readonly atruleCache = new Map<string, AtruleDescriptor | null>();

  private atrule(name: string): AtruleDescriptor | null {
    if (this.atruleCache.has(name)) return this.atruleCache.get(name)!;
    const prelude = this.find(KIND.prelude, name);
    let result: AtruleDescriptor | null = null;
    if (prelude !== NONE) {
      const lexer = this;
      const probe = this.find(KIND.descriptor, "", name);
      let descriptors: Record<string, Descriptor> | null | undefined;
      result = {
        type: "Atrule",
        name,
        prelude: prelude === NO_PRELUDE ? null : this.descriptor(prelude, "AtrulePrelude", name),
        get descriptors() {
          if (descriptors === undefined) descriptors = probe === NO_DESCRIPTORS ? null : lexer.descriptorsOf(name);
          return descriptors;
        },
      };
    }
    this.atruleCache.set(name, result);
    return result;
  }

  private descriptorsOf(atrule: string): Record<string, Descriptor> {
    const result: Record<string, Descriptor> = Object.create(null);
    for (const entry of this.list()) {
      if (entry.kind === KIND.descriptor && entry.atrule === atrule) {
        result[entry.name] = this.descriptor(entry.id, "AtruleDescriptor", entry.name, atrule);
      }
    }
    return result;
  }

  getAtrulePrelude(atruleName: string, fallbackBasename = true): Descriptor | null {
    const atrule = this.getAtrule(atruleName, fallbackBasename);
    return (atrule && atrule.prelude) || null;
  }

  // css-tree reads `this.atrules.declarators`, which never exists, so this is always null
  getAtruleDescriptor(_atruleName: string, _name: string): null {
    return null;
  }

  getProperty(propertyName: string, fallbackBasename = true): Descriptor | null {
    const descriptor = property(propertyName);
    const at = (name: string) => {
      const id = this.find(KIND.property, name);
      return id === NONE ? null : this.descriptor(id, "Property", name);
    };
    return (descriptor.vendor && fallbackBasename ? at(descriptor.name) || at(descriptor.basename) : at(descriptor.name)) || null;
  }

  getType(name: string): Descriptor | null {
    const id = this.find(KIND.type, name);
    return id === NONE ? null : this.descriptor(id, "Type", name);
  }

  private listing?: { kind: number; id: number; name: string; atrule: string }[];

  private list() {
    if (this.listing === undefined) {
      const e = exports();
      this.listing = take(e.names(this.id), (words, bytes) => {
        const count = words[0]!;
        const entries: { kind: number; id: number; name: string; atrule: string }[] = [];
        let offset = 4 + count * 16;
        for (let i = 0; i < count; i++) {
          const [kind, id, nameLen, atruleLen] = words.subarray(1 + i * 4, 5 + i * 4);
          const name = text(bytes, offset, nameLen!);
          const atrule = text(bytes, offset + nameLen!, atruleLen!);
          offset += nameLen! + atruleLen!;
          entries.push({ kind: kind!, id: id! >>> 0, name, atrule });
        }
        return entries;
      });
    }
    return this.listing;
  }

  private dictionary() {
    if (this.dictionaries === undefined) {
      const types: Record<string, Descriptor> = Object.create(null);
      const properties: Record<string, Descriptor> = Object.create(null);
      const atrules: Record<string, AtruleDescriptor> = Object.create(null);
      for (const entry of this.list()) {
        if (entry.kind === KIND.type) types[entry.name] = this.descriptor(entry.id, "Type", entry.name);
        else if (entry.kind === KIND.property) properties[entry.name] = this.descriptor(entry.id, "Property", entry.name);
        else if (entry.kind === KIND.prelude) atrules[entry.name] = this.atrule(entry.name)!;
      }
      this.dictionaries = { types, properties, atrules };
    }
    return this.dictionaries;
  }

  /** Every type, by name. */
  get types(): Record<string, Descriptor> {
    return this.dictionary().types;
  }

  /** Every property, by name. */
  get properties(): Record<string, Descriptor> {
    return this.dictionary().properties;
  }

  /** Every at-rule, by name. */
  get atrules(): Record<string, AtruleDescriptor> {
    return this.dictionary().atrules;
  }

  /** The references to definitions that do not exist, as css-tree's `validate` lists them. */
  validate(): { errors: string[]; types: string[]; properties: string[] } | null {
    const ref = (name: string, isType: boolean) => (isType ? `<${name}>` : `<'${name}'>`);
    const errors: string[] = [];
    const brokenTypes = new Map<string, boolean>();
    const brokenProperties = new Map<string, boolean>();
    const { types, properties } = this.dictionary();
    const check = (name: string, broken: Map<string, boolean>, descriptor: Descriptor): boolean => {
      if (broken.has(name)) return broken.get(name)!;
      broken.set(name, false);
      if (descriptor.syntax !== null) {
        walk(descriptor.syntax, (node) => {
          if (node.type !== "Type" && node.type !== "Property") return;
          const map = node.type === "Type" ? types : properties;
          const brokenMap = node.type === "Type" ? brokenTypes : brokenProperties;
          if (!Object.hasOwn(map, node.name)) {
            errors.push(`${ref(name, broken === brokenTypes)} used missed syntax definition ${ref(node.name, node.type === "Type")}`);
            broken.set(name, true);
          } else if (check(node.name, brokenMap, map[node.name]!)) {
            errors.push(`${ref(name, broken === brokenTypes)} used broken syntax definition ${ref(node.name, node.type === "Type")}`);
            broken.set(name, true);
          }
        });
      }
      return broken.get(name)!;
    };
    for (const key in types) check(key, brokenTypes, types[key]!);
    for (const key in properties) check(key, brokenProperties, properties[key]!);
    const brokenTypesArray = [...brokenTypes.keys()].filter((name) => brokenTypes.get(name));
    const brokenPropertiesArray = [...brokenProperties.keys()].filter((name) => brokenProperties.get(name));
    if (brokenTypesArray.length || brokenPropertiesArray.length) {
      return { errors, types: brokenTypesArray, properties: brokenPropertiesArray };
    }
    return null;
  }

  /** The lexer's grammar as text, or as trees with `syntaxAsAst`, which `createLexer` takes back. */
  dump(syntaxAsAst?: boolean, pretty?: boolean): Required<LexerConfig> & { units: Units } {
    const compact = !pretty;
    const out = (descriptor: Descriptor) =>
      syntaxAsAst ? descriptor.syntax! : generate(descriptor.syntax!, { compact });
    const map = (dict: Record<string, Descriptor>) => {
      const result: Record<string, SyntaxSource> = {};
      for (const name in dict) if (dict[name]!.syntax) result[name] = out(dict[name]!);
      return result;
    };
    const atrules: Record<string, { prelude: SyntaxSource | null; descriptors: Record<string, SyntaxSource> | null }> = {};
    for (const [name, atrule] of Object.entries(this.atrules)) {
      atrules[name] = {
        prelude: atrule.prelude && out(atrule.prelude),
        descriptors: atrule.descriptors && map(atrule.descriptors),
      };
    }
    return {
      generic: this.generic,
      cssWideKeywords: this.cssWideKeywords,
      units: this.units,
      types: map(this.types),
      properties: map(this.properties),
      atrules: atrules,
    };
  }

  toString(): string {
    return JSON.stringify(this.dump());
  }
}

function create(builtin: boolean, config: LexerConfig): Lexer {
  const e = exports();
  const generic = Boolean(config.generic);
  const id = e.createLexer(builtin ? 1 : 0, generic ? 1 : 0) >>> 0;
  if (id === NONE) throw new Error("yuku-css: out of memory");
  const units: Units = { ...DEFAULT_UNITS };
  if (config.units) {
    for (const group of unitGroups) {
      const list = config.units[group];
      if (!Array.isArray(list)) continue;
      units[group] = list;
      const encoded = encode(list.join("\n"));
      e.setUnits(id, unitGroups.indexOf(group), encoded.pointer, encoded.len);
      release(encoded);
    }
  }
  const cssWideKeywords = config.cssWideKeywords ?? CSS_WIDE_KEYWORDS;
  if (config.cssWideKeywords) {
    const encoded = encode(cssWideKeywords.join(" |  "));
    e.setCssWide(id, encoded.pointer, encoded.len);
    release(encoded);
  }
  const lexer = new Lexer(id, generic, cssWideKeywords, units);
  const textOf = (syntax: SyntaxSource) => {
    if (typeof syntax === "string") return syntax;
    if (typeof syntax === "function") throw new TypeError("yuku-css: a lexer takes definition syntax, not functions");
    return generate(syntax);
  };
  for (const [name, syntax] of Object.entries(config.types ?? {})) {
    if (syntax) lexer.define(KIND.type, name, "", textOf(syntax));
  }
  for (const [name, atrule] of Object.entries(config.atrules ?? {})) {
    if (!atrule) continue;
    if (atrule.prelude) lexer.define(KIND.prelude, name, "", textOf(atrule.prelude));
    else {
      const encoded = encode(name);
      e.declareAtrule(id, encoded.pointer, encoded.len);
      release(encoded);
    }
    for (const [descriptor, syntax] of Object.entries(atrule.descriptors ?? {})) {
      if (syntax) lexer.define(KIND.descriptor, descriptor, name, textOf(syntax));
    }
  }
  for (const [name, syntax] of Object.entries(config.properties ?? {})) {
    if (syntax) lexer.define(KIND.property, name, "", textOf(syntax));
  }
  return lexer;
}

let defaultLexer: Lexer | undefined;

/** The lexer over the CSS grammar: `@webref/css`, patched, with css-tree's generic types. */
export function lexerOf(): Lexer {
  return (defaultLexer ??= create(true, { generic: true }));
}

/** A lexer of only the given grammar, as css-tree's `createLexer`. */
export function createLexer(config: LexerConfig): Lexer {
  return create(false, config);
}

/**
 * A lexer over the CSS grammar extended by `extension`, as css-tree's `fork` makes one: a syntax
 * starting with `|` adds alternatives to the definition it names, and CSS-wide keywords add to
 * the default ones.
 */
export function fork(extension: LexerConfig | ((base: LexerConfig) => LexerConfig)): { lexer: Lexer } {
  const base = lexerOf();
  const config: LexerConfig =
    typeof extension === "function"
      ? extension({ generic: true, cssWideKeywords: CSS_WIDE_KEYWORDS, units: DEFAULT_UNITS })
      : extension;
  const known = (descriptor: Descriptor | null | undefined) =>
    descriptor?.syntax ? generate(descriptor.syntax) : undefined;
  // css-tree's `appendOrSet`
  const append = (current: string | undefined, syntax: SyntaxSource | null | undefined) => {
    if (typeof syntax !== "string" || !/^\s*\|/.test(syntax)) return syntax || null;
    return current !== undefined ? current + " " + syntax.trim() : syntax.replace(/^\s*\|\s*/, "");
  };
  const types: Record<string, SyntaxSource | null> = {};
  for (const [name, syntax] of Object.entries(config.types ?? {})) types[name] = append(known(base.getType(name)), syntax);
  const properties: Record<string, SyntaxSource | null> = {};
  for (const [name, syntax] of Object.entries(config.properties ?? {})) {
    properties[name] = append(known(base.getProperty(name, false)), syntax);
  }
  const atrules: NonNullable<LexerConfig["atrules"]> = {};
  for (const [name, atrule] of Object.entries(config.atrules ?? {})) {
    const current = base.getAtrule(name, false);
    const descriptors: Record<string, SyntaxSource | null> = {};
    for (const [descriptor, syntax] of Object.entries(current?.descriptors ?? {})) descriptors[descriptor] = known(syntax) ?? null;
    let prelude: SyntaxSource | null = known(current?.prelude) ?? null;
    if (atrule) {
      if (atrule.prelude) prelude = append(prelude ?? undefined, atrule.prelude);
      for (const [descriptor, syntax] of Object.entries(atrule.descriptors ?? {})) {
        if (syntax) descriptors[descriptor] = append(descriptors[descriptor] as string | undefined, syntax);
      }
    }
    atrules[name] = { prelude, descriptors };
  }
  const cssWideKeywords =
    config.cssWideKeywords && typeof extension !== "function"
      ? [...CSS_WIDE_KEYWORDS, ...config.cssWideKeywords]
      : config.cssWideKeywords;
  const units: Record<string, string[]> = {};
  for (const [group, list] of Object.entries(config.units ?? {})) units[group] = Array.isArray(list) ? list : [];
  return {
    lexer: create(true, {
      ...config,
      generic: config.generic ?? true,
      cssWideKeywords,
      units,
      types,
      properties,
      atrules,
    }),
  };
}

export { parse as parseSyntax };
