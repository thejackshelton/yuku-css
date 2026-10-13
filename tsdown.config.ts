import { readFileSync } from "node:fs";
import { defineConfig, type Rolldown } from "tsdown";

// the printable ASCII a double-quoted string holds as it is, so no bundler escapes or grows it
const ALPHABET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).filter((c) => c !== '"' && c !== "\\");
// one character for each of the commonest bytes, two after one of these prefixes for the rest
const PREFIXES = 2;
const SINGLES = ALPHABET.length - PREFIXES;

// Inlines the WebAssembly as text that gzip compresses as well as the binary, where base64
// costs 40% more: each byte is a character or two, by its rank in how often it occurs, so the
// repeats gzip finds in the binary stay byte aligned.
function inlineWasm(): Rolldown.Plugin {
  return {
    name: "inline-wasm",
    load(id) {
      if (!id.endsWith(".wasm")) return null;
      const bytes = readFileSync(id);
      const counts = new Array<number>(256).fill(0);
      for (const byte of bytes) counts[byte]!++;
      const ranks = Array.from({ length: 256 }, (_, byte) => byte).sort((a, b) => counts[b]! - counts[a]! || a - b);
      const rankOf = new Array<number>(256);
      ranks.forEach((byte, rank) => (rankOf[byte] = rank));
      let text = "";
      for (const byte of bytes) {
        const rank = rankOf[byte]!;
        text +=
          rank < SINGLES
            ? ALPHABET[rank]
            : ALPHABET[SINGLES + Math.floor((rank - SINGLES) / ALPHABET.length)]! + ALPHABET[(rank - SINGLES) % ALPHABET.length];
      }
      const code = `function inflate(text, ranks, length) {
  // a character's index in the alphabet, printable ASCII without the quote and the backslash
  const index = new Uint8Array(128);
  for (let c = 32, i = 0; c < 127; c++) if (c !== 34 && c !== 92) index[c] = i++;
  // each byte by rank, as two characters of four bits each
  const byte = new Uint8Array(256);
  for (let k = 0; k < 256; k++) byte[k] = (index[ranks.charCodeAt(2 * k)] << 4) | index[ranks.charCodeAt(2 * k + 1)];
  const bytes = new Uint8Array(length);
  for (let i = 0, j = 0; j < length; j++) {
    let rank = index[text.charCodeAt(i++)];
    if (rank >= ${SINGLES}) rank = ${SINGLES} + (rank - ${SINGLES}) * ${ALPHABET.length} + index[text.charCodeAt(i++)];
    bytes[j] = byte[rank];
  }
  return bytes;
}
export default inflate("${text}", "${ranks.map((byte) => ALPHABET[byte >> 4]! + ALPHABET[byte & 15]).join("")}", ${bytes.length});
`;
      return { code, moduleType: "js" };
    },
  };
}

export default defineConfig({
  entry: {
    index: "src/index.ts",
    ast: "src/ast/index.ts",
    codegen: "src/codegen/index.ts",
    lexer: "src/lexer/index.ts",
    "module/inline": "src/module/inline.ts",
    "module/workerd": "src/module/workerd.ts",
    "lexer/module/inline": "src/lexer/module/inline.ts",
    "lexer/module/workerd": "src/lexer/module/workerd.ts",
  },
  platform: "neutral",
  target: "es2020",
  dts: true,
  hash: false,
  plugins: [inlineWasm()],
  copy: ["zig-out/bin/yuku-css.wasm", "zig-out/bin/yuku-css-lexer.wasm"],
  // `#module` picks the WebAssembly at runtime, inline or, for workerd, the `.wasm` file
  deps: { neverBundle: [/^#/] },
  // bundlers for workerd load an import as WebAssembly only when its path ends in `.wasm`
  outputOptions: { chunkFileNames: "shared/[name].js", paths: { "#wasm": "../yuku-css.wasm", "#lexer-wasm": "../../yuku-css-lexer.wasm" } },
});
