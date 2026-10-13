# Benchmark

yuku-css 0.1.0 (5a88225) against [css-tree](https://github.com/csstree/csstree) 3.2.1, with [Lightning CSS](https://lightningcss.dev) and [PostCSS](https://postcss.org) for context, on an Apple M5 Pro, 2026-10-13. Run it with `bun run bench:full`; the raw data is in [bench/results/2026-10-13.json](../bench/results/2026-10-13.json).

## Summary

On 228 Markless style sheets, yuku-css parses a file in 11.4 µs on Node.js 24.15.0, 3.36× faster than css-tree building the same tree: selectors parsed, values and at-rule preludes kept raw, positions on; 1.66× on Bun 1.3.14, and 2.28× in Chromium. Over all 248 files both parse cleanly, 12.0 MB of CSS, it reads 110.8 MB/s against css-tree's 31.7 MB/s; the lead is widest on files of 100 KB–1 MB (4.05×) and narrowest on < 1 KB (3.27×). css-tree's defaults, which also parse values, take 3.39× as long, and Lightning CSS's native addon, which parses values into typed structures and prints CSS back, 2.11×. Where yuku-css loses: on long-selector-list.css on Node.js 24.15.0, lightningcss (1.91×) and postcss (1.51×) parse faster; on long-selector-list.css on Bun 1.3.14, css-tree, same work (1.22×), css-tree, defaults (1.45×), lightningcss (1.61×) and postcss (1.41×) parse faster; it holds more memory outside the JS heap: after parsing tailwind.css its WebAssembly memory has grown to 263.7 MB, and on files of 100 KB or more its peak resident memory is a median 1.63× css-tree's, though its tree retains 0.54× the JS heap css-tree's does; `css-tree/parser` (12.6 KB) and `postcss` (17.2 KB) download less than its 19.6 KB gzipped.

![Time per file to parse the Markless corpus on Node.js 24.15.0](benchmark/corpus.svg)

Median time per file, 228 Markless files, Node.js 24.15.0.

## Parse time

Each row says the work it does. Only rows marked the same as yuku-css build what yuku-css builds; the others are context.

### Markless corpus, 228 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values raw, positions | 11.4 µs | 12.8 µs |  | 8.3 µs | 9.3 µs |  |
| css-tree, same work | values raw, positions (same as yuku-css) | 38.3 µs | 42.1 µs | 3.36× | 13.8 µs | 15.7 µs | 1.66× |
| css-tree, values raw, no positions | values raw, no positions (**not the same work**) | 34.0 µs | 37.0 µs | 2.98× | 10.9 µs | 12.2 µs | 1.30× |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 43.9 µs | 47.3 µs | 3.86× | 17.5 µs | 20.4 µs | 2.10× |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 38.6 µs | 43.3 µs | 3.39× | 13.9 µs | 16.1 µs | 1.67× |
| lightningcss | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 24.0 µs | 27.5 µs | 2.11× | 22.8 µs | 26.4 µs | 2.73× |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 114.0 µs | 4966.6 µs | 10.01× | 104.8 µs | 366.9 µs | 12.56× |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 20.1 µs | 22.7 µs | 1.76× | 24.4 µs | 33.3 µs | 2.92× |

### All files, 242 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values raw, positions | 418.5 µs | 440.1 µs |  | 324.6 µs | 337.0 µs |  |
| css-tree, same work | values raw, positions (same as yuku-css) | 1466.0 µs | 1674.6 µs | 3.50× | 448.4 µs | 565.0 µs | 1.38× |
| css-tree, values raw, no positions | values raw, no positions (**not the same work**) | 1055.7 µs | 1102.8 µs | 2.52× | 365.3 µs | 434.4 µs | 1.13× |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 1629.2 µs | 1818.3 µs | 3.89× | 532.1 µs | 688.9 µs | 1.64× |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 1099.6 µs | 1146.4 µs | 2.63× | 418.9 µs | 498.9 µs | 1.29× |
| lightningcss | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 757.6 µs | 786.9 µs | 1.81× | 742.4 µs | 765.3 µs | 2.29× |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 2111.4 µs | 7161.7 µs | 5.04× | 2910.2 µs | 3351.4 µs | 8.96× |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 959.4 µs | 1111.8 µs | 2.29× | 831.7 µs | 977.2 µs | 2.56× |

### By size

Throughput on Node.js 24.15.0, by file size, on the 248 files both yuku-css and css-tree parse cleanly, less any a context parser leaves out.

| Size | Files | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| < 1 KB | 125 | 134.0 MB/s | 40.9 MB/s | 41.5 MB/s | 51.1 MB/s | 18.7 MB/s | 81.6 MB/s | 3.27× |
| 1–10 KB | 107 | 134.8 MB/s | 40.0 MB/s | 39.6 MB/s | 66.2 MB/s | 13.2 MB/s | 75.3 MB/s | 3.37× |
| 10–100 KB | 4 | 158.3 MB/s | 45.4 MB/s | 42.6 MB/s | 97.6 MB/s | 3.7 MB/s | 84.8 MB/s | 3.49× |
| 100 KB–1 MB | 9 | 142.9 MB/s | 35.2 MB/s | 37.3 MB/s | 50.8 MB/s | 19.7 MB/s | 46.3 MB/s | 4.05× |
| > 1 MB | 3 | 96.9 MB/s | 29.6 MB/s | 42.9 MB/s | 64.2 MB/s | 26.4 MB/s | 48.8 MB/s | 3.28× |

![Throughput by file size on Node.js 24.15.0](benchmark/buckets.svg)

### Real-world CSS from npm

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normalize.css | 6.0 KB | 26.9 µs (30.2 µs) | 81.1 µs (86.9 µs) | 67.4 µs (72.2 µs) | 38.5 µs (44.3 µs) | 122.8 µs (18.69 ms) | 46.5 µs (52.9 µs) | 3.02× |
| preflight.css | 7.6 KB | 37.1 µs (40.6 µs) | 106.6 µs (112.5 µs) | 93.3 µs (104.4 µs) | 55.5 µs (61.6 µs) | 211.5 µs (19.58 ms) | 59.9 µs (68.2 µs) | 2.87× |
| pure.css | 25.6 KB | 195.4 µs (217.2 µs) | 568.8 µs (607.0 µs) | 481.2 µs (522.7 µs) | 242.5 µs (279.5 µs) | 10.74 ms (21.15 ms) | 268.6 µs (326.8 µs) | 2.91× |
| github-markdown.css | 28.7 KB | 244.1 µs (261.4 µs) | 664.0 µs (707.8 µs) | 619.7 µs (653.3 µs) | 330.1 µs (361.8 µs) | 10.48 ms (20.81 ms) | 307.5 µs (351.1 µs) | 2.72× |
| animate.css | 93.1 KB | 478.3 µs (511.2 µs) | 2.00 ms (2.12 ms) | 2.38 ms (2.58 ms) | 916.7 µs (995.8 µs) | 21.25 ms (21.85 ms) | 1.20 ms (1.37 ms) | 4.18× |
| font-awesome.css | 129.5 KB | 1.36 ms (1.57 ms) | 3.84 ms (3.95 ms) | 3.64 ms (3.75 ms) | 1.90 ms (1.98 ms) | 4.85 ms (5.06 ms) | 1.92 ms (2.53 ms) | 2.83× |
| foundation.css | 164.1 KB | 1.64 ms (1.82 ms) | 4.57 ms (4.96 ms) | 4.32 ms (4.56 ms) | – | – | 2.49 ms (3.13 ms) | 2.79× |
| bootstrap.css | 274.5 KB | 2.37 ms (2.47 ms) | 6.52 ms (7.35 ms) | 6.36 ms (7.14 ms) | 3.74 ms (3.89 ms) | 8.58 ms (8.92 ms) | 4.14 ms (5.27 ms) | 2.76× |
| bootstrap.min.css | 227.3 KB | 2.20 ms (2.44 ms) | 5.45 ms (5.80 ms) | 5.23 ms (5.46 ms) | 3.45 ms (3.57 ms) | 8.11 ms (8.20 ms) | 2.41 ms (3.24 ms) | 2.48× |
| primer.css | 728.0 KB | 4.68 ms (5.15 ms) | 13.63 ms (14.89 ms) | – | – | – | 6.79 ms (7.76 ms) | 2.92× |
| bulma.css | 745.3 KB | 4.45 ms (5.08 ms) | 13.34 ms (13.84 ms) | 12.69 ms (13.14 ms) | 9.63 ms (9.85 ms) | 21.52 ms (22.04 ms) | 9.04 ms (9.34 ms) | 3.00× |
| tailwind.min.css | 2865.3 KB | 26.62 ms (27.21 ms) | 85.88 ms (102.42 ms) | 59.89 ms (60.88 ms) | 51.59 ms (54.42 ms) | 128.99 ms (138.56 ms) | 56.37 ms (63.20 ms) | 3.23× |
| tailwind.css | 3557.0 KB | 26.87 ms (27.52 ms) | 99.51 ms (115.40 ms) | 70.94 ms (74.57 ms) | 54.02 ms (55.13 ms) | 127.08 ms (152.11 ms) | 83.24 ms (90.31 ms) | 3.70× |

### Synthetic stress files

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deep-nesting.css | 393.6 KB | 7.54 ms (9.13 ms) | 21.41 ms (21.62 ms) | 18.74 ms (21.66 ms) | 12.42 ms (12.94 ms) | 41.84 ms (60.27 ms) | 10.18 ms (12.66 ms) | 2.84× |
| long-selector-list.css | 1033.0 KB | 25.33 ms (26.09 ms) | 72.82 ms (86.96 ms) | 47.16 ms (47.57 ms) | 13.28 ms (13.68 ms) | 32.75 ms (33.85 ms) | 16.81 ms (29.94 ms) | 2.87× |
| huge-custom-properties.css | 976.8 KB | 981.9 µs (1.03 ms) | 33.85 ms (34.68 ms) | 29.01 ms (29.43 ms) | 26.25 ms (26.95 ms) | 68.44 ms (69.65 ms) | 41.62 ms (45.23 ms) | 34.47× |
| many-at-rules.css | 673.4 KB | 5.71 ms (6.35 ms) | 22.69 ms (26.00 ms) | – | 11.58 ms (12.06 ms) | 24.20 ms (25.08 ms) | 16.77 ms (17.04 ms) | 3.98× |

## Cost per node

Every tree's nodes are counted the same way: each object with a string `type`, reached through fields and lists. The trees differ in shape, so the counts differ: yuku-css has a node for each compound selector, which css-tree folds into its selector; css-tree with parsed values has a node for each value token; PostCSS has none below a rule's selector. Lightning CSS returns no tree. Each row covers the files it parses cleanly.

| Parser | Files | Nodes | Node.js 24.15.0, ns per node | Bun 1.3.14, ns per node | Node.js 24.15.0, MB/s | Bun 1.3.14, MB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | 269 | 1,680,442 | 68.3 | 52.8 | 111.7 MB/s | 144.5 MB/s |
| css-tree, same work | 248 | 1,472,223 | 269.0 | 84.0 | 31.7 MB/s | 101.7 MB/s |
| css-tree, values raw, no positions | 248 | 1,472,223 | 196.6 | 68.6 | 43.4 MB/s | 124.5 MB/s |
| css-tree, values parsed, positions | 246 | 1,645,480 | 242.9 | 79.6 | 27.9 MB/s | 85.0 MB/s |
| css-tree, defaults | 246 | 1,645,480 | 164.6 | 62.7 | 41.1 MB/s | 108.0 MB/s |
| postcss | 269 | 336,882 | 773.3 | 694.6 | 49.2 MB/s | 54.8 MB/s |

## Where yuku-css spends its time

Its `parse` has three steps: encoding the source to UTF-8 in WebAssembly memory, parsing and serializing the tree in WebAssembly, and decoding the tree into JS objects. Each step is timed on its own (bench/yuku-phases.ts), per file, over the files yuku-css parses cleanly.

| Runtime | Size | Encode | Parse and serialize | Decode | Sum | Whole parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 0.2 µs (7%) | 1.3 µs (55%) | 0.9 µs (38%) | 2.4 µs | 2.6 µs |
| Node.js 24.15.0 | 1–10 KB | 1.4 µs (6%) | 12.0 µs (55%) | 8.5 µs (39%) | 21.9 µs | 23.3 µs |
| Node.js 24.15.0 | 10–100 KB | 10.3 µs (5%) | 114.1 µs (57%) | 76.1 µs (38%) | 200.5 µs | 217.3 µs |
| Node.js 24.15.0 | 100 KB–1 MB | 206.5 µs (7%) | 1.63 ms (57%) | 1.04 ms (36%) | 2.87 ms | 3.13 ms |
| Node.js 24.15.0 | > 1 MB | 827.5 µs (3%) | 12.12 ms (51%) | 11.02 ms (46%) | 23.97 ms | 26.27 ms |
| Node.js 24.15.0 | All | 17.9 µs (5%) | 204.7 µs (52%) | 167.6 µs (43%) | 390.1 µs | 426.6 µs |
| Bun 1.3.14 | < 1 KB | 0.0 µs (2%) | 1.1 µs (59%) | 0.7 µs (40%) | 1.8 µs | 1.8 µs |
| Bun 1.3.14 | 1–10 KB | 0.1 µs (1%) | 10.5 µs (60%) | 6.9 µs (40%) | 17.6 µs | 17.2 µs |
| Bun 1.3.14 | 10–100 KB | 0.5 µs (0%) | 103.8 µs (62%) | 63.2 µs (38%) | 167.6 µs | 162.1 µs |
| Bun 1.3.14 | 100 KB–1 MB | 19.7 µs (1%) | 1.45 ms (62%) | 875.0 µs (37%) | 2.34 ms | 2.31 ms |
| Bun 1.3.14 | > 1 MB | 44.2 µs (0%) | 10.90 ms (61%) | 6.82 ms (38%) | 17.77 ms | 20.70 ms |
| Bun 1.3.14 | All | 1.3 µs (0%) | 183.3 µs (61%) | 113.6 µs (38%) | 298.3 µs | 329.6 µs |

## Tokenizing

yuku-css exports no tokenizer: it tokenizes inside WebAssembly, as it parses. css-tree exports `tokenize`, timed here counting tokens on the 248 files it parses cleanly, against its own parse of the same files.

| Runtime | Tokenizer | Per file | MB/s | Share of css-tree's same-work parse |
| --- | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | css-tree | 243.8 µs | 208.0 MB/s | 15% |
| Bun 1.3.14 | css-tree | 196.6 µs | 257.9 MB/s | 39% |

## Cold start

The median of 10 fresh processes. Load is the `import` of the library, which for yuku-css includes compiling its WebAssembly. First and second are the first two parses in that process. Warm is the median from the parse timings.

| Runtime | File | Parser | Load | First parse | Second parse | Warm parse | Load and first parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 1.75 ms | 1.08 ms | 31.3 µs | 5.6 µs | 2.83 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 21.32 ms | 1.04 ms | 168.5 µs | 19.2 µs | 22.36 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.26 ms | 329.3 µs | 35.3 µs | 15.7 µs | 2.59 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 14.10 ms | 68.60 ms | 716.5 µs | 48.1 µs | 82.68 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 6.12 ms | 940.0 µs | 125.6 µs | 10.5 µs | 7.08 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css | 1.74 ms | 6.14 ms | 6.06 ms | 2.37 ms | 7.86 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | css-tree | 21.48 ms | 14.98 ms | 11.77 ms | 6.52 ms | 36.35 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss | 2.28 ms | 4.85 ms | 3.94 ms | 3.74 ms | 7.09 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss-wasm | 13.97 ms | 115.37 ms | 23.47 ms | 8.58 ms | 129.37 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | postcss | 6.10 ms | 11.11 ms | 8.46 ms | 4.14 ms | 17.23 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 2.73 ms | 966.2 µs | 200.1 µs | 4.2 µs | 3.66 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 11.71 ms | 1.39 ms | 308.8 µs | 7.0 µs | 13.17 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.68 ms | 373.6 µs | 33.3 µs | 14.7 µs | 3.05 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 21.52 ms | 4.98 ms | 2.19 ms | 61.7 µs | 26.45 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 9.56 ms | 1.32 ms | 259.5 µs | 11.6 µs | 10.86 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css | 2.68 ms | 7.48 ms | 3.36 ms | 1.68 ms | 10.14 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | css-tree | 11.39 ms | 12.32 ms | 7.17 ms | 2.50 ms | 23.57 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss | 2.66 ms | 4.57 ms | 3.74 ms | 3.55 ms | 7.24 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss-wasm | 22.27 ms | 58.01 ms | 25.43 ms | 13.44 ms | 80.50 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | postcss | 9.06 ms | 10.74 ms | 7.65 ms | 4.94 ms | 19.83 ms |

![Load and first parse in a fresh Node.js 24.15.0 process](benchmark/cold.svg)

## Memory

Each file of 100 KB or more, parsed in a fresh Node.js 24.15.0 process run with `--expose-gc`, median of 3. Heap is the JS heap the tree retains after a full GC. External is memory outside the JS heap, such as WebAssembly memory, which only grows. Peak is how far resident memory rose during the parse. Negative readings, which are noise, show as 0.

| File | Size | yuku-css: heap / external / peak | css-tree, same work: heap / external / peak | css-tree, defaults: heap / external / peak | lightningcss: heap / external / peak | lightningcss-wasm: heap / external / peak | postcss: heap / external / peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| website__styles__global.css | 120.5 KB | 0.4 MB / 2.7 MB / 3.5 MB | – | – | 0.0 MB / 0.2 MB / 2.4 MB | 0.2 MB / 0.0 MB / 103.8 MB | 0.9 MB / 0.0 MB / 1.6 MB |
| font-awesome.css | 129.5 KB | 2.8 MB / 14.0 MB / 11.7 MB | 5.5 MB / 2.0 MB / 7.6 MB | 3.1 MB / 1.0 MB / 6.3 MB | 0.0 MB / 0.2 MB / 6.4 MB | 0.1 MB / 0.0 MB / 81.0 MB | 3.7 MB / 0.0 MB / 12.5 MB |
| foundation.css | 164.1 KB | 3.0 MB / 27.4 MB / 15.4 MB | 5.6 MB / 2.6 MB / 6.6 MB | 3.6 MB / 1.3 MB / 6.3 MB | – | – | 4.0 MB / 0.0 MB / 14.4 MB |
| bootstrap.css | 274.5 KB | 3.8 MB / 28.9 MB / 17.7 MB | 7.1 MB / 4.3 MB / 9.2 MB | 4.5 MB / 2.1 MB / 6.7 MB | 0.0 MB / 0.5 MB / 7.8 MB | 0.2 MB / 0.0 MB / 137.4 MB | 5.9 MB / 0.0 MB / 19.2 MB |
| bootstrap.min.css | 227.3 KB | 3.8 MB / 27.9 MB / 17.5 MB | 7.1 MB / 3.6 MB / 8.5 MB | 4.5 MB / 1.8 MB / 7.5 MB | 0.0 MB / 0.5 MB / 8.0 MB | 0.2 MB / 0.0 MB / 127.1 MB | 5.3 MB / 0.0 MB / 16.3 MB |
| primer.css | 728.0 KB | 7.6 MB / 31.5 MB / 28.7 MB | 14.6 MB / 11.4 MB / 14.8 MB | – | – | – | 12.8 MB / 0.0 MB / 40.0 MB |
| bulma.css | 745.3 KB | 6.8 MB / 39.9 MB / 26.9 MB | 12.6 MB / 11.7 MB / 14.1 MB | 8.5 MB / 5.8 MB / 6.9 MB | 0.0 MB / 1.5 MB / 15.7 MB | 0.2 MB / 0.0 MB / 205.3 MB | 11.2 MB / 0.0 MB / 39.6 MB |
| tailwind.min.css | 2865.3 KB | 47.9 MB / 263.7 MB / 178.1 MB | 86.5 MB / 44.5 MB / 127.5 MB | 53.4 MB / 22.3 MB / 80.1 MB | 0.0 MB / 6.2 MB / 92.1 MB | 0.2 MB / 48.7 MB / 568.3 MB | 46.6 MB / 0.0 MB / 154.9 MB |
| tailwind.css | 3557.0 KB | 47.9 MB / 263.7 MB / 178.8 MB | 86.8 MB / 55.3 MB / 137.6 MB | 53.7 MB / 27.7 MB / 81.6 MB | 0.0 MB / 6.9 MB / 85.5 MB | 0.2 MB / 47.4 MB / 565.0 MB | 52.6 MB / 0.0 MB / 172.2 MB |
| deep-nesting.css | 393.6 KB | 17.8 MB / 109.5 MB / 74.1 MB | 31.8 MB / 6.2 MB / 43.4 MB | 15.5 MB / 3.1 MB / 23.5 MB | 0.0 MB / 2.0 MB / 32.5 MB | 0.0 MB / 5.9 MB / 231.3 MB | 12.5 MB / 0.0 MB / 46.5 MB |
| long-selector-list.css | 1033.0 KB | 39.8 MB / 255.5 MB / 146.0 MB | 70.2 MB / 15.9 MB / 94.6 MB | 31.7 MB / 8.1 MB / 48.7 MB | 0.0 MB / 2.0 MB / 17.8 MB | 0.0 MB / 0.0 MB / 29.4 MB | 15.7 MB / 0.0 MB / 61.5 MB |
| huge-custom-properties.css | 976.8 KB | 0.0 MB / 4.1 MB / 1.1 MB | 0.1 MB / 15.3 MB / 10.2 MB | 0.1 MB / 7.6 MB / 2.4 MB | 0.0 MB / 1.9 MB / 149.1 MB | 0.0 MB / 61.4 MB / 226.3 MB | 1.0 MB / 0.0 MB / 106.9 MB |
| many-at-rules.css | 673.4 KB | 12.0 MB / 101.5 MB / 48.1 MB | 22.3 MB / 10.5 MB / 35.3 MB | – | 0.0 MB / 1.3 MB / 31.0 MB | 0.1 MB / 4.3 MB / 226.3 MB | 18.8 MB / 0.0 MB / 46.8 MB |

## Bundle size

What a browser downloads to parse: the library bundled by [Rolldown](https://rolldown.rs) for the browser and minified, keeping only its parse function (`transform` for Lightning CSS), plus any file it fetches beside the JS. yuku-css inlines its WebAssembly into the JS as base64. Lightning CSS's WebAssembly is a separate file; its native addon does not run in a browser.

| Entry | Minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `yuku-css` | 53.2 KB | 19.6 KB | 16.6 KB |
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
| yuku-css | values raw, positions | 10.5 µs | 11.0 µs |  | 120.2 MB/s |
| css-tree, same work | values raw, positions (same as yuku-css) | 24.0 µs | 25.8 µs | 2.28× | 51.8 MB/s |
| css-tree, values raw, no positions | values raw, no positions (**not the same work**) | 20.0 µs | 21.4 µs | 1.91× | 75.6 MB/s |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 26.2 µs | 28.1 µs | 2.50× | 48.7 MB/s |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 22.1 µs | 23.4 µs | 2.11× | 74.5 MB/s |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 61.8 µs | 72.7 µs | 5.89× | 27.8 MB/s |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 17.8 µs | 19.5 µs | 1.70× | 60.0 MB/s |

![Time per file to parse the Markless corpus in Chromium](benchmark/browser.svg)

Median time per file, 228 Markless files, Chromium.

## Files left out

Before timing, every configuration parses every file once. A parse that throws or reports an error is left out of that configuration's timings, and each comparison uses only the files every parser in it parsed cleanly. yuku-css parsed all 269 of 269 cleanly.

| File | Left out of | First error |
| --- | ---: | ---: |
| website__components__demos__build__drink-pick.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 6 errors, first: Colon is expected |
| website__components__docs__code.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__docs__pm-command.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__docs__preview-card.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__docs__term.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__docs__theme-toggle.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 2 errors, first: Colon is expected |
| website__components__figures__devices__devices-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 3 errors, first: Colon is expected |
| website__components__figures__existing-site__existing-site-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 2 errors, first: Colon is expected |
| website__components__figures__intro__intro-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 2 errors, first: Colon is expected |
| website__components__figures__kit__draw.tsrx.5.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__figures__name__name-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 3 errors, first: Colon is expected |
| website__components__figures__popup__popup-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 10 errors, first: Colon is expected |
| website__components__figures__state__state-anatomy.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 4 errors, first: Colon is expected |
| website__components__mascot__mug-art.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 51 errors, first: Colon is expected |
| website__components__mascot__mug-studio.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 77 errors, first: Colon is expected |
| website__components__sketch__concepts__computed-sketch.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__sketch__concepts__lists-sketch.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__sketch__concepts__state-sketch.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__components__sketch__index-card.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 1 error, first: Colon is expected |
| website__pages__ui__accordion-examples.tsrx.0.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 2 errors, first: Colon is expected |
| website__styles__global.css | css-tree, same work; css-tree, values raw, no positions; css-tree, values parsed, positions; css-tree, defaults | 4 errors, first: Colon is expected |
| primer.css | css-tree, values parsed, positions; css-tree, defaults; lightningcss; lightningcss-wasm | 6 errors, first: ")" is expected |
| many-at-rules.css | css-tree, values parsed, positions; css-tree, defaults | 2000 errors, first: Colon is expected |
| website__components__docs__anatomy-table-view.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-selection |
| website__components__docs__anatomy__branch.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-tree-selection |
| website__components__docs__keyboard-table.tsrx.0.css | lightningcss; lightningcss-wasm | 3 errors, first: Unknown at rule: @keyboard-inspection |
| foundation.css | lightningcss; lightningcss-wasm | 1 error, first: Invalid media query |

## Methodology

- **Corpus.** 252 style sheets from the Markless repository ([test/corpus](../test/corpus)); 13 files from npm packages, pinned by version and checked by SHA-256; 4 generated stress files: deep nesting, a long selector list, huge custom properties, and many at-rules. `node bench/corpus.ts` fetches and generates them ([bench/corpus.ts](../bench/corpus.ts)).
- **Processes.** Each measurement runs in a fresh process, 3 times, with the runs of every configuration taking turns. A file's time is the median over runs of its median; its p95 is the median over runs of its 95th percentile.
- **Sampling.** A process first parses its files in turn for at least a second, so the JIT has compiled the hot paths. It then parses each file for 6 ms more and samples it for 30 ms and at least 10 samples (half that in the browser). A sample times enough parses to last 20 µs (500 µs in the browser), so the clock's cost and precision do not count.
- **Smallest first.** A process times its files a size bucket at a time, from the smallest, warming each bucket up first. css-tree resets its token buffers in full on every parse (`balance.fill(0)` in its `TokenStream`), and they keep the size of the largest source it has parsed: in a one-off check, `.a { color: red }` took 1.4 µs to parse before a 3.6 MB file and 60 µs after. Timing small files after large ones would charge css-tree for that.
- **Per file** is the sum of the files' medians over the number of files, as in the README chart. **MB/s** is the files' bytes over that sum.
- **Same work.** css-tree runs with `parseValue`, `parseAtrulePrelude`, and `parseCustomProperty` off to build what yuku-css builds. Its defaults turn the first two on and positions off. Each library is called through one adapter in [bench/adapters.ts](../bench/adapters.ts), so after an API change only the adapter changes.
- **Lightning CSS** has no parse-only API in JS. It is timed calling `transform({ filename, code, minify: false })`, which parses into typed structures, values included, and prints CSS back with no minifying and no targets, so nothing is lowered. Encoding the source string to bytes is part of the timed call, as it is in yuku-css's `parse`.

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 |
| Runtimes | Node.js 24.15.0, Bun 1.3.14, Chromium 156.0.8078.4 |
| Libraries | yuku-css 0.1.0 (5a88225), css-tree 3.2.1 |
| Duration | 22 min: modes 0 s, gate 7 s, parse 716 s, tokenize 72 s, phases 187 s, cold 31 s, memory 66 s, bundle 19 s, browser 200 s |

## Caveats

- The trees are not identical even when the work is the same: yuku-css keeps compound selectors as nodes and trims custom property values; css-tree keeps comments and empty statements. [test/parity.test.ts](../test/parity.test.ts) lists every difference.
- css-tree reads a nested rule that starts with a type selector, such as `html.dark & {}`, as a declaration and reports an error, which is why it leaves out most of the Markless files it does.
- css-tree is imported from its main entry, which also loads its lexer and syntax data. `css-tree/parser` loads less; its bundle size is listed.
- yuku-css's WebAssembly memory grows to fit the largest file it has parsed and does not shrink until it has passed 128 MB and a small file comes, so its external memory is a high-water mark.
- One machine, one run of the suite: differences under about 5% are noise.
