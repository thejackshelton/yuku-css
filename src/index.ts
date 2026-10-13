import { css } from "#module";
import type { Contexts, Location, Offsets, ParseResult, Position, Positions } from "./ast";
import { decode, decodeTokens, tokenNames, tokenTypes } from "./decode.js";

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
   * What the source is read as, by css-tree's name for it. `atrulePrelude`, `mediaQueryList`,
   * `mediaQuery` and `value` give a `Raw` for now.
   * @default "stylesheet"
   */
  context?: ParseContext;
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
   * Parse declaration values. Accepted for css-tree's API; values are `Raw` for now.
   * @default true
   */
  parseValue?: boolean;
  /**
   * Parse at-rule preludes. Accepted for css-tree's API; preludes are `Raw` for now.
   * @default true
   */
  parseAtrulePrelude?: boolean;
  /**
   * Parse custom property values. Accepted for css-tree's API; they are `Raw`, as css-tree keeps them by default.
   * @default false
   */
  parseCustomProperty?: boolean;
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parse(pointer: number, len: number, flags: number): number;
  tokenize(pointer: number, len: number): number;
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
  const context = CONTEXTS[options.context ?? "stylesheet"];
  if (context === undefined) throw new TypeError(`yuku-css: unknown context \`${options.context}\``);
  const tokens = options.tokens === true || options.onToken !== undefined;
  if (tokens && source.length > TOKEN_END_MAX) throw new RangeError("yuku-css: tokens take at most 16 MiB of source");
  const flags =
    (options.parseRulePrelude === false ? 0 : 1) | (options.positions === true ? 2 : 0) | (tokens ? 4 : 0) | (context << 3);
  const result = run(
    source,
    (pointer, len) => exports!.parse(pointer, len, flags),
    (at) => decode(memoryOf(), at, source, options, tokens),
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

function run<T>(source: string, call: (pointer: number, len: number) => number, read: (at: number) => T): T {
  if (
    exports === undefined ||
    (exports.memory.buffer.byteLength > MEMORY_BYTES_MAX && source.length * 64 < MEMORY_BYTES_MAX)
  ) {
    exports = new WebAssembly.Instance(css).exports as unknown as Exports;
  }
  const capacity = source.length * 3 || 1;
  const pointer = exports.alloc(capacity);
  const written = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, pointer, capacity)).written;
  const result = call(pointer, written);
  exports.free(pointer, capacity);
  if (result === 0) throw new Error("yuku-css: out of memory");
  const size = new DataView(exports.memory.buffer).getUint32(result, true);
  // decoding calls no WebAssembly, so the memory cannot grow under it
  try {
    return read(result + 4);
  } finally {
    exports.free(result, 4 + size);
  }
}

function memoryOf(): ArrayBuffer {
  return exports!.memory.buffer;
}
