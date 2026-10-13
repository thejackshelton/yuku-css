# Where parse time goes, beside Yuku

Measured 2026-10-13 on an Apple M5 Pro, Node.js 24.15.0, Bun 1.3.14, Chromium 156.0.8078.4
(Playwright, headless), Zig 0.17.0, on branch `perf/match-yuku` over main fe55c75 (values parsed
by default). Yuku is `parser/tsrx-extension-points` f8381097, parsing TypeScript 5.9.3's
`typescript.js` (9.1 MB) as `lang: "js"`. The CSS files are the bench corpus (`npm/*.css`,
`synthetic/long-selector-list.css`).

The machine carried other work during these runs (load average 4 to 10, two unrelated Node.js
processes at 100% of a core each). Every claim that compares two builds is therefore an
interleaved A/B: either the two wasm modules called in turn in one process (wasm only), or each
build in its own fresh Node.js process, 1 s warm, then the median of 25 to 30 parses, the median
of 3 to 9 such processes (full `parse()`). Single-process phase splits below are indicative only:
the JS decode is dominated by garbage collection, whose cost depends on what ran before it.

## 1. Summary

- Per AST node, yuku-css is at or below Yuku: wasm parse and serialize 30 to 37 ns against
  Yuku's 37, JS decode 15 to 34 ns against 31 (it is mostly garbage collection and varies from
  run to run), and a full `parse(...).ast` 44 to 58 ns against 71 to 83 (process-isolated,
  Node.js).
- The "45 ns per node, 220 MB/s" quoted for Yuku is `parse()` without reading `.program`: Yuku
  decodes its tree lazily, so that number is encoding plus wasm plus a buffer copy (measured
  42 ns per node, 216 MB/s). The same work in yuku-css, encoding plus wasm, is 33 to 44 ns per
  node on the large files. Measured like for like, both ways, yuku-css is at or below Yuku per
  node.
- Against css-tree doing the same work (selectors and values parsed, at-rule preludes raw):
  3.0× to 3.4× on Node.js, 1.65× to 2.2× in Chromium, 1.2× to 1.9× on Bun. With positions:
  2.5× to 3.4× on Node.js.
- Against Lightning CSS: yuku-css's `parse` is faster than Lightning CSS's native `transform`
  on every file, on every runtime, including long-selector-list.css (86 against 75 MB/s on
  Node.js, 108 against 75 on Bun). `parse` plus `yuku-css/codegen`'s `generate` still loses to
  native `transform` on long-selector-list.css (51 against 75 MB/s on Node.js), see section 6.
- `positions: true` costs 1.26× to 1.42× of positions off (it cost 1.43× to 1.75× on main). The
  remainder is the allocation and collection of css-tree's three `loc` objects per node.
- wasm memory after parsing tailwind.css: 65 MiB, from 193 MiB on main.

## 2. Phases, per node

`bench/profile.mjs`, Node.js, 41 rounds, median, values parsed (yuku-css's default). `parse` is
the wasm parse alone (`zig build profile`), `serialize` the rest of the `parse` export.

| | Yuku, typescript.js | yuku-css, tailwind.css | yuku-css, bulma.css | yuku-css, long-selector-list.css |
|---|---:|---:|---:|---:|
| source bytes per node | 9.1 | 7.7 | 11.3 | 3.8 |
| wire bytes per node | 50.0 | 34.8 | 34.9 | 35.4 |
| encode (`encodeInto`) | 3.2 ns | 3.5 ns | 7.6 ns | 2.2 ns |
| wasm parse + serialize | 36.6 ns | 29.9 ns | 36.6 ns | 32.1 ns |
| of which parse | | 27.5 ns | 30.7 ns | 30.1 ns |
| of which serialize | | 2.4 ns | 5.9 ns | 2.0 ns |
| copy out of wasm memory | 1.4 ns | none | none | none |
| JS decode | 30.8 ns | 25.6 ns | 15.1 ns | 33.7 ns |
| full `parse()`, this run | 71.2 ns | 57.2 ns | 62.4 ns | 57.1 ns |
| full `parse()`, process-isolated (section 4) | 71 to 83 ns | 51.4 ns | 57.9 ns | 44.2 ns |
| `parse()` not reading the tree (Yuku's quoted figure) | 42.1 ns | | | |

Inside the wasm, sampled with `--cpu-prof` on an unstripped build with the hot functions kept out
of line (tailwind.css, values parsed): lexing 31% (`Lexer.next` 14.6%, `nameEnd` 10.7%, numbers
and identifiers 5%), node appends 13.6%, the pull parser's token bookkeeping 16% (`track` 10.6%,
`Parser.next` 5.2%), the value parser's `sequence` 6.6%, selectors 5.5%, blocks and declarations
13%. Inside the JS decode (decode-only loop): node construction 40%, child arrays 14%, garbage
collection 40%.

## 3. Changes, each measured

Commits on `perf/match-yuku`, oldest first. A/B figures are from the commit bodies; "wasm" is the
interleaved `parse` export, "parse()" the process-isolated full parse.

| Commit | Change | Measured effect |
|---|---|---|
| 0a883b0 | `bench/profile.mjs` and `zig build profile`: per-phase split beside Yuku | tooling |
| 66067cf | Find `loc` lines with a 64-unit block index in place of a binary search per offset, and drop Zig's two-pass line table | positions: decode 60 to 40 ns per node, full parse 99 to 79 ns per node (tailwind.css, values raw) |
| cf9dd73 | Link each bracket to its partner inside the token's spare 24 bits, not css-tree's u32 balance array plus a fix-up pass | wasm −7.2% to −8.6% |
| 4b7aeb6 | Pull tokens from the lexer as the parser needs them (Yuku's design), keep css-tree's bracket pairing as a persistent stack, and skip raw values and preludes over their bytes instead of tokenizing them | wasm −4.3% to −13.0% with values raw; identical output on 720k generated inputs and both corpora |
| 1e9941d | Build each `loc` as one literal from a line table that starts the first line at the column option | positions parse() −3% to −5% |
| d1fa37e | Reserve nodes for 8 source bytes each, not 4 | wasm memory after tailwind.css 97 to 65 MiB, speed unchanged |
| 31103cd | Assertions on the pull parser's invariants, 100 columns | speed unchanged |
| 4ffde13 | Record line starts while lexing (only the tokens that can hold a line break, and the bytes a raw value skips) | positions parse() −3% to −5% |
| ec35d02 | Map node spans and source strings to UTF-16 in Zig, specialized so ASCII sources pay nothing | non-ASCII sources: Node.js −8% to −12%, Bun −15% to −20%; positions −5% to −10% |

Tried and dropped because the numbers did not back them: SWAR (8 bytes a step) identifier
scanning (+3% on tailwind.css), array-of-structs node storage (+0 to +6%), lazily decoded result
like Yuku's (+4% to +12% when the tree is read, from copying the buffer out of wasm memory),
string interning (no measurable decode gain even with ids precomputed for free), packed array
literals for short child lists (−3% to +3%), cheaper token tracking (−1%), tag-only node reads in
the selector loop (0%), and inlining `identLike` (±2%).

## 4. Before and after, same work, MB/s

Process-isolated, median of 3 processes. "main" is fe55c75. yuku-css and css-tree: selectors and
values parsed, at-rule preludes raw, no positions unless "loc". "raw": values kept raw. Lightning
CSS: `transform({ code, filename, minify: false, errorRecovery: true })`, which parses values into
typed structures and prints CSS back but returns no tree.

### Node.js 24.15.0

| File | main | yuku-css | main raw | yuku-css raw | main loc | yuku-css loc | yuku-css + generate | css-tree | css-tree loc | css-tree + generate | lightningcss | lightningcss-wasm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tailwind.css | 142 | 151 | 171 | 184 | 81 | 108 | 87 | 47 | 36 | 31 | 66 | 29 |
| bootstrap.css | 122 | 137 | 141 | 171 | 71 | 100 | 97 | 45 | 37 | 33 | 71 | 27 |
| bulma.css | 163 | 195 | 192 | 231 | 103 | 137 | 118 | 59 | 46 | 41 | 75 | 34 |
| foundation.css | 102 | 117 | 124 | 146 | 66 | 93 | 85 | 39 | 37 | 30 | 74 | 30 |
| primer.css | 187 | 191 | 223 | 252 | 129 | 150 | 123 | 57 | 44 | 38 | 76 | 33 |
| long-selector-list.css | 86 | 86 | 85 | 85 | 60 | 64 | 51 | 25 | 22 | 16 | 75 | 30 |

Per node, yuku-css (default tree): tailwind.css 51.4 ns (main 54.6), bootstrap.css 57.9 (65.2),
bulma.css 57.9 (69.2), foundation.css 52.7 (60.3), primer.css 52.3 (53.4), long-selector-list.css
44.2 (44.0). css-tree on the same tree: 150 to 192 ns per node.

### Bun 1.3.14

| File | main | yuku-css | yuku-css raw | main loc | yuku-css loc | yuku-css + generate | css-tree | css-tree loc | css-tree + generate | lightningcss | lightningcss-wasm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tailwind.css | 183 | 205 | 265 | 103 | 147 | 125 | 129 | 90 | 57 | 66 | 19 |
| bootstrap.css | 121 | 162 | 198 | 78 | 110 | 100 | 121 | 79 | 57 | 68 | 16 |
| bulma.css | 182 | 228 | 294 | 115 | 173 | 135 | 134 | 96 | 64 | 79 | 20 |
| foundation.css | 107 | 130 | 171 | 66 | 91 | 81 | 106 | 73 | 49 | 72 | 16 |
| primer.css | 214 | 231 | 285 | 161 | 179 | 134 | 124 | 100 | 57 | 70 | 18 |
| long-selector-list.css | 99 | 108 | 108 | 62 | 65 | 63 | 73 | 58 | 28 | 75 | 28 |

### Chromium 156 (headless, cross-origin isolated, median of 3 fresh pages)

| File | yuku-css | yuku-css raw | yuku-css loc | yuku-css + generate | css-tree | css-tree raw | css-tree loc | css-tree + generate | lightningcss-wasm |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| tailwind.css | 187 | 235 | 129 | 113 | 88 | 105 | 65 | 50 | 32 |
| bootstrap.css | 150 | 182 | 113 | 118 | 89 | 94 | 68 | 59 | 35 |
| bulma.css | 211 | 260 | 145 | 141 | 114 | 130 | 86 | 65 | 38 |
| foundation.css | 124 | 153 | 99 | 96 | 75 | 82 | 62 | 50 | 34 |
| primer.css | 224 | 270 | 161 | 144 | 111 | 123 | 88 | 64 | 38 |
| long-selector-list.css | 106 | 106 | 71 | 68 | 49 | 49 | 38 | 28 | 35 |

### wasm only, main against this branch (interleaved, `parse` export)

| File | values parsed | values raw |
|---|---:|---:|
| tailwind.css | 29.9 to 27.7 ns per node (−7.4%) | 34.9 to 30.0 (−14.2%) |
| bulma.css | 37.8 to 35.2 (−6.9%) | 44.7 to 38.2 (−14.4%) |
| primer.css | 34.2 to 31.7 (−7.1%) | 39.1 to 33.9 (−13.2%) |
| bootstrap.css | 36.6 to 36.7 (0%, UTF-16 mapping moved into wasm) | |
| long-selector-list.css | 25.9 to 26.5 (+2.3%) | |

## 5. Positions and memory

`positions: true` against positions off, process-isolated, Node.js:

| File | main | this branch |
|---|---:|---:|
| tailwind.css | 1.75× | 1.39× |
| bootstrap.css | 1.71× | 1.37× |
| bulma.css | 1.58× | 1.42× |
| foundation.css | 1.56× | 1.26× |
| primer.css | 1.45× | 1.27× |
| long-selector-list.css | 1.43× | 1.34× |

wasm memory after parsing, `memory.buffer.byteLength` (values parsed; with positions in brackets):
tailwind.css 193 (209) MiB on main, 65 (81) MiB now; bulma.css 49 to 17 MiB; bootstrap.css 24 to
8 MiB. The instance reset past 128 MiB already matched Yuku's `core/wasm.ts` line for line; the
drop comes from no longer building the token list and balance array (12 bytes per token) and
from reserving nodes for 8 bytes of source each instead of 4.

## 6. What is still slower, and why

1. **`parse` + `generate` against Lightning CSS's native `transform` on long-selector-list.css**
   (51 against 75 MB/s on Node.js, 63 against 75 on Bun; yuku-css wins on every other file and
   wins `parse` alone everywhere). `generate` is a JS printer: on this file it takes 9 ms of the
   21, and its profile is `print` 30%, garbage collection 29%, `token` 10%, `children` 10%,
   re-tokenizing `scan` 6%. Each output token is a JS string that is concatenated. Closing it is
   Yuku's design: a Zig printer over the wasm tree (Yuku's codegen is Zig, checked byte for byte
   against its JS printer), exposed as a `transform`-like call that never builds JS objects.
   That is a new API, an owner decision, not a tuning change.
2. **Positions cost 1.26× to 1.42×, not 1.25×.** With line lookup now at about 1 ns per node
   (a decoder that writes constant `line` and `column` values costs within 1 ns of the real one),
   what remains is allocating and collecting css-tree's three `loc` objects per node: in a
   decode-only loop the collector's share grows from 40% to 51%. A lazily built `loc` would
   change what callers observe: an own accessor needs a closure per node, which costs as much
   as the objects, and a prototype getter leaves `loc` out of `Object.keys` and
   `JSON.stringify`, so the output would no longer be css-tree's.
3. **Bun: 1.2× to 1.9× over css-tree, where Node.js gives 2.9× to 3.5×.** JavaScriptCore runs
   css-tree's JavaScript about 2.7× faster than V8 does (tailwind.css: 28 ms on Bun, 77 ms on
   Node.js), while yuku-css's wasm and decode cost about the same on both engines. On
   foundation.css, the smallest file, yuku-css is 130 against css-tree's 106 MB/s.
4. **long-selector-list.css wasm is 2.3% slower than main.** At 3.8 source bytes per node,
   almost every byte is a token the parser consumes, and the pull parser's per-token bookkeeping
   (the open-block stack, the previous token for `Raw`'s trailing whitespace) outweighs not
   storing a token list. Removing that bookkeeping entirely measured 7%; the cheaper variants
   tried measured 1%.
5. **JS decode is at V8's floor for this tree shape.** One object per node with css-tree's
   fields, and strings sliced from the source. String interning, packed array literals and
   per-node closures all measured no gain.
