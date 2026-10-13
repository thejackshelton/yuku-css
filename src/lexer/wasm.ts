import { lexer as module } from "#lexer-module";

export interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parseSyntax(pointer: number, len: number): number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let instance: Exports | undefined;

// one instance for the life of the process: custom lexers live in its memory
export function wasm(): Exports {
  return (instance ??= new WebAssembly.Instance(module).exports as unknown as Exports);
}

/** Bytes written into wasm memory, freed by `release`. */
export interface Encoded {
  pointer: number;
  len: number;
  capacity: number;
  /** Whether every character is ASCII, so byte offsets are UTF-16 offsets. */
  ascii: boolean;
}

export function encode(source: string): Encoded {
  const exports = wasm();
  const capacity = source.length * 3 || 1;
  const pointer = exports.alloc(capacity);
  const len = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, pointer, capacity)).written;
  return { pointer, len, capacity, ascii: len === source.length };
}

export function release(encoded: Encoded): void {
  wasm().free(encoded.pointer, encoded.capacity);
}

/** Calls `read` on the result at `result`, then frees it. */
export function take<T>(result: number, read: (words: Uint32Array, bytes: Uint8Array) => T): T {
  if (result === 0) throw new Error("yuku-css: out of memory");
  const exports = wasm();
  const size = new DataView(exports.memory.buffer).getUint32(result, true);
  try {
    return read(
      new Uint32Array(exports.memory.buffer, result + 4, size >>> 2),
      new Uint8Array(exports.memory.buffer, result + 4, size),
    );
  } finally {
    exports.free(result, 4 + size);
  }
}

export function text(bytes: Uint8Array, start: number, len: number): string {
  let ascii = "";
  for (let i = 0; i < len; i++) {
    const c = bytes[start + i]!;
    if (c >= 0x80) return decoder.decode(bytes.subarray(start, start + len));
    ascii += String.fromCharCode(c);
  }
  return ascii;
}

/** UTF-16 offset of byte `offset` in `source`, by its UTF-8 length up to there. */
export function utf16Offset(source: string, encoded: Encoded, offset: number): number {
  if (encoded.ascii) return offset;
  let bytes = 0;
  let i = 0;
  for (; i < source.length && bytes < offset; i++) {
    const c = source.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < source.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return i;
}
