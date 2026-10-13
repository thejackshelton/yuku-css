// Per-phase cost of yuku-css and Yuku on large files: encode, wasm (parse + serialize), decode.
// node bench/profile.mjs [--yuku path/to/file.js] [css files...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse as cssTreeParse } from "css-tree";

const YUKU = process.env.YUKU ?? "/Users/jacksm5pro/dev/open-source/yuku/packages/yuku";
const NPM = process.env.NPM_CORPUS ?? "/Users/jacksm5pro/dev/open-source/yuku-css/.worktrees/bench/bench/corpus/npm";
const args = process.argv.slice(2);
const yukuAt = args.indexOf("--yuku");
const yukuFiles = yukuAt >= 0 ? [args.splice(yukuAt, 2)[1]] : [];
const cssFiles = args.length > 0 ? args : ["tailwind.css", "bulma.css", "bootstrap.css"].map((f) => `${NPM}/${f}`);
const withCssTree = process.env.CSSTREE !== "0";
const ROUNDS = Number(process.env.ROUNDS ?? 15);

const encoder = new TextEncoder();

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function time(fn) {
  for (let i = 0; i < 3; i++) fn();
  const out = [];
  for (let i = 0; i < ROUNDS; i++) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return median(out);
}

function row(name, file, bytes, nodes, wire, phases) {
  const ms = (x) => x.toFixed(2).padStart(8);
  const ns = (x) => ((x * 1e6) / nodes).toFixed(1).padStart(6);
  const mbs = (x) => (bytes / 1e6 / (x / 1e3)).toFixed(0).padStart(5);
  console.log(
    `${name.padEnd(18)} ${basename(file).padEnd(16)} nodes ${String(nodes).padStart(8)}  B/node ${(bytes / nodes).toFixed(1).padStart(5)}  wire B/node ${(wire / nodes).toFixed(1).padStart(5)}`,
  );
  for (const [phase, t] of Object.entries(phases)) {
    console.log(`    ${phase.padEnd(22)} ${ms(t)} ms ${ns(t)} ns/node ${mbs(t)} MB/s`);
  }
}

async function profileCss() {
  const { decode } = await import("../src/decode.js");
  const { parse } = await import("../dist/index.js");
  const module = new WebAssembly.Module(readFileSync(new URL("../zig-out/bin/yuku-css.wasm", import.meta.url)));
  const ex = new WebAssembly.Instance(module).exports;
  const prof = new WebAssembly.Instance(
    new WebAssembly.Module(readFileSync(new URL("../zig-out/bin/yuku-css-profile.wasm", import.meta.url))),
  ).exports;
  for (const file of cssFiles) {
    const source = readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(source);
    const encode = () => {
      const cap = source.length * 3 || 1;
      const p = ex.alloc(cap);
      const n = encoder.encodeInto(source, new Uint8Array(ex.memory.buffer, p, cap)).written;
      return [p, cap, n];
    };
    for (const positions of [false, true]) {
      const flags = 1;
      const opts = { positions };
      const enc = time(() => {
        const [p, cap] = encode();
        ex.free(p, cap);
      });
      let size = 0;
      let nodes = 0;
      const wasm = time(() => {
        const [p, cap, n] = encode();
        const r = ex.parse(p, n, flags);
        ex.free(p, cap);
        size = new DataView(ex.memory.buffer).getUint32(r, true);
        nodes = new Uint32Array(ex.memory.buffer, r + 4, 1)[0];
        ex.free(r, 4 + size);
      });
      const cap0 = source.length * 3 || 1;
      const pp = prof.alloc(cap0);
      const pn = encoder.encodeInto(source, new Uint8Array(prof.memory.buffer, pp, cap0)).written;
      const lex = time(() => prof.lexOnly(pp, pn));
      const tree = time(() => prof.parseOnly(pp, pn, 1));
      prof.free(pp, cap0);
      const [p, cap, n] = encode();
      const r = ex.parse(p, n, flags);
      ex.free(p, cap);
      const dec = time(() => decode(ex.memory.buffer, r + 4, source, opts, false).ast);
      ex.free(r, 4 + size);
      const full = time(() => parse(source, opts).ast);
      row(`yuku-css${positions ? " loc" : ""}`, file, bytes, nodes, size, {
        encode: enc,
        "wasm parse+serialize": wasm - enc,
        "  parse": tree,
        "  serialize": wasm - enc - tree,
        "  (lexing alone)": lex,
        "js decode": dec,
        "full parse()": full,
      });
      if (withCssTree) {
        const ct = time(() => cssTreeParse(source, { positions, parseValue: false, parseAtrulePrelude: false, parseCustomProperty: false }));
        console.log(`    css-tree${positions ? " loc" : ""}           ${ct.toFixed(2).padStart(8)} ms  ${(bytes / 1e6 / (ct / 1e3)).toFixed(0)} MB/s  ${(ct / full).toFixed(2)}x slower`);
      }
    }
  }
}

async function profileYuku() {
  const { decode } = await import(`${YUKU}/core/decode.js`);
  const module = new WebAssembly.Module(readFileSync(`${YUKU}/core/yuku.wasm`));
  const ex = new WebAssembly.Instance(module).exports;
  // module, js, preserveParens, as `parse(src, { lang: "js" })` sends
  const flags = 1 | (0 << 2) | (1 << 5);
  for (const file of yukuFiles) {
    const source = readFileSync(file, "utf8");
    const bytes = Buffer.byteLength(source);
    const encode = () => {
      const cap = source.length * 3 || 1;
      const p = ex.alloc(cap);
      const n = encoder.encodeInto(source, new Uint8Array(ex.memory.buffer, p, cap)).written;
      return [p, cap, n];
    };
    const enc = time(() => {
      const [p, cap] = encode();
      ex.free(p, cap);
    });
    let size = 0;
    let nodes = 0;
    const wasm = time(() => {
      const [p, cap, n] = encode();
      const r = ex.parse(p, n, flags);
      ex.free(p, cap);
      size = new DataView(ex.memory.buffer).getUint32(r, true);
      nodes = new Uint32Array(ex.memory.buffer, r + 4, 1)[0];
      ex.free(r, 4 + size);
    });
    const [p, cap, n] = encode();
    const r = ex.parse(p, n, flags);
    ex.free(p, cap);
    const copy = time(() => ex.memory.buffer.slice(r + 4, r + 4 + size));
    const buffer = ex.memory.buffer.slice(r + 4, r + 4 + size);
    ex.free(r, 4 + size);
    const dec = time(() => decode(buffer, source, null, null).program);
    const { parse } = await import(`${YUKU}/dist/index.js`);
    const full = time(() => parse(source, { lang: "js" }).program);
    row("yuku", file, bytes, nodes, size, {
      encode: enc,
      "wasm parse+serialize": wasm - enc,
      "copy out": copy,
      "js decode": dec,
      "full parse()": full,
    });
  }
}

if (yukuFiles.length > 0) await profileYuku();
if (process.env.CSS !== "0") await profileCss();
