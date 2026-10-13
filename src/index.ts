import { css } from "#module";
import type { Contexts, Diagnostic, Location, Offsets, ParseResult, Position, Positions } from "./ast";
import { atrules, decode, decodeTokens, tokenNames, tokenTypes } from "./decode.js";

export type * from "./ast";
export { tokenNames, tokenTypes };

export type ParseContext = keyof Contexts;

/** A parse error, as css-tree's `onParseError` receives it. */
export interface CssSyntaxError extends SyntaxError {
  /** Counted from `offset`. */
  offset: number;
  line: number;
  column: number;
  source: string;
}

export interface ParseOptions {
  /**
   * What the source is read as, by css-tree's name for it.
   * @default "stylesheet"
   */
  context?: ParseContext;
  /**
   * The at-rule, without `@`, whose prelude the `atrulePrelude` context reads, as css-tree's
   * `atrule` option names it. Without one, the prelude is a sequence of component values.
   */
  atrule?: string;
  /**
   * Give each node a css-tree `loc` with lines and columns in place of `start` and `end`.
   * @default false
   */
  positions?: boolean;
  /** `loc.source`. @default "<unknown>" */
  filename?: string;
  /** Added to every `loc` offset, for a fragment of a larger source. @default 0 */
  offset?: number;
  /** The line the source starts on. @default 1 */
  line?: number;
  /** The column the source starts on. @default 1 */
  column?: number;
  /**
   * Keep every token in {@link ParseResult.tokens}, packed as {@link tokenize} packs them.
   * @default false
   */
  tokens?: boolean;
  /** Called with each diagnostic as a css-tree `SyntaxError`, after parsing. */
  onParseError?: (error: CssSyntaxError) => void;
  /** Called with each comment's text and css-tree `loc`, null without `positions`, after parsing. */
  onComment?: (value: string, loc: Location | null) => void;
  /** Called with each token's type, one of `tokenTypes`, and its offsets, after parsing; an array receives each as an object. */
  onToken?: ((type: number, start: number, end: number, index: number) => void) | { type: number; start: number; end: number }[];
  /**
   * Parse each rule's prelude as a `SelectorList`. When false, it is a `Raw`.
   * @default true
   */
  parseRulePrelude?: boolean;
  /**
   * Parse declaration values as a `Value`. When false, they are `Raw`.
   * @default true
   */
  parseValue?: boolean;
  /**
   * Parse each at-rule's prelude as an `AtrulePrelude`. When false, it is a `Raw`.
   * @default true
   */
  parseAtrulePrelude?: boolean;
  /**
   * Parse custom property values, and `var()` fallbacks, as a `Value`. When false, they are `Raw`.
   * @default false
   */
  parseCustomProperty?: boolean;
}

export interface TransformOptions
  extends Pick<
    ParseOptions,
    "context" | "atrule" | "parseRulePrelude" | "parseValue" | "parseAtrulePrelude" | "parseCustomProperty"
  > {
  /** The map's source. @default "<unknown>" */
  filename?: string;
  /**
   * Return a source map in {@link TransformResult.map}, mapping where each at-rule, selector and
   * declaration starts, as css-tree's `generate` maps a tree parsed with `positions`.
   * @default false
   */
  sourceMap?: boolean;
  /**
   * Where spaces go between tokens. `"spec"` adds only those the CSS Syntax needs for the text to
   * read back the same; `"safe"` adds a few more, where old browsers misread the pair.
   * @default "safe"
   */
  mode?: "safe" | "spec";
}

export interface TransformResult {
  /** The CSS as css-tree's `generate` prints the tree `parse` reads: no comments but `/*!`, no spaces but those between tokens that need them. */
  code: string;
  /** The source map as JSON, version 3, with `sourceMap: true`. */
  map?: string;
  /** Empty when the source parsed without error. */
  diagnostics: Diagnostic[];
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parse(pointer: number, len: number, flags: number): number;
  tokenize(pointer: number, len: number): number;
  transform(pointer: number, len: number, flags: number): number;
}

// memory never shrinks, so a source needing far less, at most 64 bytes a character, starts fresh
const MEMORY_BYTES_MAX = 128 * 1024 * 1024;
// a token packs its type above a 24-bit end, as css-tree's `offsetAndType` does
const TOKEN_END_MAX = 0xffffff;
const CONTEXTS: Record<ParseContext, number> = {
  stylesheet: 0,
  atrule: 1,
  atrulePrelude: 2,
  mediaQueryList: 3,
  mediaQuery: 4,
  rule: 5,
  selectorList: 6,
  selector: 7,
  block: 8,
  declarationList: 9,
  declaration: 10,
  value: 11,
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let exports: Exports | undefined;

/**
 * Parses CSS into css-tree's tree, with arrays for lists; a style sheet unless `context` says
 * otherwise. It never throws on bad CSS: what does not parse is kept as `Raw`, with a diagnostic,
 * so a caller that must reject bad CSS checks `diagnostics.length`.
 */
export function parse<C extends ParseContext = "stylesheet">(
  source: string,
  options: ParseOptions & { context?: C; positions: true },
): ParseResult<Positions, C>;
export function parse<C extends ParseContext = "stylesheet">(
  source: string,
  options?: ParseOptions & { context?: C },
): ParseResult<Offsets, C>;
export function parse(source: string, options: ParseOptions = {}): ParseResult<Position, ParseContext> {
  const tokens = options.tokens === true || options.onToken !== undefined;
  if (tokens && source.length > TOKEN_END_MAX) throw new RangeError("yuku-css: tokens take at most 16 MiB of source");
  const flags = flagsOf(options) | (options.positions === true ? 2 : 0) | (tokens ? 4 : 0);
  const result = lend(source, (pointer, len) => exports!.parse(pointer, len, flags), (at, open) =>
    decode(memoryOf(), at, source, options, tokens, open),
  );
  if (options.onToken !== undefined) deliverTokens(result.tokens!, source, options.onToken);
  if (options.onComment !== undefined) {
    for (const comment of result.comments) options.onComment(comment.value, "loc" in comment ? comment.loc : null);
  }
  if (options.onParseError !== undefined) {
    for (const diagnostic of result.diagnostics) options.onParseError(syntaxError(source, diagnostic.message, diagnostic.start, options));
  }
  if (options.tokens !== true) delete result.tokens;
  return result;
}

/**
 * Parses CSS and prints it back as {@link parse} and `yuku-css/codegen`'s `generate` would, in one
 * WebAssembly call that builds no tree in JavaScript. Like `parse`, it never throws on bad CSS:
 * check `diagnostics.length`. It removes whitespace and comments, and minifies no further.
 */
export function transform(source: string, options: TransformOptions & { sourceMap: true }): TransformResult & { map: string };
export function transform(source: string, options?: TransformOptions): TransformResult;
export function transform(source: string, options: TransformOptions = {}): TransformResult {
  const sourceMap = options.sourceMap === true;
  const flags = flagsOf(options) | (options.mode === "spec" ? 1 << 14 : 0) | (sourceMap ? 1 << 15 : 0);
  return run(
    source,
    (pointer, len) => exports!.transform(pointer, len, flags),
    (at) => {
      const header = new Uint32Array(memoryOf(), at, 4);
      const codeLength = header[0]!;
      const mappingsLength = header[1]!;
      const count = header[2]!;
      const bytes = new Uint8Array(memoryOf(), at + 16, codeLength + mappingsLength);
      const result: TransformResult = { code: decoder.decode(bytes.subarray(0, codeLength)), diagnostics: new Array(count) };
      if (sourceMap) {
        const sources = header[3] === 1 ? [options.filename || "<unknown>"] : [];
        const mappings = decoder.decode(bytes.subarray(codeLength));
        result.map = JSON.stringify({ version: 3, sources, names: [], mappings });
      }
      const base = (at + 16 + codeLength + mappingsLength + 3) & ~3;
      const records = new Uint32Array(memoryOf(), base, count * 3);
      const path = options.filename ?? null;
      for (let i = 0, text = base + count * 12; i < count; i++) {
        const message = decoder.decode(new Uint8Array(memoryOf(), text, records[3 * i + 2]!));
        text += records[3 * i + 2]!;
        result.diagnostics[i] = { severity: "error", message, path, start: records[3 * i]!, end: records[3 * i + 1]!, labels: [], help: null };
      }
      return result;
    },
  );
}

// the options `parse` and `transform` share, packed as src/wasm.zig reads them
function flagsOf(options: TransformOptions): number {
  const context = CONTEXTS[options.context ?? "stylesheet"];
  if (context === undefined) throw new TypeError(`yuku-css: unknown context \`${options.context}\``);
  return (
    (options.parseRulePrelude === false ? 0 : 1) |
    (context << 3) |
    (options.parseValue === false ? 0 : 1 << 7) |
    (options.parseCustomProperty === true ? 1 << 8 : 0) |
    (options.parseAtrulePrelude === false ? 0 : 1 << 9) |
    (atruleOf(options.atrule) << 10)
  );
}

function atruleOf(name: string | undefined): number {
  if (!name) return 0;
  const lower = String(name).toLowerCase();
  return Object.hasOwn(atrules, lower) ? atrules[lower]! : 0;
}

function deliverTokens(tokens: Uint32Array, source: string, onToken: NonNullable<ParseOptions["onToken"]>): void {
  let start = source.charCodeAt(0) === 0xfeff || source.charCodeAt(0) === 0xfffe ? 1 : 0;
  for (let i = 0; i < tokens.length; i++) {
    const type = tokens[i]! >>> 24;
    const end = tokens[i]! & TOKEN_END_MAX;
    if (Array.isArray(onToken)) onToken.push({ type, start, end });
    else onToken(type, start, end, i);
    start = end;
  }
}

// css-tree's line and column: lines break at \n, \r\n, \r and \f
function syntaxError(source: string, message: string, at: number, options: ParseOptions): CssSyntaxError {
  let line = options.line ?? 1;
  let column = options.column ?? 1;
  for (let i = 0; i < at; i++) {
    const c = source.charCodeAt(i);
    if (c === 10 || c === 12 || (c === 13 && source.charCodeAt(i + 1) !== 10)) {
      line++;
      column = 1;
    } else column++;
  }
  return Object.assign(new SyntaxError(message), { offset: (options.offset ?? 0) + at, line, column, source });
}

/**
 * Splits `source` into CSS tokens, each packed as css-tree packs `offsetAndType`: the type, one of
 * `tokenTypes`, in the top 8 bits, and the UTF-16 offset where the token ends in the low 24. A
 * token starts where the one before it ends; the first after a byte order mark.
 */
export function tokenize(source: string): Uint32Array {
  if (source.length > TOKEN_END_MAX) throw new RangeError("yuku-css: tokenize takes at most 16 MiB of source");
  return run(source, (pointer, len) => exports!.tokenize(pointer, len), (at) => decodeTokens(memoryOf(), at, source));
}

// the buffer read by `read` and freed, as nothing else holds it
function run<T>(source: string, wasm: (pointer: number, len: number) => number, read: (at: number) => T): T {
  const result = call(source, wasm);
  try {
    return read(result + 4);
  } finally {
    exports!.free(result, 4 + new DataView(memoryOf()).getUint32(result, true));
  }
}

// a parse result whose tree is still in wasm memory, held there until `ast` is read
interface Lease {
  pointer: number;
  size: number;
  // the buffer, once copied out for the next call
  bytes: ArrayBuffer | undefined;
}

let lease: Lease | undefined;

// the buffer left in wasm memory, read by `read` with a function that builds the tree from it
function lend<T>(
  source: string,
  run: (pointer: number, len: number) => number,
  read: (at: number, open: <R>(build: (buffer: ArrayBuffer, at: number) => R) => R) => T,
): T {
  const result = call(source, run);
  const own: Lease = { pointer: result, size: new DataView(memoryOf()).getUint32(result, true), bytes: undefined };
  lease = own;
  const open = <R>(build: (buffer: ArrayBuffer, at: number) => R): R => {
    if (lease !== own) return build(own.bytes!, 0);
    lease = undefined;
    try {
      return build(memoryOf(), own.pointer + 4);
    } finally {
      exports!.free(own.pointer, 4 + own.size);
    }
  };
  try {
    return read(result + 4, open);
  } catch (error) {
    if (lease === own) {
      lease = undefined;
      exports!.free(own.pointer, 4 + own.size);
    }
    throw error;
  }
}

// copies a tree not yet read out of wasm memory, before a call can reuse or grow it
function settle(): void {
  if (lease === undefined) return;
  const { pointer, size } = lease;
  lease.bytes = exports!.memory.buffer.slice(pointer + 4, pointer + 4 + size);
  exports!.free(pointer, 4 + size);
  lease = undefined;
}

function call(source: string, run: (pointer: number, len: number) => number): number {
  settle();
  if (
    exports === undefined ||
    (exports.memory.buffer.byteLength > MEMORY_BYTES_MAX && source.length * 64 < MEMORY_BYTES_MAX)
  ) {
    exports = new WebAssembly.Instance(css).exports as unknown as Exports;
  }
  const capacity = source.length * 3 || 1;
  const pointer = exports.alloc(capacity);
  const written = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, pointer, capacity)).written;
  const result = run(pointer, written);
  exports.free(pointer, capacity);
  if (result === 0) throw new Error("yuku-css: out of memory");
  return result;
}

function memoryOf(): ArrayBuffer {
  return exports!.memory.buffer;
}
