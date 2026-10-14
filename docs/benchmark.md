# Benchmark

yuku-css 0.1.0 (8c419a7) against [Lightning CSS](https://lightningcss.dev) 1.33.0 and [css-tree](https://github.com/csstree/csstree) 3.2.1, whose tree it builds, with [PostCSS](https://postcss.org) for context, and in the first section against every other CSS tool with a JS API, oxc's included, on an Apple M5 Pro, 2026-10-14. Run it with `bun run bench:full`; the raw data is in [bench/results/2026-10-14.json](../bench/results/2026-10-14.json).

## Fastest?

Every CSS tool with a JS API that does one of yuku-css's tasks, each called through one adapter in [bench/adapters.ts](../bench/adapters.ts) and timed the same way as the rest of this page: a fresh process per tool, 3 runs, the median. A task is timed only on the files every tool in it reads cleanly, so the file count differs by task. Each row says exactly what one call does; **equal** marks the rows that do what the task's yuku-css row does, and every other row is context, not a like-for-like race. Per file is the sum of the files' medians over the number of files.

### oxc

oxc has a CSS parser: [oxc-css-parser](https://github.com/oxc-project/oxc-css-parser), a fork of g-plane/raffia that parses CSS, SCSS, Sass and Less into a typed Rust AST for oxfmt, oxc's formatter. As of 2026-10-14 it is on crates.io (0.0.17) but not on npm: `oxc-css`, `oxc-css-parser`, `oxc-css-parser-wasm` and `@oxc-project/css` all return 404, and the main oxc repository has no CSS parser crate, only `crates/oxc_formatter_css`, which prints this parser's AST. So from JS it reaches users two ways, both timed here: `oxfmt`'s `format`, whose native addon formats .css files with it (the addon embeds oxc-css-parser 0.0.17 and `oxc_formatter_css`; `format` still formats CSS with the Prettier and PostCSS chunks deleted from the package), and its own `wasm/` crate, unpublished, built here from revision 1c7745b with wasm-pack into the `parseStylesheet` it exports (bench/oxc/wasm, its code plus a `check` for the gate). Its AST is not css-tree's: every value and selector is typed, raffia-shaped, so the WebAssembly row is a parse to an AST but not the same tree. Its README says its benchmark compares it against other CSS parsers, but `benches/self.rs` times only itself (criterion, a fresh `Allocator` per parse, over four small fixtures in `benchmark/fixtures`, one each of CSS, SCSS, Sass and Less), and the repository publishes no numbers.

#### Native: Zig against Rust

The parsers themselves, with no JS and no WebAssembly: yuku-css's Zig built for the host by tools/native_bench.zig (ReleaseFast, `parse()`'s defaults: values and preludes parsed, no positions), and oxc-css-parser's Rust by bench/oxc/native (release, fat LTO, one codegen unit, `Syntax::Css`, a fresh `Allocator` per parse as its own `benches/self.rs` makes). Each parses each file for a second to warm up, then 31 times; a file's time is the median of those, and the median of 3 fresh processes. Parse only: yuku-css's tree stays in its arrays and oxc's in its arena, nothing is handed to JS. yuku-css's parse and serialize, the transfer buffer its WebAssembly hands to JS, is listed too. On the 17 npm and synthetic files both read cleanly; the Markless corpus is left out because a second of warmup for each of its 231 files would take too long.

The trees differ, so the node counts differ. Nodes are counted as everywhere on this page, each object with a string `type`: for yuku-css in its JS tree (`parse(source).ast`), for oxc in its serde output (bench/oxc/native counts it the same way, and it matches what the WebAssembly build hands JS). yuku-css's Zig node array, also given, has one entry per JS node. MB/s does not depend on the tree's shape. The total leaves out huge-custom-properties.css, where the work differs most: yuku-css keeps custom property values as raw text, as css-tree does by default, while oxc parses them into typed values (46 nodes against over half a million).

| File | Size | yuku-css parse | yuku-css parse and serialize | oxc-css-parser parse | oxc / yuku-css | yuku-css nodes (JS / Zig) | oxc nodes | yuku-css ns per JS node | oxc ns per node |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normalize.css | 6.0 KB | 8.5 µs (722.1 MB/s) | 8.8 µs (697.5 MB/s) | 18.9 µs (325.2 MB/s) | 2.22× | 439 / 439 | 640 | 19.4 | 29.5 |
| preflight.css | 7.6 KB | 9.2 µs (848.4 MB/s) | 10.5 µs (743.3 MB/s) | 28.7 µs (271.9 MB/s) | 3.12× | 614 / 614 | 907 | 15.0 | 31.7 |
| pure.css | 25.6 KB | 41.2 µs (636.1 MB/s) | 50.0 µs (524.1 MB/s) | 135.7 µs (193.2 MB/s) | 3.29× | 3,391 / 3,391 | 5,374 | 12.1 | 25.2 |
| github-markdown.css | 28.7 KB | 47.8 µs (614.5 MB/s) | 60.1 µs (488.8 MB/s) | 187.6 µs (156.6 MB/s) | 3.92× | 4,110 / 4,110 | 6,667 | 11.6 | 28.1 |
| animate.css | 93.1 KB | 198.9 µs (479.5 MB/s) | 239.0 µs (399.1 MB/s) | 710.7 µs (134.2 MB/s) | 3.57× | 16,688 / 16,688 | 19,422 | 11.9 | 36.6 |
| font-awesome.css | 129.5 KB | 368.4 µs (360.1 MB/s) | 423.7 µs (313.1 MB/s) | 970.5 µs (136.7 MB/s) | 2.63× | 24,112 / 24,112 | 32,133 | 15.3 | 30.2 |
| foundation.css | 164.1 KB | 333.5 µs (503.7 MB/s) | 475.8 µs (353.1 MB/s) | 1.21 ms (138.3 MB/s) | 3.64× | 27,824 / 27,824 | 42,198 | 12.0 | 28.8 |
| bootstrap.css | 274.5 KB | 496.3 µs (566.3 MB/s) | 673.0 µs (417.6 MB/s) | 1.87 ms (150.1 MB/s) | 3.77× | 35,900 / 35,900 | 55,555 | 13.8 | 33.7 |
| bootstrap.min.css | 227.3 KB | 399.5 µs (582.7 MB/s) | 591.1 µs (393.8 MB/s) | 2.01 ms (115.9 MB/s) | 5.03× | 35,893 / 35,893 | 55,547 | 11.1 | 36.2 |
| primer.css | 728.0 KB | 973.3 µs (765.9 MB/s) | 1.17 ms (639.3 MB/s) | 5.33 ms (139.9 MB/s) | 5.48× | 75,867 / 75,867 | 122,801 | 12.8 | 43.4 |
| bulma.css | 745.3 KB | 988.6 µs (772.0 MB/s) | 1.32 ms (579.7 MB/s) | 4.63 ms (164.7 MB/s) | 4.69× | 69,299 / 69,299 | 135,970 | 14.3 | 34.1 |
| tailwind.min.css | 2865.3 KB | 4.92 ms (596.3 MB/s) | 6.28 ms (467.2 MB/s) | 27.15 ms (108.1 MB/s) | 5.52× | 471,017 / 471,017 | 760,024 | 10.4 | 35.7 |
| tailwind.css | 3557.0 KB | 5.66 ms (643.0 MB/s) | 7.06 ms (516.0 MB/s) | 24.63 ms (147.9 MB/s) | 4.35× | 471,017 / 471,017 | 760,972 | 12.0 | 32.4 |
| deep-nesting.css | 393.6 KB | 1.76 ms (228.4 MB/s) | 2.09 ms (193.0 MB/s) | 5.33 ms (75.6 MB/s) | 3.02× | 144,001 / 144,001 | 196,001 | 12.3 | 27.2 |
| long-selector-list.css | 1033.0 KB | 2.98 ms (355.0 MB/s) | 3.81 ms (277.3 MB/s) | 7.21 ms (146.7 MB/s) | 2.42× | 280,007 / 280,007 | 580,007 | 10.6 | 12.4 |
| huge-custom-properties.css | 976.8 KB | 231.7 µs (4316.9 MB/s) | 257.0 µs (3891.9 MB/s) | 12.99 ms (77.0 MB/s) | 56.07× | 46 / 46 | 528,754 | 5037.0 | 24.6 |
| many-at-rules.css | 673.4 KB | 2.04 ms (337.3 MB/s) | 2.45 ms (281.5 MB/s) | 5.78 ms (119.3 MB/s) | 2.83× | 160,001 / 160,001 | 222,001 | 12.8 | 26.0 |

Over the other 16 files, 10.7 MB, yuku-css's Zig parses at 528.0 MB/s and oxc-css-parser's Rust at 128.6 MB/s: 4.11× in yuku-css's favour, and faster on every file. With its serialize to the transfer buffer added, yuku-css runs at 420.0 MB/s.

### Tokenize

yuku-css: `tokenize` returns every token's type and end offset packed into a `Uint32Array`. Ranked by time on Node.js, on the 269 files every tool below reads cleanly, 12.2 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css `tokenize` | reference | 109.0 µs | 437.3 MB/s | 88.8 µs | 536.8 MB/s | 103.5 µs | 460.5 MB/s |  |
| css-tree `tokenize` | **equal** | 218.2 µs | 218.4 MB/s | 178.4 µs | 267.0 MB/s | 157.2 µs | 303.1 MB/s | 2.00× slower |
| @csstools/css-tokenizer | not equal | 628.3 µs | 75.8 MB/s | 392.4 µs | 121.4 MB/s | 571.5 µs | 83.4 MB/s | 5.77× slower |

- **yuku-css `tokenize`**: `tokenize` returns every token's type and end offset packed into a `Uint32Array`.
- **css-tree `tokenize`**: calls back once per token with its type and offsets, counted here.
- **@csstools/css-tokenizer**: `tokenize({ css })` returns an array per token: its type, text, offsets and decoded value (number, unit, unescaped name).

Fastest: on Node.js 24.15.0, yuku-css `tokenize` (109.0 µs a file), on Bun 1.3.14, yuku-css `tokenize` (88.8 µs a file) and on Chromium 156.0.8078.4, yuku-css `tokenize` (103.5 µs a file).

### Parse to an AST, values parsed

yuku-css: `parse(source).ast` with its defaults: selectors, values and at-rule preludes parsed into css-tree's tree, start and end offsets on every node, no line and column positions. Ranked by time on Node.js, on the 241 files every tool below reads cleanly, 9.5 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js | Nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | reference | 212.0 µs | 194.9 MB/s | 165.1 µs | 250.3 MB/s | 186.0 µs | 222.2 MB/s |  | 1,430,328 |
| csso `syntax.parse` | **equal** | 862.8 µs | 47.9 MB/s | 338.3 µs | 122.2 MB/s | 469.3 µs | 88.1 MB/s | 4.07× slower | 1,430,082 |
| css-tree | **equal** | 936.7 µs | 44.1 MB/s | 343.9 µs | 120.2 MB/s | 514.7 µs | 80.3 MB/s | 4.42× slower | 1,430,328 |
| @csstools/css-parser-algorithms | not equal | 1395.7 µs | 29.6 MB/s | 603.2 µs | 68.5 MB/s | 1235.7 µs | 33.4 MB/s | 6.58× slower | 3,339,470 |
| oxc-css-parser (WebAssembly) | not equal | 8001.4 µs | 5.2 MB/s | 5373.2 µs | 7.7 MB/s | 5134.4 µs | 8.0 MB/s | 37.74× slower | 2,931,158 |

- **yuku-css**: `parse(source).ast` with its defaults: selectors, values and at-rule preludes parsed into css-tree's tree, start and end offsets on every node, no line and column positions.
- **csso `syntax.parse`**: csso's bundled css-tree 2 parser with its defaults: the same tree as css-tree, values and preludes parsed, no positions.
- **css-tree**: `parse` with values and preludes parsed and positions off: the same tree, less yuku-css's start and end offsets.
- **@csstools/css-parser-algorithms**: `parseListOfComponentValues(tokenize({ css }))`: tokens grouped into blocks and functions, with no rules, declarations or selectors.
- **oxc-css-parser (WebAssembly)**: oxc's parser for oxfmt, built from its own `wasm/` crate: parses into its typed Rust AST, values parsed, spans on every node, then converts it to JS objects with serde-wasm-bindgen. A different tree from css-tree's.

Fastest: on Node.js 24.15.0, yuku-css (212.0 µs a file), on Bun 1.3.14, yuku-css (165.1 µs a file) and on Chromium 156.0.8078.4, yuku-css (186.0 µs a file).

Files left out, as each tool reported errors on them: css-tree 23 (first, website__components__sketch__concepts__state-sketch.tsrx.0.css: 1 error, first: Colon is expected) and csso `syntax.parse` 28 (first, website__styles__brand.css: 1 error, first: Identifier is expected).

### Parse to an AST, values raw

yuku-css: `parse` with `parseValue` and `parseAtrulePrelude` off: selectors parsed, values and preludes kept as raw text, offsets, no positions. Ranked by time on Node.js, on the 240 files every tool below reads cleanly, 1.3 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js | Nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | reference | 25.8 µs | 215.8 MB/s | 21.5 µs | 259.3 MB/s | 25.0 µs | 222.8 MB/s |  | 154,314 |
| stylis `compile` | not equal | 56.7 µs | 98.2 MB/s | 62.3 µs | 89.3 MB/s | 53.3 µs | 104.5 MB/s | 2.20× slower | – |
| postcss | not equal | 68.4 µs | 81.4 MB/s | 89.6 µs | 62.1 MB/s | 60.0 µs | 92.8 MB/s | 2.65× slower | 44,710 |
| css-tree | **equal** | 110.6 µs | 50.3 MB/s | 36.0 µs | 154.9 MB/s | 62.8 µs | 88.7 MB/s | 4.29× slower | 154,314 |
| @adobe/css-tools | not equal | 5200.5 µs | 1.1 MB/s | 5073.2 µs | 1.1 MB/s | 5074.6 µs | 1.1 MB/s | 201.59× slower | 240 |

- **yuku-css**: `parse` with `parseValue` and `parseAtrulePrelude` off: selectors parsed, values and preludes kept as raw text, offsets, no positions.
- **stylis `compile`**: `compile`: a flat tree of rules and declarations with nesting resolved into full selectors, values as strings, no positions.
- **postcss**: `parse`: rules, at-rules and declarations, with selectors, values and preludes kept as strings and a line and column on every node.
- **css-tree**: `parse` with values and preludes raw and positions off: the same tree, less the offsets.
- **@adobe/css-tools**: `parse`: rules and declarations, selectors split at commas into strings, values as strings, a line and column on every node.

@adobe/css-tools took over a second to read one file once, so the files from that size up are left out of this task for every tool, which is why it covers 1.3 MB. The larger files are compared in the sections below.

Fastest: on Node.js 24.15.0, yuku-css (25.8 µs a file), on Bun 1.3.14, yuku-css (21.5 µs a file) and on Chromium 156.0.8078.4, yuku-css (25.0 µs a file).

Files left out, as each tool reported errors on them: css-tree 21 (first, website__components__sketch__concepts__state-sketch.tsrx.0.css: 1 error, first: Colon is expected) and @adobe/css-tools 8 (first, deep-nesting.css: took 1.3 s to read once, over the 1 s limit).

### Parse and print

yuku-css: `transform` parses, values and preludes included, and prints CSS back compactly in one WebAssembly call. Ranked by time on Node.js, on the 236 files every tool below reads cleanly, 1.1 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css `transform` | reference | 22.6 µs | 216.0 MB/s | 17.3 µs | 282.8 MB/s | 20.6 µs | 237.8 MB/s |  |
| yuku-css `parse` and `generate` | **equal** | 46.2 µs | 105.8 MB/s | 44.2 µs | 110.6 MB/s | 42.8 µs | 114.2 MB/s | 2.04× slower |
| stylis `compile` and `serialize` | not equal | 54.8 µs | 89.2 MB/s | 62.8 µs | 77.8 MB/s | 40.2 µs | 121.5 MB/s | 2.42× slower |
| Lightning CSS (native) | not equal | 63.4 µs | 77.1 MB/s | 59.4 µs | 82.3 MB/s | – | – | 2.80× slower |
| postcss `parse` and `toString` | not equal | 77.5 µs | 63.0 MB/s | 106.7 µs | 45.8 MB/s | 65.2 µs | 74.9 MB/s | 3.43× slower |
| css-tree `parse` and `generate` | **equal** | 143.6 µs | 34.0 MB/s | 76.3 µs | 64.1 MB/s | 87.0 µs | 56.1 MB/s | 6.35× slower |
| @swc/css | not equal | 240.5 µs | 20.3 MB/s | 237.2 µs | 20.6 MB/s | – | – | 10.63× slower |
| esbuild | not equal | 264.0 µs | 18.5 MB/s | 262.0 µs | 18.6 MB/s | 5807.5 µs | 0.8 MB/s | 11.67× slower |
| @adobe/css-tools `parse` and `stringify` | not equal | 4716.3 µs | 1.0 MB/s | 4594.2 µs | 1.1 MB/s | 4606.4 µs | 1.1 MB/s | 208.45× slower |
| Lightning CSS (WebAssembly) | not equal | – | – | – | – | 149.1 µs | 32.8 MB/s |  |
| Bun `Bun.build` | not equal | – | – | 305.6 µs | 16.0 MB/s | – | – |  |

- **yuku-css `transform`**: `transform` parses, values and preludes included, and prints CSS back compactly in one WebAssembly call.
- **yuku-css `parse` and `generate`**: `parse(source).ast` then `generate` from `yuku-css/codegen`: the same output as `transform`, through a tree built in JS.
- **stylis `compile` and `serialize`**: `serialize(compile(source), stringify)`: nesting resolved into full selectors, values as strings, printed compactly, no vendor prefixes.
- **Lightning CSS (native)**: `transform({ minify: false })`: parses every value into typed Rust structures and pretty-prints them, no targets.
- **postcss `parse` and `toString`**: `parse(source).toString()`: selectors, values and preludes kept as strings, and the source printed back with its own whitespace.
- **css-tree `parse` and `generate`**: `parse` with values and preludes parsed and positions off, then `generate`: the same tree and the same compact output.
- **@swc/css**: `transformSync` with no options: parses into swc's typed AST, lowers nesting into flat rules, and pretty-prints.
- **esbuild**: `transformSync(source, { loader: "css" })` (in Chromium `esbuild-wasm`'s async `transform`): parses into esbuild's own AST and pretty-prints it, no minifying; nesting is kept, as the default target is esnext.
- **@adobe/css-tools `parse` and `stringify`**: `stringify(parse(source))`: values as strings, pretty-printed.
- **Lightning CSS (WebAssembly)**: the same `transform` from `lightningcss-wasm`.
- **Bun `Bun.build`**: `Bun.build` of one in-memory .css entry, no minifying: Bun's bundler parses with its CSS parser (ported from Lightning CSS) and pretty-prints the bundle, every import and `url()` left external; an async call.

@adobe/css-tools `parse` and `stringify` took over a second to read one file once, so the files from that size up are left out of this task for every tool, which is why it covers 1.1 MB. The larger files are compared in the sections below.

Fastest: on Node.js 24.15.0, yuku-css `transform` (22.6 µs a file), on Bun 1.3.14, yuku-css `transform` (17.3 µs a file) and on Chromium 156.0.8078.4, yuku-css `transform` (20.6 µs a file).

Files left out, as each tool reported errors on them: css-tree `parse` and `generate` 23 (first, website__components__sketch__concepts__state-sketch.tsrx.0.css: 1 error, first: Colon is expected), Lightning CSS (native) 5 (first, website__components__docs__anatomy__branch.tsrx.0.css: 1 error, first: Unknown at rule: @anatomy-tree-selection), Lightning CSS (WebAssembly) 5 (first, website__components__docs__anatomy__branch.tsrx.0.css: 1 error, first: Unknown at rule: @anatomy-tree-selection), Bun `Bun.build` 2 (first, foundation.css: 1 error, first: Invalid media query), @swc/css 21 (first, website__components__sketch__concepts__state-sketch.tsrx.0.css: 1 error, first: Expected ":") and @adobe/css-tools `parse` and `stringify` 8 (first, deep-nesting.css: took 1.4 s to read once, over the 1 s limit).

### Format

yuku-css: no formatter; its `transform`, which prints compactly, is listed for scale only. Ranked by time on Node.js, on the 252 Markless files every tool below reads cleanly, 0.6 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css `transform` | for scale | 10.1 µs | 234.9 MB/s | 7.8 µs | 306.6 MB/s | 9.3 µs | 256.8 MB/s |  |
| oxfmt | not equal | 68.8 µs | 34.6 MB/s | 70.1 µs | 34.0 MB/s | – | – | 6.78× slower |
| Biome | not equal | 359.8 µs | 6.6 MB/s | 241.4 µs | 9.9 MB/s | 298.3 µs | 8.0 MB/s | 35.46× slower |
| Prettier | not equal | 1482.5 µs | 1.6 MB/s | 1418.2 µs | 1.7 MB/s | 1129.5 µs | 2.1 MB/s | 146.09× slower |

- **yuku-css `transform`**: not a formatter: parses and prints compactly, for scale.
- **oxfmt**: `format("bench.css", source)`: oxc's native formatter parses with oxc-css-parser and pretty-prints with Prettier's style; an async call that runs off the main thread.
- **Biome**: `formatContent(project, source, { filePath: "bench.css" })` from `@biomejs/js-api`, Biome's WebAssembly build: parses into its lossless syntax tree and pretty-prints.
- **Prettier**: `format(source, { parser: "css" })`: parses with postcss and its value parsers, then pretty-prints; an async call.

Fastest, leaving out yuku-css's row, which does not do this task: on Node.js 24.15.0, oxfmt (68.8 µs a file), on Bun 1.3.14, oxfmt (70.1 µs a file) and on Chromium 156.0.8078.4, Biome (298.3 µs a file).

### Minify

yuku-css: no minifier; its `transform`, which prints compactly but drops nothing, is listed for scale only. Ranked by time on Node.js, on the 237 files every tool below reads cleanly, 9.3 MB.

| Tool | Equal work | Node.js 24.15.0, per file | MB/s | Bun 1.3.14, per file | MB/s | Chromium 156.0.8078.4, per file | MB/s | vs yuku-css on Node.js |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css `transform` | for scale | 162.7 µs | 253.7 MB/s | 127.4 µs | 324.0 MB/s | 139.4 µs | 296.1 MB/s |  |
| Lightning CSS (native) | not equal | 617.7 µs | 66.8 MB/s | 607.4 µs | 67.9 MB/s | – | – | 3.80× slower |
| clean-css | not equal | 3325.7 µs | 12.4 MB/s | 5770.6 µs | 7.2 MB/s | – | – | 20.44× slower |
| esbuild | not equal | 9186.6 µs | 4.5 MB/s | 9424.3 µs | 4.4 MB/s | 31950.3 µs | 1.3 MB/s | 56.47× slower |
| csso | not equal | 9606.1 µs | 4.3 MB/s | 6949.7 µs | 5.9 MB/s | 6772.7 µs | 6.1 MB/s | 59.05× slower |
| Lightning CSS (WebAssembly) | not equal | – | – | – | – | 1329.3 µs | 31.0 MB/s |  |
| Bun `Bun.build` | not equal | – | – | 916.6 µs | 45.0 MB/s | – | – |  |

- **yuku-css `transform`**: not a minifier: parses and prints compactly, dropping nothing, for scale.
- **Lightning CSS (native)**: `transform({ minify: true })`, no targets.
- **clean-css**: `new CleanCSS().minify(source)` at its default level 1, imports not inlined.
- **esbuild**: `transformSync(source, { loader: "css", minify: true })` (in Chromium `esbuild-wasm`'s async `transform`).
- **csso**: `minify(source)`: parses with its bundled css-tree 2, restructures and merges rules, and prints.
- **Lightning CSS (WebAssembly)**: the same `transform({ minify: true })` from `lightningcss-wasm`.
- **Bun `Bun.build`**: `Bun.build` of one in-memory .css entry with `minify: true`; an async call.

Fastest, leaving out yuku-css's row, which does not do this task: on Node.js 24.15.0, Lightning CSS (native) (617.7 µs a file), on Bun 1.3.14, Lightning CSS (native) (607.4 µs a file) and on Chromium 156.0.8078.4, Lightning CSS (WebAssembly) (1329.3 µs a file).

Files left out, as each tool reported errors on them: Lightning CSS (native) 5 (first, website__components__docs__anatomy__branch.tsrx.0.css: 1 error, first: Unknown at rule: @anatomy-tree-selection), Lightning CSS (WebAssembly) 5 (first, website__components__docs__anatomy__branch.tsrx.0.css: 1 error, first: Unknown at rule: @anatomy-tree-selection), Bun `Bun.build` 2 (first, foundation.css: 1 error, first: Invalid media query), csso 28 (first, website__styles__brand.css: 1 error, first: Identifier is expected) and clean-css 25 (first, packages__vitest-browser__browser__fixtures__scoped-style.tsrx.0.css: 3 errors, first: Unexpected '}' at 6:72.).

### Validate

No other JS tool matches every declaration against the CSS grammar except css-tree, so this is the Validating section's race: yuku-css's `matchStylesheet` against css-tree parsing and calling `matchDeclaration` on each declaration, on 246 files, measured on Node.js and Bun only.

| Validator | Node.js 24.15.0, per file | Bun 1.3.14, per file |
| --- | ---: | ---: |
| yuku-css | 165.5 µs | 130.8 µs |
| yuku-css unread | 133.8 µs | 103.1 µs |
| css-tree | 3576.2 µs | 875.0 µs |

### Where another tool beats yuku-css

- On no task's total in these runs.

These are totals over each task's files. Single files, calls on near-empty input, a cold start, memory and download size are where yuku-css does lose, and the Summary and the Lightning CSS section below list each case.

Not added: Rolldown, Vite and Rspack hand CSS to Lightning CSS, which is timed above. `@swc/css` is timed printing, though its last release, 0.0.28, is from July 2023 and it lowers nesting even with no options; its `minifySync` is not timed, because it panics on any math function (`.a{width:calc(1px + 2px)}` throws `cannot access a scoped thread local variable without calling set first`), which would leave out every file with `calc()`, `min()` or `max()` for every minifier. `postcss-value-parser` and `postcss-selector-parser` parse one value or selector at a time and would only matter for a PostCSS same-work row, which PostCSS's string-valued tree rules out. Bundle sizes, cold starts and memory are measured only for the libraries in the sections below.

Versions: yuku-css 0.1.0 (8c419a7), css-tree 3.2.1, @csstools/css-tokenizer 4.0.2, csso 5.0.5, oxc-css-parser 0.0.17 (1c7745b), @csstools/css-parser-algorithms 4.0.2, postcss 8.5.30, @adobe/css-tools 4.5.0, stylis 4.4.0, lightningcss 1.33.0, lightningcss-wasm 1.33.0, esbuild 0.28.2, Bun 1.3.14, @swc/css 0.0.28, oxfmt 0.73.0, @biomejs/js-api 6.0.0, prettier 3.9.10 and clean-css 5.3.3.

## Against Lightning CSS

Lightning CSS returns no tree to JS. Its `transform({ filename, code, minify: false })` parses every value into typed Rust structures and prints CSS back. yuku-css's `transform` does the same in kind: one WebAssembly call parses, values and at-rule preludes included, and prints CSS back, with no tree built in JS. The work still differs: Lightning CSS types every value, where yuku-css splits values and preludes into css-tree's untyped nodes, and Lightning CSS pretty-prints, where yuku-css prints compactly, as css-tree's `generate` does. yuku-css parsing with `parse` and printing with `generate` from `yuku-css/codegen`, which builds the JS tree in between, and parsing alone are listed too. Lightning CSS runs as its native Node.js addon and as `lightningcss-wasm`; in Chromium only the WebAssembly runs.

### By size

Throughput on the 264 files that yuku-css and both builds of Lightning CSS parse cleanly. The last column sets yuku-css's `transform` against Lightning CSS's addon, or in Chromium its WebAssembly.

| Runtime | Size | Files | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css `transform` vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 129 | 202.3 MB/s | 100.0 MB/s | 147.0 MB/s | 54.5 MB/s | 20.8 MB/s | 3.71× faster |
| Node.js 24.15.0 | 1–10 KB | 117 | 221.4 MB/s | 108.5 MB/s | 169.5 MB/s | 69.7 MB/s | 13.0 MB/s | 3.18× faster |
| Node.js 24.15.0 | 10–100 KB | 7 | 220.7 MB/s | 106.8 MB/s | 176.0 MB/s | 88.8 MB/s | 4.8 MB/s | 2.49× faster |
| Node.js 24.15.0 | 100 KB–1 MB | 8 | 229.6 MB/s | 93.8 MB/s | 203.4 MB/s | 53.6 MB/s | 21.7 MB/s | 4.28× faster |
| Node.js 24.15.0 | > 1 MB | 3 | 247.0 MB/s | 106.5 MB/s | 170.0 MB/s | 67.9 MB/s | 27.5 MB/s | 3.64× faster |
| Bun 1.3.14 | < 1 KB | 129 | 260.5 MB/s | 106.5 MB/s | 174.1 MB/s | 63.8 MB/s | 16.3 MB/s | 4.08× faster |
| Bun 1.3.14 | 1–10 KB | 117 | 286.2 MB/s | 106.7 MB/s | 189.3 MB/s | 73.7 MB/s | 16.9 MB/s | 3.88× faster |
| Bun 1.3.14 | 10–100 KB | 7 | 279.0 MB/s | 107.1 MB/s | 193.5 MB/s | 93.3 MB/s | 22.2 MB/s | 2.99× faster |
| Bun 1.3.14 | 100 KB–1 MB | 8 | 289.1 MB/s | 111.6 MB/s | 237.1 MB/s | 55.6 MB/s | 14.4 MB/s | 5.20× faster |
| Bun 1.3.14 | > 1 MB | 3 | 318.5 MB/s | 120.7 MB/s | 226.2 MB/s | 69.8 MB/s | 18.0 MB/s | 4.56× faster |
| Chromium 156.0.8078.4 | < 1 KB | 129 | 212.5 MB/s | 109.8 MB/s | 151.0 MB/s | – | 23.1 MB/s | 9.21× faster |
| Chromium 156.0.8078.4 | 1–10 KB | 117 | 245.1 MB/s | 121.1 MB/s | 176.5 MB/s | – | 27.0 MB/s | 9.07× faster |
| Chromium 156.0.8078.4 | 10–100 KB | 7 | 249.7 MB/s | 121.4 MB/s | 186.3 MB/s | – | 35.3 MB/s | 7.07× faster |
| Chromium 156.0.8078.4 | 100 KB–1 MB | 8 | 258.7 MB/s | 109.8 MB/s | 220.6 MB/s | – | 28.1 MB/s | 9.21× faster |
| Chromium 156.0.8078.4 | > 1 MB | 3 | 292.8 MB/s | 100.1 MB/s | 210.6 MB/s | – | 33.3 MB/s | 8.80× faster |

![Throughput by file size against Lightning CSS on Node.js 24.15.0](benchmark/lightning.svg)

### Large real files

Median time per parse, MB/s in parentheses. A dash marks a parse that reported errors, with the first error below.

| File | Size | Runtime | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css `transform` vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tailwind.css | 3557.0 KB | Node.js 24.15.0 | 12.99 ms (280.4 MB/s) | 26.94 ms (135.2 MB/s) | 17.68 ms (206.1 MB/s) | 50.53 ms (72.1 MB/s) | 123.19 ms (29.6 MB/s) | 3.89× faster |
| tailwind.css | 3557.0 KB | Bun 1.3.14 | 10.06 ms (362.2 MB/s) | 25.24 ms (144.3 MB/s) | 13.97 ms (260.7 MB/s) | 49.17 ms (74.1 MB/s) | 176.97 ms (20.6 MB/s) | 4.89× faster |
| tailwind.css | 3557.0 KB | Chromium 156.0.8078.4 | 11.20 ms (325.4 MB/s) | 31.86 ms (114.3 MB/s) | 14.98 ms (243.2 MB/s) | – | 104.33 ms (34.9 MB/s) | 9.32× faster |
| tailwind.min.css | 2865.3 KB | Node.js 24.15.0 | 11.73 ms (250.1 MB/s) | 25.74 ms (114.0 MB/s) | 16.32 ms (179.8 MB/s) | 49.04 ms (59.8 MB/s) | 123.15 ms (23.8 MB/s) | 4.18× faster |
| tailwind.min.css | 2865.3 KB | Bun 1.3.14 | 8.96 ms (327.3 MB/s) | 23.77 ms (123.5 MB/s) | 12.68 ms (231.5 MB/s) | 47.33 ms (62.0 MB/s) | 163.44 ms (18.0 MB/s) | 5.28× faster |
| tailwind.min.css | 2865.3 KB | Chromium 156.0.8078.4 | 10.05 ms (291.9 MB/s) | 30.58 ms (95.9 MB/s) | 14.00 ms (209.6 MB/s) | – | 97.11 ms (30.2 MB/s) | 9.66× faster |
| bulma.css | 745.3 KB | Node.js 24.15.0 | 2.81 ms (271.1 MB/s) | 5.53 ms (138.0 MB/s) | 3.21 ms (237.9 MB/s) | 9.30 ms (82.0 MB/s) | 20.84 ms (36.6 MB/s) | 3.31× faster |
| bulma.css | 745.3 KB | Bun 1.3.14 | 2.04 ms (374.1 MB/s) | 4.84 ms (157.8 MB/s) | 2.53 ms (301.2 MB/s) | 8.53 ms (89.4 MB/s) | 30.23 ms (25.2 MB/s) | 4.18× faster |
| bulma.css | 745.3 KB | Chromium 156.0.8078.4 | 2.73 ms (279.8 MB/s) | 4.95 ms (154.3 MB/s) | 3.04 ms (251.3 MB/s) | – | 18.08 ms (42.2 MB/s) | 6.63× faster |
| primer.css | 728.0 KB | Node.js 24.15.0 | 2.52 ms (296.3 MB/s) | 4.98 ms (149.7 MB/s) | 2.89 ms (258.2 MB/s) | – | – | – |
| primer.css | 728.0 KB | Bun 1.3.14 | 1.94 ms (383.3 MB/s) | 4.81 ms (155.1 MB/s) | 2.50 ms (298.6 MB/s) | – | – | – |
| primer.css | 728.0 KB | Chromium 156.0.8078.4 | 2.22 ms (335.4 MB/s) | 4.33 ms (172.3 MB/s) | 2.64 ms (282.4 MB/s) | – | – | – |
| bootstrap.css | 274.5 KB | Node.js 24.15.0 | 1.24 ms (226.4 MB/s) | 2.50 ms (112.6 MB/s) | 1.62 ms (173.2 MB/s) | 3.50 ms (80.4 MB/s) | 8.23 ms (34.2 MB/s) | 2.82× faster |
| bootstrap.css | 274.5 KB | Bun 1.3.14 | 919.9 µs (305.5 MB/s) | 2.30 ms (122.2 MB/s) | 1.36 ms (207.3 MB/s) | 3.29 ms (85.4 MB/s) | 12.29 ms (22.9 MB/s) | 3.58× faster |
| bootstrap.css | 274.5 KB | Chromium 156.0.8078.4 | 1.15 ms (244.9 MB/s) | 2.22 ms (126.6 MB/s) | 1.55 ms (181.0 MB/s) | – | 6.91 ms (40.7 MB/s) | 6.02× faster |
| bootstrap.min.css | 227.3 KB | Node.js 24.15.0 | 1.09 ms (213.3 MB/s) | 2.34 ms (99.7 MB/s) | 1.47 ms (158.5 MB/s) | 3.35 ms (69.5 MB/s) | 7.89 ms (29.5 MB/s) | 3.07× faster |
| bootstrap.min.css | 227.3 KB | Bun 1.3.14 | 817.0 µs (284.9 MB/s) | 2.24 ms (103.8 MB/s) | 1.28 ms (181.5 MB/s) | 3.17 ms (73.4 MB/s) | 11.75 ms (19.8 MB/s) | 3.88× faster |
| bootstrap.min.css | 227.3 KB | Chromium 156.0.8078.4 | 1.00 ms (232.8 MB/s) | 2.08 ms (112.1 MB/s) | 1.43 ms (162.2 MB/s) | – | 6.54 ms (35.6 MB/s) | 6.54× faster |
| foundation.css | 164.1 KB | Node.js 24.15.0 | 845.5 µs (198.7 MB/s) | 1.76 ms (95.3 MB/s) | 1.16 ms (144.6 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Bun 1.3.14 | 626.5 µs (268.1 MB/s) | 1.71 ms (98.1 MB/s) | 1.16 ms (145.4 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Chromium 156.0.8078.4 | 772.5 µs (217.5 MB/s) | 1.61 ms (104.3 MB/s) | 1.13 ms (149.0 MB/s) | – | – | – |
| font-awesome.css | 129.5 KB | Node.js 24.15.0 | 812.6 µs (163.3 MB/s) | 1.66 ms (80.1 MB/s) | 1.09 ms (121.5 MB/s) | 1.82 ms (73.0 MB/s) | 4.60 ms (28.8 MB/s) | 2.24× faster |
| font-awesome.css | 129.5 KB | Bun 1.3.14 | 649.0 µs (204.4 MB/s) | 1.51 ms (87.7 MB/s) | 1.02 ms (130.1 MB/s) | 1.78 ms (74.4 MB/s) | 7.72 ms (17.2 MB/s) | 2.75× faster |
| font-awesome.css | 129.5 KB | Chromium 156.0.8078.4 | 695.0 µs (190.9 MB/s) | 1.52 ms (87.1 MB/s) | 1.07 ms (123.4 MB/s) | – | 3.91 ms (33.9 MB/s) | 5.62× faster |

Lightning CSS reports errors on primer.css (6 errors, first: Unknown at rule: @custom-media) and foundation.css (1 error, first: Invalid media query).

### Per call

What one call costs when there is next to nothing to parse, so a lead on small files is not read as a lead in throughput. Median time per call.

| File | Runtime | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | yuku-css, positions | css-tree, positions | lightningcss | lightningcss-wasm | postcss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty.css (0 B) | Node.js 24.15.0 | 0.3 µs | 0.7 µs | 0.6 µs | 0.7 µs | 0.4 µs | 1.6 µs | 2.8 µs | 0.2 µs |
| empty.css (0 B) | Bun 1.3.14 | 0.2 µs | 0.4 µs | 0.4 µs | 0.6 µs | 0.6 µs | 1.0 µs | 3.1 µs | 0.1 µs |
| empty.css (0 B) | Chromium 156.0.8078.4 | 0.4 µs | 0.6 µs | 0.6 µs | 0.7 µs | 0.4 µs | – | 3.2 µs | 0.1 µs |
| tiny.css (18 B) | Node.js 24.15.0 | 0.5 µs | 1.0 µs | 0.8 µs | 1.0 µs | 1.4 µs | 2.3 µs | 5.3 µs | 0.6 µs |
| tiny.css (18 B) | Bun 1.3.14 | 0.4 µs | 0.8 µs | 0.6 µs | 0.8 µs | 0.9 µs | 1.6 µs | 6.3 µs | 0.6 µs |
| tiny.css (18 B) | Chromium 156.0.8078.4 | 0.5 µs | 1.0 µs | 0.8 µs | 0.9 µs | 0.9 µs | – | 5.3 µs | 0.5 µs |

On Node.js 24.15.0, a call on an empty file costs yuku-css's `transform` 0.3 µs and the Lightning CSS addon 1.6 µs, so on the smallest files part of yuku-css's lead is the cost of a call.

### Where yuku-css wins

- On Node.js 24.15.0, `transform` beats the addon on every size of file, by 2.49× to 4.28×.
- On Bun 1.3.14, `transform` beats the addon on every size of file, by 2.99× to 5.20×.
- On Chromium 156.0.8078.4, `transform` beats `lightningcss-wasm` on every size of file, by 7.07× to 9.21×.
- A browser downloads 57.1 KB gzipped to transform with yuku-css, against 3670.3 KB for `lightningcss-wasm`.

### Where yuku-css loses

- In a fresh Node.js 24.15.0 process, loading the library and transforming bootstrap.css once takes yuku-css 8.76 ms, compiling its WebAssembly included, and the Lightning CSS addon 6.71 ms.
- Lightning CSS does more with the time: it types every value, so it can minify, lower syntax for older browsers and report invalid values, none of which yuku-css does. Its output is a normalized style sheet, where yuku-css prints its tree as written.

## Summary

On 228 Markless style sheets, yuku-css parses a file in 12.2 µs on Node.js 24.15.0, 3.38× faster than css-tree building the same tree: selectors, values and at-rule preludes parsed, positions on; 1.39× on Bun 1.3.14, and 2.03× in Chromium. Over all 246 files both parse cleanly, 10.6 MB of CSS, it reads 88.4 MB/s against css-tree's 29.6 MB/s; the lead is widest on files of 100 KB–1 MB (5.04×) and narrowest on > 1 MB (2.63×). css-tree's defaults, which give no positions, take 3.06× as long, and Lightning CSS's native addon, which parses values into typed structures and prints CSS back, 1.87×. Printing css-tree's own tree back to CSS, `yuku-css/codegen` takes 199.1 µs a file against css-tree's 485.1 µs (2.44×), and with a source map 437.3 µs against 1259.9 µs (2.88×). Validating every declaration of a file with `yuku-css/lexer`'s `matchStylesheet` takes 17.4 µs on the Markless corpus against 145.0 µs for css-tree parsing it and calling `matchDeclaration` on each declaration (8.32×). Its `tokenize` takes 107.4 µs a file against css-tree's 210.3 µs (1.96×). Where yuku-css loses: on long-selector-list.css on Node.js 24.15.0, lightningcss (1.64×) and postcss (1.37×) parse faster; on empty.css on Node.js 24.15.0, css-tree, same work (1.61×), css-tree, defaults (1.59×) and postcss (4.27×) parse faster; on tiny.css on Node.js 24.15.0, postcss (1.62×) parse faster; on normalize.css on Bun 1.3.14, css-tree, defaults (1.19×) parse faster; on preflight.css on Bun 1.3.14, css-tree, defaults (1.11×) parse faster; on pure.css on Bun 1.3.14, css-tree, defaults (1.07×) parse faster; on font-awesome.css on Bun 1.3.14, css-tree, defaults (1.11×) parse faster; on foundation.css on Bun 1.3.14, css-tree, defaults (1.04×) parse faster; on empty.css on Bun 1.3.14, postcss (4.51×) parse faster; on tiny.css on Bun 1.3.14, postcss (1.32×) parse faster; it holds more memory outside the JS heap: after parsing tailwind.css its WebAssembly memory has grown to 80.5 MB, and on files of 100 KB or more its peak resident memory is a median 1.32× css-tree's, though its tree retains 0.86× the JS heap css-tree's does; `css-tree` (53.2 KB), `css-tree/parser` (12.6 KB) and `postcss` (17.2 KB) download less than its 60.6 KB gzipped.

![Time per file to parse the Markless corpus on Node.js 24.15.0](benchmark/corpus.svg)

Median time per file, 228 Markless files, Node.js 24.15.0.

## Parse time

Each row says the work it does. Only rows marked the same as yuku-css build what yuku-css builds; the others are context.

### Markless corpus, 228 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 12.2 µs | 14.3 µs |  | 12.2 µs | 15.3 µs |  |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 9.4 µs | 10.8 µs |  | 8.3 µs | 9.9 µs |  |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 9.2 µs | 10.8 µs |  | 8.8 µs | 10.7 µs |  |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 7.1 µs | 8.1 µs |  | 6.0 µs | 7.2 µs |  |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 14.4 µs | 16.5 µs | 1.18× | 14.7 µs | 17.4 µs | 1.20× |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 7.1 µs | 8.1 µs | 0.58× | 5.5 µs | 6.5 µs | 0.45× |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 7.2 µs | 8.5 µs | 0.59× | 5.1 µs | 6.1 µs | 0.42× |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 41.2 µs | 46.5 µs | 3.38× | 16.9 µs | 20.3 µs | 1.39× |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 37.4 µs | 42.4 µs | 3.99× | 13.1 µs | 15.4 µs | 1.57× |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 35.2 µs | 39.7 µs | 3.80× | 13.5 µs | 16.1 µs | 1.54× |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 31.8 µs | 35.9 µs | 4.48× | 10.4 µs | 12.4 µs | 1.75× |
| lightningcss | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 22.8 µs | 27.0 µs | 1.87× | 21.2 µs | 25.3 µs | 1.74× |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 105.8 µs | 6376.3 µs | 8.68× | 91.1 µs | 347.5 µs | 7.47× |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 19.1 µs | 21.9 µs | 1.56× | 23.9 µs | 33.2 µs | 1.96× |

### All files, 242 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 513.9 µs | 713.1 µs |  | 278.4 µs | 413.9 µs |  |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 248.4 µs | 269.4 µs |  | 193.2 µs | 225.1 µs |  |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 285.1 µs | 469.0 µs |  | 231.9 µs | 330.6 µs |  |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 203.8 µs | 238.3 µs |  | 155.8 µs | 182.6 µs |  |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 432.1 µs | 470.1 µs | 0.84× | 379.4 µs | 438.4 µs | 1.36× |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 184.0 µs | 195.2 µs | 0.36× | 143.8 µs | 148.1 µs | 0.52× |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 152.5 µs | 170.6 µs | 0.30× | 113.9 µs | 123.5 µs | 0.41× |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 1532.9 µs | 1738.5 µs | 2.98× | 504.2 µs | 652.6 µs | 1.81× |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 1042.0 µs | 1085.1 µs | 4.20× | 389.2 µs | 461.4 µs | 2.01× |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 1359.0 µs | 1546.6 µs | 4.77× | 435.6 µs | 564.8 µs | 1.88× |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 997.6 µs | 1038.5 µs | 4.89× | 345.0 µs | 408.4 µs | 2.21× |
| lightningcss | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 722.1 µs | 748.2 µs | 1.41× | 700.5 µs | 739.1 µs | 2.52× |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 1992.9 µs | 8623.0 µs | 3.88× | 2737.4 µs | 3172.7 µs | 9.83× |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 866.3 µs | 1012.0 µs | 1.69× | 774.5 µs | 891.8 µs | 2.78× |

### By size

Throughput on Node.js 24.15.0, by file size, on the 246 files both yuku-css and css-tree parse cleanly, less any a context parser leaves out.

| Size | Files | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| < 1 KB | 125 | 113.2 MB/s | 38.5 MB/s | 43.7 MB/s | 53.7 MB/s | 20.6 MB/s | 86.0 MB/s | 2.94× |
| 1–10 KB | 107 | 127.9 MB/s | 37.0 MB/s | 40.8 MB/s | 69.8 MB/s | 13.9 MB/s | 79.1 MB/s | 3.46× |
| 10–100 KB | 4 | 143.2 MB/s | 38.7 MB/s | 43.7 MB/s | 100.6 MB/s | 4.2 MB/s | 89.0 MB/s | 3.70× |
| 100 KB–1 MB | 7 | 174.8 MB/s | 34.7 MB/s | 39.5 MB/s | 50.6 MB/s | 19.8 MB/s | 45.6 MB/s | 5.04× |
| > 1 MB | 3 | 72.7 MB/s | 27.6 MB/s | 45.2 MB/s | 67.9 MB/s | 27.5 MB/s | 54.3 MB/s | 2.63× |

![Throughput by file size on Node.js 24.15.0](benchmark/buckets.svg)

### Real-world CSS from npm

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normalize.css | 6.0 KB | 25.0 µs (29.8 µs) | 77.2 µs (87.5 µs) | 65.3 µs (74.9 µs) | 35.7 µs (42.0 µs) | 172.1 µs (22.81 ms) | 44.5 µs (53.4 µs) | 3.08× |
| preflight.css | 7.6 KB | 33.0 µs (39.1 µs) | 107.5 µs (121.0 µs) | 88.8 µs (98.5 µs) | 51.5 µs (61.1 µs) | 237.7 µs (22.22 ms) | 57.2 µs (65.0 µs) | 3.25× |
| pure.css | 25.6 KB | 151.3 µs (174.9 µs) | 538.1 µs (580.6 µs) | 478.2 µs (530.8 µs) | 238.9 µs (306.6 µs) | 2.18 ms (35.72 ms) | 246.0 µs (309.2 µs) | 3.56× |
| github-markdown.css | 28.7 KB | 172.2 µs (203.0 µs) | 644.3 µs (717.0 µs) | 587.8 µs (656.6 µs) | 322.0 µs (418.7 µs) | 12.13 ms (22.41 ms) | 287.4 µs (340.2 µs) | 3.74× |
| animate.css | 93.1 KB | 713.6 µs (929.7 µs) | 2.68 ms (3.58 ms) | 2.34 ms (2.70 ms) | 886.6 µs (1.04 ms) | 23.87 ms (26.83 ms) | 1.16 ms (1.34 ms) | 3.76× |
| font-awesome.css | 129.5 KB | 1.38 ms (1.71 ms) | 3.62 ms (4.13 ms) | 3.24 ms (3.53 ms) | 1.82 ms (1.94 ms) | 4.60 ms (4.69 ms) | 1.82 ms (2.19 ms) | 2.63× |
| foundation.css | 164.1 KB | 1.52 ms (1.91 ms) | 4.58 ms (4.94 ms) | 4.21 ms (4.60 ms) | – | – | 2.37 ms (2.64 ms) | 3.02× |
| bootstrap.css | 274.5 KB | 2.16 ms (2.89 ms) | 6.65 ms (7.80 ms) | 6.02 ms (7.00 ms) | 3.50 ms (3.65 ms) | 8.23 ms (8.46 ms) | 3.81 ms (4.58 ms) | 3.08× |
| bootstrap.min.css | 227.3 KB | 1.80 ms (2.66 ms) | 5.50 ms (6.97 ms) | 4.99 ms (5.36 ms) | 3.35 ms (3.46 ms) | 7.89 ms (8.00 ms) | 2.32 ms (2.90 ms) | 3.06× |
| primer.css | 728.0 KB | 3.57 ms (4.66 ms) | – | – | – | – | 6.27 ms (6.81 ms) | – |
| bulma.css | 745.3 KB | 4.12 ms (4.34 ms) | 14.16 ms (15.38 ms) | 12.29 ms (13.45 ms) | 9.30 ms (9.46 ms) | 20.84 ms (21.85 ms) | 8.51 ms (8.98 ms) | 3.44× |
| tailwind.min.css | 2865.3 KB | 40.00 ms (57.22 ms) | 95.39 ms (107.25 ms) | 56.35 ms (57.69 ms) | 49.04 ms (50.81 ms) | 123.15 ms (138.96 ms) | 52.24 ms (58.48 ms) | 2.38× |
| tailwind.css | 3557.0 KB | 43.91 ms (64.78 ms) | 108.51 ms (121.16 ms) | 67.26 ms (68.62 ms) | 50.53 ms (51.90 ms) | 123.19 ms (145.49 ms) | 72.93 ms (78.91 ms) | 2.47× |

### Synthetic stress files

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deep-nesting.css | 393.6 KB | 5.44 ms (5.75 ms) | 21.85 ms (22.58 ms) | 17.78 ms (19.16 ms) | 12.12 ms (12.45 ms) | 34.79 ms (76.34 ms) | 9.74 ms (11.99 ms) | 4.02× |
| long-selector-list.css | 1033.0 KB | 21.04 ms (27.91 ms) | 72.25 ms (89.53 ms) | 45.20 ms (46.22 ms) | 12.81 ms (13.02 ms) | 31.24 ms (32.69 ms) | 15.34 ms (26.27 ms) | 3.43× |
| huge-custom-properties.css | 976.8 KB | 645.4 µs (692.4 µs) | 29.57 ms (30.22 ms) | 26.96 ms (27.84 ms) | 25.56 ms (26.35 ms) | 65.64 ms (66.49 ms) | 36.78 ms (43.52 ms) | 45.82× |
| many-at-rules.css | 673.4 KB | 9.33 ms (9.72 ms) | – | – | 11.38 ms (11.72 ms) | 24.11 ms (25.74 ms) | 15.18 ms (15.54 ms) | – |

## Cost per node

Every tree's nodes are counted the same way: each object with a string `type`, reached through fields and lists. yuku-css builds css-tree's tree, so with the same work the counts differ only where the two read CSS differently; with values parsed, both have a node for each part of a value and prelude; PostCSS has none below a rule's selector. Lightning CSS, and yuku-css when it prints, transforms or is read for diagnostics only, return no tree. Each row covers the files it parses cleanly.

| Parser | Files | Nodes | Node.js 24.15.0, ns per node | Bun 1.3.14, ns per node | Node.js 24.15.0, MB/s | Bun 1.3.14, MB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | 269 | 1,907,105 | 73.5 | 42.1 | 91.4 MB/s | 159.5 MB/s |
| yuku-css, values and preludes parsed, no positions | 269 | 1,907,105 | 37.0 | 29.4 | 181.6 MB/s | 228.5 MB/s |
| yuku-css, values and preludes raw, positions | 269 | 1,490,909 | 52.3 | 43.6 | 164.3 MB/s | 197.2 MB/s |
| yuku-css, values and preludes raw, no positions | 269 | 1,490,909 | 37.9 | 29.6 | 226.6 MB/s | 290.6 MB/s |
| css-tree, same work | 246 | 1,645,480 | 228.5 | 75.4 | 29.6 MB/s | 89.8 MB/s |
| css-tree, defaults | 246 | 1,645,480 | 156.0 | 58.2 | 43.4 MB/s | 116.2 MB/s |
| css-tree, values and preludes raw, positions | 248 | 1,472,223 | 249.4 | 81.8 | 34.2 MB/s | 104.3 MB/s |
| css-tree, values and preludes raw, no positions | 248 | 1,472,223 | 186.0 | 64.7 | 45.9 MB/s | 131.9 MB/s |
| postcss | 269 | 336,882 | 699.5 | 644.8 | 54.4 MB/s | 59.0 MB/s |

## Where yuku-css spends its time

Its `parse` has three steps: encoding the source to UTF-8 in WebAssembly memory, parsing and serializing the tree in WebAssembly, and decoding the tree into JS objects. Each step is timed on its own (bench/yuku-phases.ts), per file, values and preludes parsed, positions, over the files yuku-css parses cleanly.

| Runtime | Size | Encode | Parse and serialize | Decode | Sum | Whole parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 0.1 µs (5%) | 1.3 µs (42%) | 1.6 µs (53%) | 3.0 µs | 3.0 µs |
| Node.js 24.15.0 | 1–10 KB | 1.3 µs (5%) | 12.0 µs (48%) | 11.7 µs (47%) | 25.0 µs | 24.5 µs |
| Node.js 24.15.0 | 10–100 KB | 9.9 µs (4%) | 111.4 µs (49%) | 107.2 µs (47%) | 228.5 µs | 227.8 µs |
| Node.js 24.15.0 | 100 KB–1 MB | 198.6 µs (7%) | 1.30 ms (44%) | 1.46 ms (49%) | 2.96 ms | 3.04 ms |
| Node.js 24.15.0 | > 1 MB | 812.0 µs (2%) | 7.28 ms (22%) | 24.67 ms (75%) | 32.76 ms | 34.99 ms |
| Node.js 24.15.0 | All | 17.3 µs (4%) | 138.3 µs (28%) | 338.2 µs (68%) | 493.9 µs | 521.3 µs |
| Bun 1.3.14 | < 1 KB | 0.0 µs (1%) | 1.0 µs (40%) | 1.5 µs (59%) | 2.5 µs | 2.8 µs |
| Bun 1.3.14 | 1–10 KB | 0.1 µs (1%) | 10.2 µs (46%) | 11.9 µs (53%) | 22.3 µs | 24.7 µs |
| Bun 1.3.14 | 10–100 KB | 0.5 µs (0%) | 96.5 µs (46%) | 115.0 µs (54%) | 212.0 µs | 232.4 µs |
| Bun 1.3.14 | 100 KB–1 MB | 18.3 µs (1%) | 1.16 ms (46%) | 1.34 ms (53%) | 2.51 ms | 2.67 ms |
| Bun 1.3.14 | > 1 MB | 40.7 µs (0%) | 6.37 ms (41%) | 9.19 ms (59%) | 15.60 ms | 16.24 ms |
| Bun 1.3.14 | All | 1.2 µs (0%) | 121.6 µs (43%) | 161.3 µs (57%) | 284.1 µs | 298.8 µs |

## Tokenizing

yuku-css's `tokenize` returns every token packed into a `Uint32Array`, type and end offset, as css-tree packs its `offsetAndType`. css-tree's `tokenize` calls back once for each token, timed here counting them. Both on the 246 files yuku-css and css-tree parse cleanly.

| Runtime | Tokenizer | Per file | MB/s | vs yuku-css | Share of its same-work parse |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 107.4 µs | 421.4 MB/s |  | 21% |
| Node.js 24.15.0 | css-tree | 210.3 µs | 215.3 MB/s | 1.96× | 14% |
| Bun 1.3.14 | yuku-css | 88.6 µs | 510.7 MB/s |  | 32% |
| Bun 1.3.14 | css-tree | 172.0 µs | 263.3 MB/s | 1.94× | 34% |

## Printing

`generate` from `yuku-css/codegen` against css-tree's `generate`, both printing css-tree's own tree of each file, values parsed and positions on, built before timing. Both print the same bytes; with `sourceMap: true` each also builds a source map, timed through `map.toString()`. On the 246 files css-tree parses cleanly that way.

| Runtime | Printer | Per file | MB/s | vs yuku-css |
| --- | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 199.1 µs | 227.4 MB/s |  |
| Node.js 24.15.0 | yuku-css, source map | 437.3 µs | 103.5 MB/s |  |
| Node.js 24.15.0 | css-tree | 485.1 µs | 93.3 MB/s | 2.44× |
| Node.js 24.15.0 | css-tree, source map | 1259.9 µs | 35.9 MB/s | 2.88× |
| Bun 1.3.14 | yuku-css | 133.3 µs | 339.7 MB/s |  |
| Bun 1.3.14 | yuku-css, source map | 266.6 µs | 169.8 MB/s |  |
| Bun 1.3.14 | css-tree | 364.9 µs | 124.1 MB/s | 2.74× |
| Bun 1.3.14 | css-tree, source map | 710.4 µs | 63.7 MB/s | 2.66× |

![Time per file to print css-tree's tree on Node.js 24.15.0](benchmark/generate.svg)

## Validating

`matchStylesheet` from `yuku-css/lexer` parses a style sheet and matches every declaration against the grammar in one WebAssembly call; each result's `matched` and `error` are read, which builds css-tree's match tree and error. css-tree validates by parsing with values and calling `lexer.matchDeclaration` on each declaration, which builds both at once. `yuku-css unread` reads neither, as a caller that only counts errors would not. The grammars differ, yuku-css's from @webref/css and css-tree's from mdn-data, so the trees and errors are the same only where the grammars agree. On the 246 files both parse cleanly.

| Runtime | Validator | Markless corpus, per file (231 files) | MB/s | npm, per file (12 files) | MB/s | Synthetic, per file (3 files) | MB/s | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 17.4 µs | 88.6 MB/s | 2.77 ms | 250.3 MB/s | 1.15 ms | 713.4 MB/s |  |
| Node.js 24.15.0 | yuku-css unread | 13.9 µs | 111.1 MB/s | 2.19 ms | 315.9 MB/s | 1.12 ms | 730.5 MB/s | 0.81× |
| Node.js 24.15.0 | css-tree | 145.0 µs | 10.7 MB/s | 60.89 ms | 11.4 MB/s | 38.54 ms | 21.3 MB/s | 21.61× |
| Bun 1.3.14 | yuku-css | 15.9 µs | 97.1 MB/s | 2.17 ms | 319.5 MB/s | 826.3 µs | 992.8 MB/s |  |
| Bun 1.3.14 | yuku-css unread | 11.4 µs | 135.2 MB/s | 1.70 ms | 408.6 MB/s | 792.3 µs | 1035.4 MB/s | 0.79× |
| Bun 1.3.14 | css-tree | 51.0 µs | 30.3 MB/s | 13.39 ms | 51.8 MB/s | 14.27 ms | 57.5 MB/s | 6.69× |

## Cold start

The median of 10 fresh processes. Load is the `import` of the library, which for yuku-css includes compiling its WebAssembly. First and second are the first two parses in that process. Warm is the median from the parse timings.

| Runtime | File | Parser | Load | First parse | Second parse | Warm parse | Load and first parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 3.03 ms | 2.25 ms | 94.7 µs | 6.7 µs | 5.24 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 4.39 ms | 2.56 ms | 103.5 µs | 7.7 µs | 6.91 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css transform | 2.90 ms | 2.11 ms | 34.8 µs | 3.8 µs | 4.98 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css diagnostics | 2.93 ms | 1.92 ms | 29.0 µs | 4.0 µs | 4.96 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 21.08 ms | 1.19 ms | 180.7 µs | 22.2 µs | 22.27 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.16 ms | 317.3 µs | 30.6 µs | 15.0 µs | 2.48 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 13.28 ms | 64.78 ms | 679.1 µs | 42.1 µs | 78.35 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 6.16 ms | 897.4 µs | 111.4 µs | 10.1 µs | 7.05 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css | 3.03 ms | 11.85 ms | 8.35 ms | 2.16 ms | 14.83 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css print | 4.06 ms | 12.97 ms | 6.95 ms | 2.50 ms | 17.10 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css transform | 3.04 ms | 5.75 ms | 2.08 ms | 1.24 ms | 8.76 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css diagnostics | 3.04 ms | 4.83 ms | 1.86 ms | 1.18 ms | 7.87 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | css-tree | 21.77 ms | 20.56 ms | 17.18 ms | 6.65 ms | 42.24 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss | 2.16 ms | 4.53 ms | 3.81 ms | 3.50 ms | 6.71 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss-wasm | 13.77 ms | 109.07 ms | 21.94 ms | 8.23 ms | 122.82 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | postcss | 5.79 ms | 11.94 ms | 9.04 ms | 3.81 ms | 17.71 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 4.27 ms | 1.61 ms | 365.6 µs | 6.6 µs | 5.91 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 6.13 ms | 1.97 ms | 334.5 µs | 7.7 µs | 8.02 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css transform | 4.31 ms | 979.5 µs | 237.4 µs | 2.9 µs | 5.32 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css diagnostics | 4.17 ms | 986.6 µs | 239.8 µs | 2.9 µs | 5.18 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 10.91 ms | 1.73 ms | 274.8 µs | 9.2 µs | 12.64 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.36 ms | 350.2 µs | 30.4 µs | 13.8 µs | 2.71 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 21.33 ms | 4.91 ms | 2.24 ms | 55.6 µs | 26.30 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 9.84 ms | 1.34 ms | 223.8 µs | 11.4 µs | 11.17 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css | 4.40 ms | 9.76 ms | 6.67 ms | 2.01 ms | 14.15 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css print | 6.26 ms | 12.20 ms | 6.48 ms | 2.30 ms | 18.52 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css transform | 4.74 ms | 5.16 ms | 2.15 ms | 919.9 µs | 9.92 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css diagnostics | 4.44 ms | 4.82 ms | 1.97 ms | 915.0 µs | 9.26 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | css-tree | 11.92 ms | 13.58 ms | 9.48 ms | 2.86 ms | 25.54 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss | 2.44 ms | 4.37 ms | 3.53 ms | 3.29 ms | 6.87 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss-wasm | 21.51 ms | 53.31 ms | 29.51 ms | 12.29 ms | 74.32 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | postcss | 8.34 ms | 10.06 ms | 7.15 ms | 4.72 ms | 18.44 ms |

![Load and first parse in a fresh Node.js 24.15.0 process](benchmark/cold.svg)

## Memory

Each file of 100 KB or more, parsed in a fresh Node.js 24.15.0 process run with `--expose-gc`, median of 3. Heap is the JS heap the tree retains after a full GC. External is memory outside the JS heap, such as WebAssembly memory, which only grows. Peak is how far resident memory rose during the parse. Negative readings, which are noise, show as 0.

| File | Size | yuku-css: heap / external / peak | css-tree, same work: heap / external / peak | css-tree, defaults: heap / external / peak | lightningcss: heap / external / peak | lightningcss-wasm: heap / external / peak | postcss: heap / external / peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| website__styles__global.css | 120.5 KB | 1.0 MB / 2.4 MB / 2.0 MB | – | – | 0.0 MB / 0.2 MB / 2.4 MB | 0.2 MB / 0.0 MB / 102.3 MB | 0.9 MB / 0.0 MB / 0.7 MB |
| font-awesome.css | 129.5 KB | 5.5 MB / 3.1 MB / 13.8 MB | 6.5 MB / 2.0 MB / 5.2 MB | 3.1 MB / 1.0 MB / 3.2 MB | 0.0 MB / 0.2 MB / 6.5 MB | 0.1 MB / 0.0 MB / 82.7 MB | 3.7 MB / 0.0 MB / 10.7 MB |
| foundation.css | 164.1 KB | 6.1 MB / 3.2 MB / 11.3 MB | 7.3 MB / 2.6 MB / 6.4 MB | 3.6 MB / 1.3 MB / 2.9 MB | – | – | 4.0 MB / 0.0 MB / 11.7 MB |
| bootstrap.css | 274.5 KB | 8.1 MB / 6.7 MB / 28.7 MB | 9.4 MB / 4.3 MB / 15.3 MB | 4.6 MB / 2.1 MB / 2.9 MB | 0.0 MB / 0.5 MB / 7.8 MB | 0.2 MB / 0.0 MB / 136.3 MB | 5.9 MB / 0.0 MB / 16.5 MB |
| bootstrap.min.css | 227.3 KB | 8.1 MB / 6.6 MB / 29.8 MB | 9.4 MB / 3.6 MB / 12.9 MB | 4.5 MB / 1.8 MB / 4.6 MB | 0.0 MB / 0.5 MB / 8.1 MB | 0.2 MB / 0.0 MB / 121.7 MB | 5.3 MB / 0.0 MB / 16.6 MB |
| primer.css | 728.0 KB | 16.9 MB / 15.6 MB / 44.4 MB | – | – | – | – | 12.9 MB / 0.0 MB / 30.9 MB |
| bulma.css | 745.3 KB | 15.6 MB / 15.7 MB / 34.8 MB | 17.8 MB / 11.4 MB / 30.4 MB | 8.4 MB / 5.8 MB / 10.1 MB | 0.0 MB / 1.5 MB / 15.7 MB | 0.2 MB / 0.0 MB / 197.3 MB | 11.3 MB / 0.0 MB / 29.7 MB |
| tailwind.min.css | 2865.3 KB | 104.8 MB / 63.8 MB / 164.5 MB | 118.0 MB / 44.5 MB / 161.2 MB | 53.4 MB / 22.3 MB / 80.8 MB | 0.0 MB / 6.2 MB / 92.1 MB | 0.2 MB / 48.7 MB / 504.7 MB | 71.6 MB / 0.0 MB / 161.2 MB |
| tailwind.css | 3557.0 KB | 105.1 MB / 80.5 MB / 167.9 MB | 118.3 MB / 55.3 MB / 166.3 MB | 53.7 MB / 27.7 MB / 78.8 MB | 0.0 MB / 6.9 MB / 85.5 MB | 0.2 MB / 47.4 MB / 556.9 MB | 52.6 MB / 0.0 MB / 170.3 MB |
| deep-nesting.css | 393.6 KB | 31.1 MB / 29.6 MB / 70.2 MB | 35.4 MB / 5.9 MB / 48.6 MB | 15.6 MB / 3.1 MB / 17.3 MB | 0.0 MB / 2.0 MB / 32.5 MB | 0.0 MB / 5.9 MB / 230.2 MB | 12.5 MB / 0.0 MB / 50.2 MB |
| long-selector-list.css | 1033.0 KB | 60.8 MB / 67.7 MB / 105.3 MB | 70.6 MB / 15.9 MB / 87.9 MB | 31.7 MB / 7.9 MB / 49.1 MB | 0.0 MB / 2.0 MB / 17.8 MB | 0.0 MB / 0.0 MB / 26.0 MB | 15.7 MB / 0.0 MB / 62.5 MB |
| huge-custom-properties.css | 976.8 KB | 0.1 MB / 19.7 MB / 1.2 MB | 0.1 MB / 15.1 MB / 13.3 MB | 0.1 MB / 7.6 MB / 5.5 MB | 0.0 MB / 1.9 MB / 149.1 MB | 0.0 MB / 61.4 MB / 230.2 MB | 1.0 MB / 0.0 MB / 112.1 MB |
| many-at-rules.css | 673.4 KB | 36.1 MB / 49.7 MB / 75.4 MB | – | – | 0.0 MB / 1.3 MB / 31.0 MB | 0.1 MB / 3.7 MB / 226.2 MB | 18.8 MB / 0.0 MB / 48.3 MB |

## Bundle size

What a browser downloads to parse: the library bundled by [Rolldown](https://rolldown.rs) for the browser and minified, keeping only its parse function (`transform` for Lightning CSS and for the `yuku-css transform` row, `generate` for `yuku-css/codegen`), plus any file it fetches beside the JS. yuku-css inlines its WebAssembly into the JS as printable ASCII text. Lightning CSS's WebAssembly is a separate file; its native addon does not run in a browser.

| Entry | Minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `yuku-css` | 205.4 KB | 60.6 KB | 48.7 KB |
| `yuku-css/codegen` | 15.0 KB | 5.4 KB | 4.9 KB |
| yuku-css transform | 189.6 KB | 57.1 KB | 45.8 KB |
| `css-tree` | 194.3 KB | 53.2 KB | 46.8 KB |
| `css-tree/parser` | 48.0 KB | 12.6 KB | 11.4 KB |
| `lightningcss-wasm` | 15474.0 KB | 3670.3 KB | 2025.7 KB |
| `postcss` | 56.1 KB | 17.2 KB | 15.5 KB |

![Bytes downloaded, gzipped](benchmark/bundle.svg)

Gzipped. `lightningcss-wasm`, past 1 MB, is left off the chart.

## In the browser

The parse timings in headless Chromium 156.0.8078.4, a fresh browser for each of 3 runs, on a cross-origin isolated page, where `performance.now()` ticks every 5 µs. Each library is bundled by Rolldown as a consumer would bundle it.

| Parser | Work | Markless, per file (228 files) | p95 | vs yuku-css | All files, MB/s (242 files) |
| --- | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 11.8 µs | 13.3 µs |  | 124.9 MB/s |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 9.0 µs | 9.5 µs |  | 217.3 MB/s |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 8.8 µs | 10.0 µs |  | 158.5 MB/s |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 6.7 µs | 7.1 µs |  | 259.1 MB/s |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 12.9 µs | 13.6 µs | 1.10× | 104.0 MB/s |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 6.5 µs | 6.7 µs | 0.55× | 286.3 MB/s |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 7.0 µs | 7.8 µs | 0.59× | 322.7 MB/s |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 23.9 µs | 25.7 µs | 2.03× | 52.4 MB/s |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 20.4 µs | 21.6 µs | 2.27× | 79.8 MB/s |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 21.7 µs | 23.1 µs | 2.46× | 56.8 MB/s |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 18.4 µs | 19.4 µs | 2.73× | 81.1 MB/s |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 57.8 µs | 64.3 µs | 4.92× | 30.9 MB/s |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 16.4 µs | 17.8 µs | 1.39× | 64.9 MB/s |

![Time per file to parse the Markless corpus in Chromium](benchmark/browser.svg)

Median time per file, 228 Markless files, Chromium.

## Files left out

Before timing, every configuration parses every file once. A parse that throws or reports an error is left out of that configuration's timings, and each comparison uses only the files every parser in it parsed cleanly. yuku-css parsed all 269 of 269 cleanly.

| File | Left out of | First error |
| --- | ---: | ---: |
| website__components__demos__build__drink-pick.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 6 errors, first: Colon is expected |
| website__components__docs__code.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__docs__pm-command.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__docs__preview-card.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__docs__term.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__docs__theme-toggle.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 2 errors, first: Colon is expected |
| website__components__figures__devices__devices-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 3 errors, first: Colon is expected |
| website__components__figures__existing-site__existing-site-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 2 errors, first: Colon is expected |
| website__components__figures__intro__intro-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 2 errors, first: Colon is expected |
| website__components__figures__kit__draw.tsrx.5.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__figures__name__name-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 3 errors, first: Colon is expected |
| website__components__figures__popup__popup-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 10 errors, first: Colon is expected |
| website__components__figures__state__state-anatomy.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 4 errors, first: Colon is expected |
| website__components__mascot__mug-art.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 52 errors, first: Colon is expected |
| website__components__mascot__mug-studio.tsrx.0.css | css-tree, same work; css-tree, defaults | 89 errors, first: ")" is expected |
| website__components__sketch__concepts__computed-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__concepts__lists-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__concepts__state-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__index-card.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__pages__ui__accordion-examples.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 2 errors, first: Colon is expected |
| website__styles__global.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 4 errors, first: Colon is expected |
| primer.css | css-tree, same work; css-tree, defaults | 6 errors, first: ")" is expected |
| many-at-rules.css | css-tree, same work; css-tree, defaults | 2000 errors, first: Colon is expected |
| website__components__mascot__mug-studio.tsrx.0.css | css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 77 errors, first: Colon is expected |
| website__components__docs__anatomy-table-view.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-selection |
| website__components__docs__anatomy__branch.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-tree-selection |
| website__components__docs__keyboard-table.tsrx.0.css | lightningcss; lightningcss-wasm | 3 errors, first: Unknown at rule: @keyboard-inspection |
| foundation.css | lightningcss; lightningcss-wasm | 1 error, first: Invalid media query |
| primer.css | lightningcss; lightningcss-wasm | 6 errors, first: Unknown at rule: @custom-media |

## Methodology

- **Corpus.** 252 style sheets from the Markless repository ([test/corpus](../test/corpus)); 13 files from npm packages, pinned by version and checked by SHA-256; 4 generated stress files: deep nesting, a long selector list, huge custom properties, and many at-rules; and an empty file and a one-rule file, timed only for the cost of a call. `node bench/corpus.ts` fetches and generates them ([bench/corpus.ts](../bench/corpus.ts)).
- **Processes.** Each measurement runs in a fresh process, 3 times, with the runs of every configuration taking turns. A file's time is the median over runs of its median; its p95 is the median over runs of its 95th percentile.
- **Sampling.** A process first parses its files in turn for at least a second, so the JIT has compiled the hot paths. It then parses each file for 6 ms more and samples it for 30 ms and at least 10 samples (half that in the browser). A sample times enough parses to last 20 µs (500 µs in the browser), so the clock's cost and precision do not count.
- **Smallest first.** A process times its files a size bucket at a time, from the smallest, warming each bucket up first. css-tree resets its token buffers in full on every parse (`balance.fill(0)` in its `TokenStream`), and they keep the size of the largest source it has parsed: in a one-off check, `.a { color: red }` took 1.4 µs to parse before a 3.6 MB file and 60 µs after. Timing small files after large ones would charge css-tree for that.
- **Per file** is the sum of the files' medians over the number of files. **MB/s** is the files' bytes over that sum.
- **Same work.** yuku-css and css-tree get the same options: `parseValue` and `parseAtrulePrelude` on and `parseCustomProperty` off, which is what yuku-css builds by default, and `positions` on, so both build css-tree's `loc` with lines and columns. Rows with values raw turn the first two off for both. css-tree's defaults are the same with positions off. Without positions yuku-css still gives each node `start` and `end` offsets, so it does more than css-tree there. Each library is called through one adapter in [bench/adapters.ts](../bench/adapters.ts), so after an API change only the adapter changes.
- **Building the tree.** yuku-css builds its JS tree when `ast` is first read. Every yuku-css row reads `ast` inside the timed call, so its time includes building the tree, except `yuku-css diagnostics`, which reads only `diagnostics`, as a caller that only checks for errors would, and builds no tree in JS.
- **Lightning CSS** has no parse-only API in JS. It is timed calling `transform({ filename, code, minify: false })`, which parses into typed structures, values included, and prints CSS back with no minifying and no targets, so nothing is lowered. Encoding the source string to bytes is part of the timed call, as it is in yuku-css's `parse`.

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0, one-minute load average 5.0 at the start, 3.3 at the end |
| Runtimes | Node.js 24.15.0, Bun 1.3.14, Chromium 156.0.8078.4 |
| Libraries | yuku-css 0.1.0 (8c419a7), css-tree 3.2.1, lightningcss 1.33.0, postcss 8.5.30, @csstools/css-tokenizer 4.0.2, csso 5.0.5, @csstools/css-parser-algorithms 4.0.2, @adobe/css-tools 4.5.0, stylis 4.4.0, lightningcss-wasm 1.33.0, esbuild 0.28.2, @swc/css 0.0.28, oxfmt 0.73.0, @biomejs/js-api 6.0.0, prettier 3.9.10, clean-css 5.3.3, oxc-css-parser 0.0.17 (1c7745b) |
| Duration | 113 min: oxc build 16 s, modes 0 s, gate 8 s, parse 1160 s, tokenize 144 s, generate 312 s, validate 239 s, phases 190 s, cold 36 s, memory 80 s, bundle 17 s, competitors gate 40 s, competitors 2876 s, native 172 s, browser 1515 s |

## Caveats

- The trees are not identical even when the work is the same: where css-tree reads CSS otherwise than the CSS specifications, yuku-css follows the specifications, and it collects every comment, which css-tree does only when given `onComment`. [test/divergences.ts](../test/divergences.ts) lists every difference.
- css-tree reads a nested rule that starts with a type selector, such as `html.dark & {}`, as a declaration and reports an error, which is why it leaves out most of the Markless files it does.
- css-tree is imported from its main entry, which also loads its lexer and syntax data. `css-tree/parser` loads less; its bundle size is listed.
- yuku-css's WebAssembly memory grows to fit the largest file it has parsed and does not shrink until it has passed 128 MB and a small file comes, so its external memory is a high-water mark.
- Some timings changed by more than 2× between the 3 processes, which the median over runs does not fully absorb: lightningcss-wasm on Node.js 24.15.0, 13 files (such as demos__interaction-benchmark__apps__octane__src__shared__styles.css) and lightningcss-wasm on Bun 1.3.14, 1 file (such as website__components__docs__code.tsrx.0.css).
- One machine, one run of the suite: differences under about 5% are noise.
