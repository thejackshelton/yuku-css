import { css } from "#module";
import type { Offsets, ParseResult, Position, Positions } from "./ast";
import { decode, decodeTokens, tokenNames, tokenTypes } from "./decode.js";

export type * from "./ast";
export { tokenNames, tokenTypes };

export interface ParseOptions {
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

const encoder = new TextEncoder();
let exports: Exports | undefined;

/**
 * Parses a style sheet into css-tree's tree, with arrays for lists. It never throws on bad CSS:
 * what does not parse is kept as `Raw`, with a diagnostic, so a caller that must reject bad CSS
 * checks `diagnostics.length`.
 */
export function parse(source: string, options: ParseOptions & { positions: true }): ParseResult<Positions>;
export function parse(source: string, options?: ParseOptions): ParseResult<Offsets>;
export function parse(source: string, options: ParseOptions = {}): ParseResult<Position> {
  const flags = options.parseRulePrelude === false ? 0 : 1;
  return run(source, (pointer, len) => exports!.parse(pointer, len, flags), (at) => decode(memoryOf(), at, source, options));
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
