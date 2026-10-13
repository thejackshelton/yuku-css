import { css } from "#module";
import type { ParseResult } from "./ast";
import { decode, shapesOf, type Description, type Shapes } from "./decode";

export type * from "./ast";

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parse(pointer: number, len: number): number;
  release(pointer: number, len: number): void;
  description(): number;
}

// memory never shrinks, so a source needing far less, at most 64 bytes a character, starts fresh
const MEMORY_BYTES_MAX = 128 * 1024 * 1024;

const encoder = new TextEncoder();
let exports: Exports | undefined;
let shapes: Shapes | undefined;

/**
 * Parses a style sheet. It never throws on bad CSS: it returns what parses, with a diagnostic
 * for each error, so a caller that must reject bad CSS checks `diagnostics.length`.
 */
export function parse(source: string): ParseResult {
  if (
    exports === undefined ||
    (exports.memory.buffer.byteLength > MEMORY_BYTES_MAX && source.length * 64 < MEMORY_BYTES_MAX)
  ) {
    exports = new WebAssembly.Instance(css).exports as unknown as Exports;
  }
  shapes ??= shapesOf(describe(exports));

  const capacity = source.length * 3 || 1;
  const pointer = exports.alloc(capacity);
  const written = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, pointer, capacity)).written;
  const result = exports.parse(pointer, written);
  exports.free(pointer, capacity);
  if (result === 0) throw new Error("yuku-css: out of memory");

  const allocated = new Uint32Array(exports.memory.buffer, result, 2)[1]!;
  try {
    return decode(new Uint32Array(exports.memory.buffer, result, allocated), source, shapes);
  } finally {
    exports.release(result, allocated);
  }
}

function describe(exports: Exports): Description {
  const pointer = exports.description();
  const size = new DataView(exports.memory.buffer).getUint32(pointer, true);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer + 4, size)));
}
