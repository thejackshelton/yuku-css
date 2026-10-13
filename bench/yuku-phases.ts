// yuku-css's `parse` cut into its three steps, each run on its own: encoding the source into
// WebAssembly memory, parsing and serializing in WebAssembly, and decoding the tree in JS.
// It drives the built `.wasm` and `src/decode.ts` the way `src/index.ts` does.
import { readFileSync } from "node:fs";
import { decode, shapesOf } from "../src/decode.ts";

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  free(pointer: number, len: number): void;
  parse(pointer: number, len: number): number;
  release(pointer: number, len: number): void;
  description(): number;
}

export type Phase = "encode" | "wasm" | "decode";

const module = new WebAssembly.Module(readFileSync(new URL("../dist/yuku-css.wasm", import.meta.url)));
const exports = new WebAssembly.Instance(module).exports as unknown as Exports;
const description = exports.description();
const size = new DataView(exports.memory.buffer).getUint32(description, true);
const shapes = shapesOf(JSON.parse(new TextDecoder().decode(new Uint8Array(exports.memory.buffer, description + 4, size))));
const encoder = new TextEncoder();

/** For `source`, a function running one phase, and `done` to free what they share. */
export function phases(source: string): { run: Record<Phase, () => void>; done: () => void } {
  const capacity = source.length * 3 || 1;
  const input = exports.alloc(capacity);
  const written = encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, input, capacity)).written;
  const output = exports.parse(input, written);
  const allocated = new Uint32Array(exports.memory.buffer, output, 2)[1]!;

  return {
    run: {
      encode: () => encoder.encodeInto(source, new Uint8Array(exports.memory.buffer, input, capacity)),
      wasm: () => {
        const result = exports.parse(input, written);
        exports.release(result, new Uint32Array(exports.memory.buffer, result, 2)[1]!);
      },
      decode: () => decode(new Uint32Array(exports.memory.buffer, output, allocated), source, shapes),
    },
    done: () => {
      exports.release(output, allocated);
      exports.free(input, capacity);
    },
  };
}
