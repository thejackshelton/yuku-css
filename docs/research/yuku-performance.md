# Where Yuku's speed comes from, and what yuku-css still lacks

Researched 2026-10-13 on an Apple M5 Pro, Node 24.15.0, Bun 1.3.14, Zig 0.17.0.
Repos read: `yuku` (branch `parser/tsrx-extension-points`, f8381097), `yuku-tsrx-arshad` (main, 80b5547),
`yuku-tsrx` (tsrx-org, transfer ideas only), `yuku-css` (main, 0f8bebe). Line numbers refer to those commits.

## 1. Summary

Yuku's speed comes from structure and memory discipline, not from one trick. On the Zig side it has a lazy,
table-driven lexer with inline fast paths for the most common tokens. Its parser is single pass, recursive
descent plus Pratt (precedence climbing) for expressions, with precedence and class bits packed into the
token tag. Nodes live in a struct-of-arrays list (`MultiArrayList`) whose capacity is reserved up front from
the source length, so the hot path is `appendAssumeCapacity`. Children lists sit in one flat `extras` array.
Strings are `(start, end)` spans into the source, plus a deduplicated pool for the rare decoded string. Each
parse uses one arena, freed in a single step. Across the WebAssembly boundary, the source is encoded once
with `encodeInto` straight into wasm memory. The tree comes back as fixed 48-byte records, and a decoder that
is **generated at build time from the Zig types** turns it into JS objects: one object literal per node
type, strings sliced from the JS source string, and byte-to-UTF-16 offset mapping only past the first
non-ASCII byte, built lazily. Yuku's SIMD code (`@Vector(16, u8)`) runs only in native builds: the npm
WebAssembly targets the `mvp` CPU, which has no `simd128`. So the npm speed comes from layout, allocation and
decoding, not from SIMD. yuku-css already copies the boundary design: no-import instance, `encodeInto`,
instance reuse, memory-reset policy, source-slice strings, UTF-16 shortcut for ASCII, inline/workerd module
split. Its fixed cost per call is already lower than Yuku's. What it lacks: the generated decoder (measured:
JS decode 6.4 → 3.6 µs per file), preallocated and compact node storage (node appends are 22.8% of wasm time
in the profile), and a single-pass, table-driven scanner.

## 2. Technique catalogue (Yuku, with evidence)

### 2.1 Lexer

| Technique | Evidence |
|---|---|
| Lazy, pull-based lexer: the parser asks for one token at a time, so there is no token array unless `tokens: true` | `yuku/src/parser/parser.zig:345-352` (`advanceWithoutEscapeCheck`), `:195-204` (`commitToken` only when collecting) |
| Inline fast path for the most common tokens (ASCII identifier, single-byte punctuation, `.`), falling back to the full scanner | `lexer.zig:177-207` (`tryNextToken`), dispatch table `fast_class: [256]FastClass` at `:291-301` |
| Newline-then-indentation fast path: skips a run of spaces after `\n` 16 bytes at a time, and rewinds on a miss | `lexer.zig:209-240` |
| 256-entry lookup tables for character classes | `ident_start_table_ascii` / `ident_continue_table_ascii` `lexer.zig:815-838`, `simple_punct_tag` `:275-289`, `trivia_class` used at `:1164`, `:1180` |
| SIMD scanning with `@Vector(16, u8)`: identifier runs, "find any of these bytes" for strings and comments, space runs | `util/simd.zig:1-48`; `identContinueRun` `lexer.zig:46-53`; `findAnyPos` `:55-70`; strings `:589-613`; line comments `:1274` |
| aarch64 has no `movemask`, so Yuku packs one nibble per lane with `shrn` | `util/simd.zig:39-48` |
| Keyword recognition by perfect hash over (first, second, last byte, length) into a 512-slot table, checked at compile time | `lexer.zig:955-998`; candidate gate (first byte `a`-`z`, length 2..11) at `:265-270` |
| Trivia fast exit when the next byte is not trivia; `' '` tested before the table | `lexer.zig:1161-1179` |
| Token is a 16-byte `extern struct`, so the token list crosses the boundary as is | `token.zig:387-393`; `transfer/root.zig:140` |
| Token tag is a `u32` whose bits carry precedence and class flags (`IsBinaryOp`, `IsKeyword`, …), so class tests are a single AND | `token.zig:3-16`, `:18-60` |
| Write the token in place to avoid a stack round trip | `lexer.zig:129-133` |
| Cold paths marked `@branchHint(.cold)` / `noinline` | `parser.zig:281`, `:289`, `:328-329`; `lexer.zig:1221` |

### 2.2 Parser

| Technique | Evidence |
|---|---|
| Recursive descent for statements; Pratt (precedence climbing) for expressions, with precedence read from tag bits | `syntax/expressions.zig:30-100`; `token.zig:14` (`PrecShift`) |
| Scratch buffers held on the parser, used with checkpoint and reset, then flushed in one `appendSlice` to `extras` | `parser.zig:102-107`, `:219-236`, `:306-312`, `:666-698` |
| Cheap speculation: a checkpoint stores lengths, and rewind shrinks the arrays | `parser.zig:380-414`, `:647-664` |
| Error recovery: never throws, skips to a terminator or a keyword that starts a new line, and records diagnostics | `parser.zig:585-616` |
| Dialect hooks resolved at compile time (`@hasDecl`), so a build without a dialect pays nothing | `dialect.zig:64-112` |

### 2.3 AST memory layout

| Technique | Evidence |
|---|---|
| Struct-of-arrays: `MultiArrayList(Node)` splits `data` from `span` | `ast.zig:2598-2603` |
| Node size fixed by compile-time assertions (`NodeData` 44 B, `Node` 52 B) | `ast.zig:2605-2610` |
| `NodeIndex = enum(u32)` with `null = maxInt`; child lists are `IndexRange {start, len}` into one `extras` array | `ast.zig:328-337`, `:287-297` |
| Strings are `(start, end)`; below `source.len` the string is a source slice, above it a slice of a deduplicated pool (Wyhash) | `strings.zig:1-97` |
| Append fast path: `appendAssumeCapacity` while there is room | `ast.zig:270-297` |
| Post-order node order (children before parents) is asserted in safe builds | `transfer/root.zig:247`, `:351-375` |

### 2.4 Allocation

| Technique | Evidence |
|---|---|
| One arena per tree; `deinit` frees everything | `ast.zig:132-183` |
| Capacity reserved from source size: nodes `max(256, len/2)` (len/4 above 512 KB), extras `len/6` (len/12), scratch 256, tokens `len/3` | `parser.zig:618-644` |
| Written doctrine: "Size buffers ahead of time", "Reuse, don't reallocate", "Never allocate in a hot loop", "Keep hot data small and dense" | `yuku/AGENTS.md:61-63`, `:103-126` |
| No reuse across parses: each call builds and frees its own tree | `ffi/wasm.zig:52-61` |

### 2.5 WebAssembly boundary

| Technique | Evidence |
|---|---|
| Module has no imports; exports `alloc`, `free`, `parse`, `analyze`, `dialect` | `ffi/wasm.zig:1-42` |
| Allocator is `std.heap.wasm_allocator` (grows memory, never shrinks) | `ffi/wasm.zig:7` |
| Options packed into one `u32` flags argument | `ffi/wasm.zig:9-18`; JS side `core/wasm.ts:115-133` |
| Exact output size computed first, then written in one pass behind a 4-byte length prefix | `transfer/root.zig:216-240`; `ffi/wasm.zig:58-60`, `:87-92` |
| JS encodes once: `encodeInto` into a `len*3` buffer in wasm memory | `packages/yuku/core/wasm.ts:86-92` |
| Output is **copied out** with `memory.buffer.slice` and freed before decoding | `core/wasm.ts:94-97` |
| One instance per module, recreated when memory passes 128 MB and the new source is small | `core/wasm.ts:42-83` |
| Build: `wasm32-freestanding`, CPU `mvp` (no SIMD, no bulk memory), `.fast`; the comment says ReleaseSmall saves 85 kB at a cost of 10 to 15% | `yuku/build.zig:134-141`; Zig's `mvp` has an empty feature set (`lib/std/Target/wasm.zig:194-198`) |
| Module compiled synchronously at import from inlined bytes; workerd gets the `.wasm` file through an import condition | `core/module/inline.ts:1-3`, `core/module/workerd.ts:1-3`, `packages/yuku/package.json` `imports."#module"`, `tsdown.config.ts` |

### 2.6 AST transfer to JS

| Technique | Evidence |
|---|---|
| Fixed 48-byte node record: `tag u8`, `flags u16`, nine `u32` slots, span; bools and enums packed into flag bits; layouts derived at compile time, with a compile error if a node does not fit | `transfer/root.zig:58-65`, `:139-160`, `:162-214`, `:377-437` |
| Nodes packed by pointer, so the union is never copied | `transfer/root.zig:382` |
| Flat sections (`extras`, string pool, tokens) written with `memcpy` | `transfer/root.zig:280-315` |
| `first_non_ascii` in the header: offsets below it need no UTF-16 conversion; the scan runs 16 bytes at a time | `transfer/root.zig:54-55`, `:439-447` |
| **Decoder generated at build time** from the Zig types (`tools/estree/decoder.zig`, 1,877 lines) into `packages/yuku/core/decode.js` | `yuku/build.zig:186-200` |
| One `switch` case per tag returns one object literal with a fixed key order, so each node type gets a stable hidden class (V8's internal object shape) | `core/decode.js:796-1236` |
| Enums become lookups in constant string arrays | `core/decode.js:4-22` |
| Source strings: `_src.slice(s, e)` on the JS string, so there is no `TextDecoder` per string; the pool goes through `TextDecoder` | `core/decode.js:705-746` |
| Byte-to-UTF-16 map built in JS, lazily, only from the first non-ASCII byte | `core/decode.js:636-668`, `:734-739` |
| Recursion bounded at depth 128, then an iterative fallback | `core/decode.js:797`, `:1237-1242` |
| Lazy top level: `program`, `comments`, `diagnostics`, `tokens` decoded on first access; tokens are a view class reading the `Int32Array` | `core/decode.js:185-255`, `:1450-1476` |
| Generated child-slot tables compute parents without decoding nodes | `core/decode.js:288`, `:462`, `:1313-1340` |
| Dialect nodes (not known at Yuku's build time) use a **generic** shape-driven path | `core/decode.js:669-678`, case 171 at `:1234` |

### 2.7 Analyzer and codegen patterns

`analyze` runs scope analysis and module records inside wasm and transfers their results in the same buffer
(`ffi/wasm.zig:63-74`, `transfer/semantic.zig`). JS reads them through accessor closures over typed arrays
rather than per-item objects (`core/decode.js:1342-1449`). The lesson: work done in Zig never pays the
per-node cost of building JS objects.

### 2.8 yuku-tsrx-arshad (dialect on Yuku)

- Plugs in as a Zig file passed to Yuku's build: `b.dependency("yuku", .{ .dialect = b.path("src/tsrx.zig") })`, then `addWasm` (`yuku-tsrx-arshad/build.zig:1-6`; `yuku/build.zig:224-243`).
- Node shapes and file extensions are declared in Zig (`src/tsrx.zig:15-80`), serialized to JSON, and read once by JS (`yuku/core/wasm.ts:100-113`).
- JS reuses Yuku's runtime and passes its own module: `parseYuku(source, { preserveParens: false, ...options, wasm: tsrx })` (`src/index.ts:13-15`). The inline/workerd split is the same (`src/module/inline.ts`, `src/module/workerd.ts`, `tsdown.config.ts`).
- `<style>` bodies stay raw text: it finds `</style>` and does not parse the CSS (`src/tsrx.zig:635-660`).
- Bench (`bench/index.ts`): tinybench, 5 s run plus 1 s warmup, each parser in a fresh Node process, three processes, median of the p50 time per file. yuku-css's `bench/index.ts` copies this design.

### 2.9 yuku-tsrx (older engine), transfer ideas only

Transfer v7 (`src/dialect/transfer.zig:1-90`) worked in both directions: `deserializeFromBuf` rebuilt a Zig
tree from the buffer for codegen. It also saved slots by giving the first two `IndexRange` fields a u16
length. `style.zig` scanned CSS structure into dialect nodes (`scanSheet`, `:83`) without a full parser.

## 3. yuku-css gap table, ranked by expected impact

Baseline (measured, section 4): 17.6 to 18.4 µs per file end to end. Of that, about 1.2 µs is encoding,
about 9.5 µs is wasm parse plus serialize, and about 6.3 µs is JS decode. Corpus: 252 files, 2,383 B and
about 250 nodes per file.

| # | Technique | yuku-css today | Evidence (yuku-css) | Expected impact | Concrete change |
|---|---|---|---|---|---|
| 1 | Decoder specialized per node type (Yuku generates it) | **Not done.** A generic interpreter: it destructures the shape for each node, loops over fields, and stores keys dynamically (`result[names[i]] = …`) | `src/decode.ts:42-75`; shapes from runtime JSON `src/index.ts:34`, `:51-55` | **Measured:** decode 6.4 → 3.6 µs per file on identical streams, about 16% of the total, with output deep-equal | Emit `src/decode.js` at build time from `ast.Data` (a Zig generator, as `yuku/tools/gen_decoder.zig` does), with one `case` and one object literal per tag and enum arrays as constants. Do not use `new Function` at runtime: workerd forbids code generation from strings. Keep the JSON description only for diagnostics, or drop it |
| 2 | Node capacity reserved from source size, plus the `appendAssumeCapacity` fast path | **Not done.** Every `add`, `push` and `listFrom` grows an `ArrayList` in a shared arena. The lists interleave, so arena growth cannot stay in place and copies | `src/parser.zig:54-70`, `:13-15` | **Profile:** `Parser.add` is 22.8% of wasm time including callees, and `memcpy` called from `add` is 7.5%. Upper bound about 2 µs per file | Before parsing, `ensureTotalCapacity` on `nodes` (about `len/8 + 16`; the corpus has 9.5 B per node), `extra` (about `len/16`) and `scratch` (256). Use `appendAssumeCapacity` when there is room (`yuku/src/parser/ast.zig:279-283`). Use `std.heap.ArenaAllocator` only as the overflow path |
| 3 | Compact node, struct-of-arrays | **Not done.** `ArrayList(Node)` (array of structs). By layout arithmetic (not measured), every node pays the largest payload, `attribute_selector` with four `?Span` (12 B each) plus `Span`: 56 B payload plus tag, about 60 B `Data`, about 68 B `Node`. `add` takes `Data` by value, so each node is copied | `src/ast.zig:32-60`, `:47`; `src/parser.zig:54-57` | Shares the 22.8% above. On `mvp` (no bulk memory), large struct copies lower to `memcpy` calls, which is consistent with `memcpy` under `add` | Use `std.MultiArrayList(Node)`. Encode optional spans with a sentinel (`start = maxInt`) so `?Span` costs 8 B, or move `attribute_selector`'s optional parts to `extra`. Add `comptime` size asserts as Yuku does (`ast.zig:2605-2610`) |
| 4 | Serialization | **Partial.** A recursive pre-order writer that dispatches per field. The output buffer is the worst case (14 u32 per node). The UTF-16 table is built eagerly in Zig, and the first-non-ASCII scan is scalar | `src/transfer.zig:73-151`, `:153-192`, `:160` | **Profile:** `Writer.node` is 16.6%. `wasm.parse` self time is 10.6% and includes the inlined `serialize` / `Utf16Offsets.init`, which scans all of each ASCII file | (a) Keep pre-order: it suits eager sequential decode. Flatten `Writer.field` into a per-tag `inline else` that writes a fixed slot count. (b) Find the first non-ASCII byte 8 bytes at a time (`u64 & 0x8080808080808080`). This is portable on `mvp`, where a `@Vector` would be scalarized. (c) Optional: as Yuku does, move UTF-16 mapping to JS and make it lazy, to drop the `len*4` table on non-ASCII files |
| 5 | Single-pass, table-driven scanning | **Partial.** A `significant[256]` table exists. But `statementEnd` scans each rule prelude, then `parseSelectorList` scans it again; `trimEnd` walks backwards. `isName`, `isNameStart` and `isSpace` are branch chains, not tables | `src/parser.zig:117-119`, `:165-183`, `:685-717`, `:748-769` | **Profile:** `identEnd` 6.1% self. The double scan of selector preludes is not isolated in the profile. Estimated a few percent: preludes are a minority of bytes, since declaration values are scanned once (`known_stop`, `:180`) | (a) Replace `isName`, `isNameStart` and `isSpace` with one `[256]u8` class bitmask table (`yuku/src/parser/lexer.zig:815-838`, `:291-301`). (b) Parse the selector while scanning for `{`, and fall back to `raw` on failure, rather than finding `{` first |
| 6 | SIMD byte scanning | **Not done**, and it would not help the npm build as configured: `mvp` has no `simd128`, so `@Vector` code is scalarized. This applies to Yuku too | `yuku-css/build.zig:15-21`; Zig `mvp` = `featureSet(&.{})` | **Measured:** building today's code with `simd128` gives no gain (10.5 vs 10.9 µs), because there is no vector code to use it | Only if (5) leaves scanning hot: add `@Vector` "find any of `{}()[];/\"'\\`" and comment scans, **and** build with `-mcpu=mvp+simd128`. Check runtime support first (open question 2). Measure; do not assume |
| 7 | Bulk-memory instructions (`memory.copy`/`memory.fill`) | **Not done** (`mvp`) | `build.zig:18` | **Measured:** `mvp+bulk_memory` 10.5 to 10.7 vs 10.9 to 11.0 µs per file for wasm. About 3 to 5%, near the noise. Smaller once (2) and (3) remove most copies | Optional: `-mcpu=generic` or `mvp+bulk_memory`. Yuku stays on `mvp`. Re-measure after (2) and (3) |
| 8 | Lazy top-level result | **Not done.** `stylesheet` and `diagnostics` are decoded eagerly | `src/decode.ts:77-83` | Negligible on this corpus (one tree, few diagnostics). Only matters if callers often want diagnostics alone | Getter for `stylesheet`, as `yuku/core/decode.js:1450-1476` does. Low priority |
| 9 | Random-access node records (fixed stride, indexable) | **Not done.** A variable-length pre-order stream can only be decoded fully, in sequence | `src/transfer.zig:1-12` | None for full decoding. Matters only for lazy subtree access or parent tables (Yuku `decode.js:1313-1340`) | Keep the stream unless a consumer needs partial access |
| 10 | Exact-size output | **Not done.** Worst case of 14 u32 per node is allocated; a comment explains why it is not shrunk | `src/transfer.zig:77-90` | Memory, not time. About 56 B reserved per node | Two-pass `bufferSize` as Yuku does (`transfer/root.zig:216-240`), or keep it as is |
| 11 | ReleaseFast | **Done** | `build.zig:20` | **Measured:** ReleaseSmall is 2.7× slower (28.8 vs 10.9 µs) for 16 kB less wasm (23 kB vs 39 kB). Yuku cites 10 to 15% for its own build | Keep |
| 12 | No-import module, `alloc`/`free`, one `encodeInto` into wasm memory | **Done** | `src/wasm.zig:1-20`; `src/index.ts:36-40` | — | — |
| 13 | Decode straight from wasm memory, with no copy-out | **Done, and better than Yuku** (Yuku copies with `slice`, `core/wasm.ts:95`) | `src/index.ts:43-48` | — | Keep. Safe because decode makes no wasm calls, so memory cannot grow mid-decode |
| 14 | Instance reuse plus reset above 128 MB | **Done** | `src/index.ts:16-33` | — | — |
| 15 | Strings as source slices; enums as constant arrays; ASCII offsets unchanged | **Done** | `src/decode.ts:61-72`; `src/transfer.zig:188-191` | — | — |
| 16 | Arena per parse, depth bound 128, never throws on bad CSS | **Done** | `src/parser.zig:12-28`, `:134-141` | — | — |
| 17 | Inline vs workerd module split, sync compile at import | **Done** | `src/module/*.ts`, `tsdown.config.ts`, `package.json` `imports` | — | — |
| 18 | Do the work in Zig, return less to JS (Yuku's analyzer pattern) | **Not done** | — | Potentially the largest gain: decode is about 35% of the end-to-end time, and building JS objects is the cost Yuku avoids by running analysis in wasm (`ffi/wasm.zig:63-74`) | If the main consumer is Markless's style scoping, a Zig `scope(source, hash) -> string` export would skip building the AST in JS. Owner question 1 |

Projection, not measured as a whole: (1) alone takes the end-to-end time from about 17.5 to about 14.7 µs.
(2) and (3) together are bounded above by about 2.6 µs (the 22.8% inclusive time of `add` on 11.5 µs). (4)
is bounded by about 2 to 3 µs. Doing (1) through (4) could plausibly reach about 10 to 12 µs per file. Each
change should be measured on its own, as Yuku's doctrine requires (`yuku/AGENTS.md:126`).

## 4. Measurements

All runs: Apple M5 Pro, Node 24.15.0. Timing harnesses were inline `node --input-type=module -` scripts:
warm up, then 11 to 15 rounds, reporting the median. Nothing was written into the repos except build output
under gitignored `zig-out/`, which was cleaned up. The two `bench/chart.svg` files the benches rewrite were
restored byte for byte.

**yuku-css `bun run bench`** (PATH prefixed with `~/.local/zig/zig-aarch64-macos-0.17.0`):

| parser | per file |
|---|---|
| yuku-css | 18.4 µs |
| css-tree | 69.9 µs |
| postcss | 33.7 µs |

The committed chart says 17.6 / 68.9 / 34.1 µs. The rebuilt wasm is byte-identical to a manual `mvp` ReleaseFast build.

**yuku-tsrx-arshad `bun run bench`:** yuku-tsrx 5.7 µs, @tsrx/core 47.0 µs per file. The committed chart says 6.2 / 55.6. The corpus averages 332 B and 44.5 nodes per file, so per-file numbers are **not** comparable with yuku-css (2,383 B, about 250 nodes per file).

**yuku-css phase breakdown** (corpus: 252 files, 600,662 B, 63,145 nodes, 9.51 B per node; 17 files contain non-ASCII):

| phase | µs per file |
|---|---|
| full `parse(s).stylesheet` | 16.93 |
| `alloc` + `encodeInto` + `free` only | 1.17 |
| wasm `parse` (parse + serialize, includes encode) | 10.64 |
| JS decode (difference) | about 6.3 |

**Decoder prototype** (identical streams copied out of wasm; output checked with `JSON.stringify` equality on all 252 files):

| decoder | µs per file (two rounds) |
|---|---|
| current generic `src/decode.ts` | 6.46, 6.33 |
| generated literal-per-tag | 3.66, 3.53 |

**CPU profile of wasm parse + serialize.** Unstripped build: `zig build-exe src/wasm.zig -target wasm32-freestanding -mcpu=mvp -OReleaseFast -fno-entry -rdynamic`. Run with `node --cpu-prof --cpu-prof-interval 50`, 1,500 passes over the corpus. Self time: `transfer.Writer.node` 16.5%, `Parser.add` 14.8%, `Parser.parseBlock` 13.9%, `encodeInto` 10.7%, `wasm.parse` 10.6%, `memcpyFast` 10.3%, `parseSelectorList` 7.3%, `identEnd` 6.0%, `skipComponent` 2.6%, `matchBlock` 2.4%, `listFrom` 1.3%. Inclusive: `Parser.add` 22.8%, `parseBlock` 38.1%, `parseSelectorList` 19.0%, `Writer.node` 16.6%. `memcpy` callers: `Parser.add` 7.5%, `listFrom` 1.0%, `parseSelectorList` 0.9%. ReleaseFast inlining folds some functions into callers, for example `serialize` into `wasm.parse`.

**Build-flag variants** (wasm parse + serialize only; same source; second-round numbers; 600 KB = the corpus joined into one file):

| `-mcpu` / `-O` | size | µs per file | one 600 KB file |
|---|---|---|---|
| mvp / ReleaseFast (shipped) | 39,464 B | 10.99 | 2,840 µs (211 MB/s) |
| mvp+bulk_memory / ReleaseFast | 39,192 B | 10.67 | 2,723 µs |
| generic / ReleaseFast | 39,391 B | 10.30 | 2,651 µs |
| mvp+simd128+bulk_memory / ReleaseFast | 39,128 B | 10.52 | 2,691 µs |
| lime1 / ReleaseFast | 39,391 B | 10.55 | 2,724 µs |
| mvp / ReleaseSmall | 23,285 B | 29.19 | 7,662 µs |

**Fixed cost per call** (tiny input, 200k iterations, median): yuku-css `"a{}"` 0.53 µs; yuku `"a"` 1.20 µs; yuku-tsrx `"a"` 1.29 µs.

**Cost per node, for comparison with Yuku:**

| | wasm ns per node (excluding encode) | JS decode ns per node |
|---|---|---|
| yuku-css corpus | about 37.8 | about 25 (generated prototype about 14) |
| yuku-tsrx corpus (via raw exports, flags module + tsx + dialect) | 51.3 | 113.4 (small files: Yuku's decode builds about 20 closures and copies the buffer on every call) |
| yuku on `typescript.js` (9.14 MB, 1,006,344 nodes, 9.09 B per node) | 38.1 (238 MB/s) | 38.8 |

A 600 KB prefix slice of `typescript.js` was also measured. It was discarded: the cut leaves recovered nodes
unreachable from the root, so its decode time is meaningless.

Takeaway: per node, yuku-css's wasm side costs about what Yuku's does, even though Yuku parses a much harder
grammar. Per byte, yuku-css (211 MB/s) is below Yuku (238 MB/s) while leaving declaration values as raw,
unscanned text. That is the headroom items 2 to 5 target.

## 5. Open questions

1. **What does the consumer need?** If Markless only rewrites selectors for scoping, a Zig export that returns the scoped CSS string (item 18) may beat any decoder work. If consumers walk the whole tree, items 1 to 4 are the path. This is an owner decision.
2. **Should yuku-css require wasm `simd128` or `bulk_memory`?** Yuku ships `mvp`, presumably for the widest runtime support (it claims Node ≥ 14.18). yuku-css claims Node ≥ 18, where SIMD is on by default in V8. The minimum workerd, Deno and Safari versions were not checked here.
3. **Does scalarized `@Vector` code on `mvp` help or hurt?** Yuku's lexer uses `@Vector(16, u8)` in its `mvp` wasm. Without a wasm disassembler (none installed), I could not inspect the lowering, and Yuku's wasm was not rebuilt with `simd128` for an A/B comparison. Measure before porting SIMD to yuku-css.
4. **Does the 22.8% in `Parser.add` split mainly into growth copies or struct copies?** Separating them needs a source-level experiment (preallocation alone, then the compact node alone), which this read-only pass did not run.
5. **Should yuku-css share Yuku's runtime?** yuku-tsrx reuses Yuku's JS package and passes its own wasm. yuku-css is standalone. Compiling yuku-css into the TSRX dialect wasm, to parse `<style>` bodies in the same call (`yuku-tsrx-arshad/src/tsrx.zig:635-660` keeps them raw), would save one boundary crossing per style block. That needs a design decision.
6. **Can Yuku's published benchmark numbers be checked?** No numbers exist in the repo. `docs/content/index.smd:67-87` only links charts in the external repos `ecmascript-parser-benchmark-native` and `ecmascript-parser-benchmark-js`, which were not available locally.
