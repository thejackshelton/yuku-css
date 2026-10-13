// yuku-css's `parse` cut into its three steps, each run on its own: encoding the source into
// WebAssembly memory, parsing and serializing in WebAssembly, and decoding the tree in JS.
// It drives the built `.wasm` and `src/decode.js` the way `src/index.ts` does.
import { readFileSync } from "node:fs";
import { decode } from "../src/decode.js";
import type { ParseOptions } from "../src/index.ts";

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parse(pointer: number, len: number, flags: number): number;
}

export type Phase = "encode" | "wasm" | "decode";

const module = new WebAssembly.Module(readFileSync(new URL("../dist/yuku-css.wasm", import.meta.url)));
const exports = new WebAssembly.Instance(module).exports as unknown as Exports;
const encoder = new TextEncoder();

/** For `source`, a function running one phase, and `done` to free what they share. */
export function phases(source: string, { positions = false }: { positions?: boolean } = {}): { run: Record<Phase, () => void>; done: () => void } {
  // selectors parsed, and positions as asked, with no tokens kept, in the stylesheet context
  const flags = 1 | (positions ? 2 : 0);
  const options: ParseOptions = { positions };
  const capacity = source.length * 3 || 1;
  const input = exports.alloc(capacity);
  const written = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, input, capacity)).written;
  const output = exports.parse(input, written, flags);
  const size = new DataView(exports.memory.buffer).getUint32(output, true);

  return {
    run: {
      encode: () => encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, input, capacity)),
      wasm: () => {
        const result = exports.parse(input, written, flags);
        exports.free(result, 4 + new DataView(exports.memory.buffer).getUint32(result, true));
      },
      decode: () => decode(exports.memory.buffer, output + 4, source, options, false),
    },
    done: () => {
      exports.free(output, 4 + size);
      exports.free(input, capacity);
    },
  };
}
