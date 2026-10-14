// The pieces of bench/floor/run.mjs: the transfer buffer, the tree as a tape, and the floor, the
// cheapest JavaScript we could write that builds the same tree from that tape.
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const encoder = new TextEncoder();

// the transfer buffer of `source`, copied out of wasm memory so it can be decoded again and again
export function capture(source, flags = 1 | (1 << 7) | (1 << 9)) {
  const module = new WebAssembly.Module(readFileSync(new URL("zig-out/bin/yuku-css.wasm", ROOT)));
  const ex = new WebAssembly.Instance(module).exports;
  const cap = source.length * 3 || 1;
  const p = ex.alloc(cap);
  const n = encoder.encodeInto(source, new Uint8Array(ex.memory.buffer, p, cap)).written;
  const r = ex.parse(p, n, flags);
  const size = new DataView(ex.memory.buffer).getUint32(r, true);
  const buffer = ex.memory.buffer.slice(r + 4, r + 4 + size);
  return { buffer, nodes: new Int32Array(buffer)[0], size };
}

// per type, the keys in order and the kind of each value: num, prim, node, arr
export function shapes(ast) {
  const out = new Map();
  const visit = (n) => {
    let s = out.get(n.type);
    if (s === undefined) out.set(n.type, (s = { keys: Object.keys(n), kinds: {} }));
    if (Object.keys(n).join() !== s.keys.join()) throw new Error(`keys differ for ${n.type}`);
    for (const k of s.keys) {
      if (k === "type") continue;
      const v = n[k];
      const kind = Array.isArray(v) ? "arr" : v !== null && typeof v === "object" ? "node" : typeof v === "number" ? "num" : v === null ? null : "prim";
      if (kind !== null) {
        const prev = s.kinds[k];
        if (prev !== undefined && prev !== kind) throw new Error(`${n.type}.${k}: ${prev} and ${kind}`);
        s.kinds[k] = kind;
      }
      if (kind === "arr") v.forEach(visit);
      else if (kind === "node") visit(v);
    }
  };
  visit(ast);
  for (const s of out.values()) for (const k of s.keys) if (k !== "type" && s.kinds[k] === undefined) s.kinds[k] = "prim";
  return out;
}

// the tree in pre-order as an Int32Array, its primitives as indexes into `values`, or with `slices`
// each string that occurs in the source as its span there, and with "intern" its index too
export function tape(ast, sh, source, slices = false) {
  const types = [...sh.keys()];
  const values = [];
  const index = new Map();
  const out = [];
  const prim = (v) => {
    if (slices) {
      const at = typeof v === "string" ? spans.get(v) : undefined;
      if (at !== undefined) { if (slices === "intern") out.push(valueIndex(v)); out.push(at, at + v.length); return; }
      if (slices === "intern") out.push(-1);
      out.push(-1 - valueIndex(v), 0);
      return;
    }
    out.push(valueIndex(v));
  };
  const valueIndex = (v) => {
    let i = index.get(v);
    if (i === undefined) { i = values.length; values.push(v); index.set(v, i); }
    return i;
  };
  // where each string occurs in the source, for slicing
  const spans = new Map();
  const visit = (n) => {
    const s = sh.get(n.type);
    out.push(types.indexOf(n.type));
    for (const k of s.keys) {
      if (k === "type") continue;
      const v = n[k];
      switch (s.kinds[k]) {
        case "num": out.push(v); break;
        case "prim": prim(v); break;
        case "node": if (v === null) out.push(-1); else visit(v); break;
        case "arr": if (v === null) out.push(-1); else { out.push(v.length); v.forEach(visit); } break;
      }
    }
  };
  if (slices) {
    const walk = (n) => {
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (typeof v === "string" && k !== "type" && !spans.has(v)) {
          const at = typeof n.start === "number" ? source.indexOf(v, n.start) : -1;
          if (at >= 0 && (n.end === undefined || at + v.length <= n.end)) spans.set(v, at);
        } else if (Array.isArray(v)) v.forEach(walk);
        else if (v !== null && typeof v === "object") walk(v);
      }
    };
    walk(ast);
  }
  visit(ast);
  return { tape: Int32Array.from(out), values, types };
}

// one literal per node, read from the tape in order, and lists of up to three as array literals,
// as the decoder builds them
export function floorBuilder(sh, types, slices = false) {
  const lines = [];
  lines.push("let p = 0, S;");
  lines.push("function arr(n) { switch (n) { case 0: return []; case 1: return [node()]; case 2: return [node(), node()]; case 3: return [node(), node(), node()]; } const r = new Array(n); for (let j = 0; j < n; j++) r[j] = node(); return r; }");
  if (slices === "intern") lines.push("function str() { const id = T[p++]; if (id < 0) { const s = T[p]; p += 2; return V[-1 - s]; } let v = S[id]; if (v === undefined) v = S[id] = SRC.slice(T[p], T[p + 1]); p += 2; return v; }");
  else lines.push("function str() { const s = T[p++], e = T[p++]; return s < 0 ? V[-1 - s] : SRC.slice(s, e); }");
  lines.push("function node() { switch (T[p++]) {");
  types.forEach((t, i) => {
    const s = sh.get(t);
    const parts = s.keys.map((k) => {
      if (k === "type") return `type: ${JSON.stringify(t)}`;
      switch (s.kinds[k]) {
        case "num": return `${k}: T[p++]`;
        case "prim": return slices ? `${k}: str()` : `${k}: V[T[p++]]`;
        case "node": return `${k}: T[p] === -1 ? (p++, null) : node()`;
        case "arr": return `${k}: T[p] === -1 ? (p++, null) : arr(T[p++])`;
      }
    });
    lines.push(`case ${i}: return { ${parts.join(", ")} };`);
  });
  lines.push("} }");
  lines.push("return (tape, values, source) => { T = tape; V = values; SRC = source; p = 0; if (INTERN) S = new Array(values.length); return node(); };");
  return new Function(`let T, V, SRC; const INTERN = ${slices === "intern"}; ${lines.join("\n")}`)();
}
