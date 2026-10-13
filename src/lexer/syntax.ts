// css-tree's `definitionSyntax`: `parse` reads in Zig, `generate` and `walk` take any tree
import { MESSAGES, TAGS } from "./tables";
import { encode, release, take, text, utf16Offset, wasm } from "./wasm";

export interface SyntaxGroup {
  type: "Group";
  terms: SyntaxNode[];
  combinator: "|" | "||" | "&&" | " ";
  disallowEmpty: boolean;
  explicit: boolean;
}
export interface SyntaxMultiplier {
  type: "Multiplier";
  comma: boolean;
  min: number;
  /** 0 when unbounded. */
  max: number;
  term: SyntaxNode;
}
export interface SyntaxBoolean {
  type: "Boolean";
  term: SyntaxNode;
}
export interface SyntaxRange {
  type: "Range";
  /** null for -∞; a string when the bound has a unit. */
  min: number | string | null;
  /** null for ∞; a string when the bound has a unit. */
  max: number | string | null;
}
export interface SyntaxType {
  type: "Type";
  name: string;
  opts: SyntaxRange | null;
}
export interface SyntaxNamed<T extends "Property" | "Keyword" | "AtKeyword" | "Function"> {
  type: T;
  name: string;
}
export interface SyntaxValue<T extends "Token" | "String"> {
  type: T;
  value: string;
}
export interface SyntaxComma {
  type: "Comma";
}
/** A node of css-tree's definition syntax tree. */
export type SyntaxNode =
  | SyntaxGroup
  | SyntaxMultiplier
  | SyntaxBoolean
  | SyntaxType
  | SyntaxNamed<"Property" | "Keyword" | "AtKeyword" | "Function">
  | SyntaxValue<"Token" | "String">
  | SyntaxComma;

/** css-tree's definition syntax `SyntaxError`. */
export interface DefinitionSyntaxError extends SyntaxError {
  input: string;
  offset: number;
  rawMessage: string;
}

const COMBINATORS = [" ", "&&", "||", "|"] as const;

// css-tree's custom errors: a SyntaxError prototype, named, with the stack starting at the message
export function customError(name: string, message: string): SyntaxError {
  const error = Object.create(SyntaxError.prototype) as SyntaxError;
  const stack = new Error();
  return Object.assign(error, {
    name,
    message,
    get stack() {
      return (stack.stack || "").replace(/^(.+\n){1,3}/, `${name}: ${message}\n`);
    },
  });
}

export function definitionSyntaxError(message: string, input: string, offset: number): DefinitionSyntaxError {
  return Object.assign(customError("SyntaxError", message), {
    input,
    offset,
    rawMessage: message,
    message: message + "\n  " + input + "\n--" + new Array((offset || input.length) + 1).join("-") + "^",
  });
}

/** Reads the tree at node `index` of `words`, two words a node, naming spans through `textOf`. */
export class SyntaxReader {
  private readonly words: Uint32Array;
  private readonly textOf: (start: number, len: number) => string;
  private readonly memo: (SyntaxNode | SyntaxRange | undefined)[] | undefined;
  private readonly base: number;
  private readonly compact: boolean;

  /**
   * `compact` reads a node from one word, the compiled grammar's packing of tag, flags, len and
   * data in 4, 4, 8 and 16 bits.
   */
  constructor(
    words: Uint32Array,
    textOf: (start: number, len: number) => string,
    memo?: (SyntaxNode | SyntaxRange | undefined)[],
    base = 0,
    compact = false,
  ) {
    this.words = words;
    this.textOf = textOf;
    this.memo = memo;
    this.base = base;
    this.compact = compact;
  }

  // tag | flags << 8 | len << 16, as an 8-byte node's first word
  private head(index: number): number {
    if (!this.compact) return this.words[index * 2]!;
    const word = this.words[index]!;
    return (word & 0xf) | ((word >>> 4) & 0xf) << 8 | ((word >>> 8) & 0xff) << 16;
  }

  private data(index: number): number {
    return this.compact ? this.words[index]! >>> 16 : this.words[index * 2 + 1]!;
  }

  /** The node at `index` and the index past its subtree. */
  read(index: number): [SyntaxNode, number] {
    const memo = this.memo?.[index + this.base];
    if (memo !== undefined) return [memo as SyntaxNode, this.skip(index)];
    const head = this.head(index);
    const data = this.data(index);
    const tag = TAGS[head & 0xff]!;
    const flags = (head >>> 8) & 0xff;
    const len = head >>> 16;
    let node: SyntaxNode;
    let next = index + 1;
    switch (tag) {
      case "group": {
        const terms: SyntaxNode[] = [];
        for (let i = 0; i < len; i++) {
          const [term, after] = this.read(next);
          terms.push(term);
          next = after;
        }
        node = {
          type: "Group",
          terms,
          combinator: COMBINATORS[flags & 3]!,
          disallowEmpty: (flags & 8) !== 0,
          explicit: (flags & 4) !== 0,
        };
        break;
      }
      case "multiplier": {
        const [term, after] = this.read(next);
        node = { type: "Multiplier", comma: (flags & 1) !== 0, min: len, max: data, term };
        next = after;
        break;
      }
      case "boolean": {
        const [term, after] = this.read(next);
        node = { type: "Boolean", term };
        next = after;
        break;
      }
      case "type": {
        const opts = (flags & 1) !== 0 ? this.range(next) : null;
        if (opts !== null) next += 2;
        node = { type: "Type", name: this.textOf(data, len), opts };
        break;
      }
      case "property":
        node = { type: "Property", name: this.textOf(data, len) };
        break;
      case "keyword":
        node = { type: "Keyword", name: this.textOf(data, len) };
        break;
      case "at_keyword":
        node = { type: "AtKeyword", name: this.textOf(data, len) };
        break;
      case "function":
        node = { type: "Function", name: this.textOf(data, len) };
        break;
      case "token":
        node = { type: "Token", value: this.textOf(data, len) };
        break;
      case "string":
        node = { type: "String", value: this.textOf(data, len) };
        break;
      case "comma":
        node = { type: "Comma" };
        break;
      default:
        throw new Error(`yuku-css: unknown syntax node ${tag}`);
    }
    if (this.memo) this.memo[index + this.base] = node;
    return [node, next];
  }

  /** The range node at `index`, as `Type.opts`. */
  range(index: number): SyntaxRange {
    const memo = this.memo?.[index + this.base];
    if (memo !== undefined) return memo as SyntaxRange;
    const opts: SyntaxRange = { type: "Range", min: this.bound(index), max: this.bound(index + 1) };
    if (this.memo) this.memo[index + this.base] = opts;
    return opts;
  }

  private skip(index: number): number {
    let at = index;
    while (true) {
      const head = this.head(at);
      const tag = TAGS[head & 0xff];
      if (tag === "multiplier" || tag === "boolean") at++;
      else if (tag === "group") return at + this.data(at);
      else if (tag === "type") return at + ((head >>> 8) & 1 ? 3 : 1);
      else return at + 1;
    }
  }

  // css-tree reads a bound as `sign * Number(digits)`, with a unit appended as a string
  private bound(index: number): number | string | null {
    const len = this.head(index) >>> 16;
    if (len === 0) return null;
    const source = this.textOf(this.data(index), len);
    const match = /^(-?)(\d+)(.*)$/.exec(source)!;
    const value = (match[1] ? -1 : 1) * Number(match[2]);
    return match[3] ? value + match[3] : value;
  }
}

/** Parses CSS Value Definition Syntax into css-tree's tree; throws css-tree's `SyntaxError`. */
export function parse(source: string): SyntaxGroup {
  const exports = wasm();
  const encoded = encode(source);
  try {
    return take(exports.parseSyntax(encoded.pointer, encoded.len), (words) => {
      if (words[0] !== 0) {
        const at = (offset: number) => utf16Offset(source, encoded, offset);
        let message = MESSAGES[words[1]!]!;
        if (message.includes("{c}")) message = message.replace("{c}", String.fromCharCode(words[2]!));
        const offset = words[4] === 0 ? at(words[3]!) : at(words[3]!) - at(words[4]!);
        throw definitionSyntaxError(message, source, offset);
      }
      const nodes = words.subarray(2, 2 + words[1]! * 2);
      const bytes = new Uint8Array(exports.memory.buffer, encoded.pointer, encoded.len);
      const textOf = encoded.ascii
        ? (start: number, len: number) => source.slice(start, start + len)
        : (start: number, len: number) => text(bytes, start, len);
      return new SyntaxReader(nodes, textOf).read(0)[0] as SyntaxGroup;
    });
  } finally {
    release(encoded);
  }
}

type Decorate = (text: string, node: SyntaxNode | SyntaxRange) => string;

export interface GenerateOptions {
  forceBraces?: boolean;
  compact?: boolean;
  decorate?: Decorate;
}

const noop: Decorate = (value) => value;

function generateMultiplier({ min, max, comma }: SyntaxMultiplier): string {
  if (min === 0 && max === 0) return comma ? "#?" : "*";
  if (min === 0 && max === 1) return "?";
  if (min === 1 && max === 0) return comma ? "#" : "+";
  if (min === 1 && max === 1) return "";
  return (comma ? "#" : "") + (min === max ? "{" + min + "}" : "{" + min + "," + (max !== 0 ? max : "") + "}");
}

function generateTypeOpts(node: SyntaxRange): string {
  if (node.type !== "Range") throw new Error("Unknown node type `" + (node as { type: string }).type + "`");
  return " [" + (node.min === null ? "-∞" : node.min) + "," + (node.max === null ? "∞" : node.max) + "]";
}

function generateNode(node: SyntaxNode, decorate: Decorate, forceBraces: boolean, compact: boolean): string {
  let result: string;
  switch (node.type) {
    case "Group": {
      const combinator = node.combinator === " " || compact ? node.combinator : " " + node.combinator + " ";
      const joined = node.terms.map((term) => generateNode(term, decorate, forceBraces, compact)).join(combinator);
      result =
        node.explicit || forceBraces
          ? (compact || joined[0] === "," ? "[" : "[ ") + joined + (compact ? "]" : " ]")
          : joined;
      if (node.disallowEmpty) result += "!";
      break;
    }
    case "Multiplier":
      return generateNode(node.term, decorate, forceBraces, compact) + decorate(generateMultiplier(node), node);
    case "Boolean":
      result = "<boolean-expr[" + generateNode(node.term, decorate, forceBraces, compact) + "]>";
      break;
    case "Type":
      result = "<" + node.name + (node.opts ? decorate(generateTypeOpts(node.opts), node.opts) : "") + ">";
      break;
    case "Property":
      result = "<'" + node.name + "'>";
      break;
    case "Keyword":
      result = node.name;
      break;
    case "AtKeyword":
      result = "@" + node.name;
      break;
    case "Function":
      result = node.name + "(";
      break;
    case "String":
    case "Token":
      result = node.value;
      break;
    case "Comma":
      result = ",";
      break;
    default:
      throw new Error("Unknown node type `" + (node as { type: string }).type + "`");
  }
  return decorate(result, node);
}

/** Writes a definition syntax tree back as text, as css-tree does. */
export function generate(node: SyntaxNode, options?: GenerateOptions | Decorate): string {
  let decorate = noop;
  let forceBraces = false;
  let compact = false;
  if (typeof options === "function") decorate = options;
  else if (options) {
    forceBraces = Boolean(options.forceBraces);
    compact = Boolean(options.compact);
    if (typeof options.decorate === "function") decorate = options.decorate;
  }
  return generateNode(node, decorate, forceBraces, compact);
}

export type SyntaxWalker<C = unknown> = (this: C, node: SyntaxNode) => void;

/** Visits every node of a definition syntax tree, parents first, as css-tree does. */
export function walk<C = unknown>(
  node: SyntaxNode,
  options: SyntaxWalker<C> | { enter?: SyntaxWalker<C>; leave?: SyntaxWalker<C> },
  context?: C,
): void {
  const none = () => {};
  let enter: SyntaxWalker<C> = none;
  let leave: SyntaxWalker<C> = none;
  if (typeof options === "function") enter = options;
  else if (options) {
    if (typeof options.enter === "function") enter = options.enter;
    if (typeof options.leave === "function") leave = options.leave;
  }
  if (enter === none && leave === none) {
    throw new Error("Neither `enter` nor `leave` walker handler is set or both aren't a function");
  }
  const visit = (node: SyntaxNode): void => {
    enter.call(context as C, node);
    switch (node.type) {
      case "Group":
        node.terms.forEach(visit);
        break;
      case "Multiplier":
      case "Boolean":
        visit(node.term);
        break;
      case "Type":
      case "Property":
      case "Keyword":
      case "AtKeyword":
      case "Function":
      case "String":
      case "Token":
      case "Comma":
        break;
      default:
        throw new Error("Unknown type: " + (node as { type: string }).type);
    }
    leave.call(context as C, node);
  };
  visit(node);
}
