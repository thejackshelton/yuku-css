# Benchmark

yuku-css 0.1.0 (54481a0) against [Lightning CSS](https://lightningcss.dev) 1.33.0, its fastest rival, and [css-tree](https://github.com/csstree/csstree) 3.2.1, whose tree it builds, with [PostCSS](https://postcss.org) for context, on an Apple M5 Pro, 2026-10-13. Run it with `bun run bench:full`; the raw data is in [bench/results/2026-10-13.json](../bench/results/2026-10-13.json).

## Against Lightning CSS

Lightning CSS returns no tree to JS. Its `transform({ filename, code, minify: false })` parses every value into typed Rust structures and prints CSS back. The closest yuku-css comes is parsing and then printing its own tree with `yuku-css/codegen`, values kept raw, so neither side does exactly the other's work: Lightning CSS types every value, which yuku-css does not, and yuku-css builds a JS tree, which Lightning CSS does not. yuku-css parsing alone is listed too, as less work. Lightning CSS runs as its native Node.js addon and as `lightningcss-wasm`; in Chromium only the WebAssembly runs.

### By size

Throughput on the 264 files that yuku-css and both builds of Lightning CSS parse cleanly. The last column sets yuku-css parsing and printing against Lightning CSS's addon, or in Chromium its WebAssembly.

| Runtime | Size | Files | yuku-css, parse and print | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css, parse and print, vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 129 | 102.3 MB/s | 163.2 MB/s | 46.9 MB/s | 19.2 MB/s | 2.18× faster |
| Node.js 24.15.0 | 1–10 KB | 117 | 103.3 MB/s | 171.7 MB/s | 63.6 MB/s | 11.5 MB/s | 1.62× faster |
| Node.js 24.15.0 | 10–100 KB | 7 | 105.5 MB/s | 184.8 MB/s | 84.7 MB/s | 2.8 MB/s | 1.25× faster |
| Node.js 24.15.0 | 100 KB–1 MB | 8 | 76.2 MB/s | 136.9 MB/s | 50.0 MB/s | 19.7 MB/s | 1.52× faster |
| Node.js 24.15.0 | > 1 MB | 3 | 89.2 MB/s | 145.1 MB/s | 61.6 MB/s | 26.5 MB/s | 1.45× faster |
| Bun 1.3.14 | < 1 KB | 129 | 115.7 MB/s | 189.0 MB/s | 59.0 MB/s | 15.3 MB/s | 1.96× faster |
| Bun 1.3.14 | 1–10 KB | 117 | 111.4 MB/s | 190.6 MB/s | 70.1 MB/s | 14.4 MB/s | 1.59× faster |
| Bun 1.3.14 | 10–100 KB | 7 | 109.6 MB/s | 196.8 MB/s | 86.9 MB/s | 19.5 MB/s | 1.26× faster |
| Bun 1.3.14 | 100 KB–1 MB | 8 | 88.0 MB/s | 158.6 MB/s | 48.4 MB/s | 12.7 MB/s | 1.82× faster |
| Bun 1.3.14 | > 1 MB | 3 | 101.5 MB/s | 181.8 MB/s | 62.8 MB/s | 16.1 MB/s | 1.62× faster |
| Chromium 156.0.8078.4 | < 1 KB | 129 | 109.0 MB/s | 164.4 MB/s | – | 20.9 MB/s | 5.21× faster |
| Chromium 156.0.8078.4 | 1–10 KB | 117 | 115.1 MB/s | 175.4 MB/s | – | 24.8 MB/s | 4.64× faster |
| Chromium 156.0.8078.4 | 10–100 KB | 7 | 121.4 MB/s | 192.2 MB/s | – | 30.1 MB/s | 4.04× faster |
| Chromium 156.0.8078.4 | 100 KB–1 MB | 8 | 87.4 MB/s | 151.2 MB/s | – | 23.7 MB/s | 3.69× faster |
| Chromium 156.0.8078.4 | > 1 MB | 3 | 108.0 MB/s | 169.3 MB/s | – | 29.0 MB/s | 3.73× faster |

![Throughput by file size against Lightning CSS on Node.js 24.15.0](benchmark/lightning.svg)

### Large real files

Median time per parse, MB/s in parentheses. A dash marks a parse that reported errors, with the first error below.

| File | Size | Runtime | yuku-css, parse and print | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css, parse and print, vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tailwind.css | 3557.0 KB | Node.js 24.15.0 | 32.58 ms (111.8 MB/s) | 20.58 ms (177.0 MB/s) | 56.58 ms (64.4 MB/s) | 128.08 ms (28.4 MB/s) | 1.74× faster |
| tailwind.css | 3557.0 KB | Bun 1.3.14 | 31.40 ms (116.0 MB/s) | 17.00 ms (214.3 MB/s) | 54.70 ms (66.6 MB/s) | 197.10 ms (18.5 MB/s) | 1.74× faster |
| tailwind.css | 3557.0 KB | Chromium 156.0.8078.4 | 27.63 ms (131.8 MB/s) | 17.85 ms (204.1 MB/s) | – | 120.68 ms (30.2 MB/s) | 4.37× faster |
| tailwind.min.css | 2865.3 KB | Node.js 24.15.0 | 29.81 ms (98.4 MB/s) | 18.83 ms (155.8 MB/s) | 53.52 ms (54.8 MB/s) | 126.95 ms (23.1 MB/s) | 1.80× faster |
| tailwind.min.css | 2865.3 KB | Bun 1.3.14 | 25.11 ms (116.9 MB/s) | 13.94 ms (210.5 MB/s) | 53.08 ms (55.3 MB/s) | 186.32 ms (15.7 MB/s) | 2.11× faster |
| tailwind.min.css | 2865.3 KB | Chromium 156.0.8078.4 | 24.98 ms (117.5 MB/s) | 16.25 ms (180.6 MB/s) | – | 110.04 ms (26.7 MB/s) | 4.41× faster |
| bulma.css | 745.3 KB | Node.js 24.15.0 | 6.45 ms (118.3 MB/s) | 3.63 ms (210.5 MB/s) | 10.19 ms (74.9 MB/s) | 23.05 ms (33.1 MB/s) | 1.58× faster |
| bulma.css | 745.3 KB | Bun 1.3.14 | 6.29 ms (121.3 MB/s) | 3.54 ms (215.8 MB/s) | 9.68 ms (78.8 MB/s) | 34.95 ms (21.8 MB/s) | 1.54× faster |
| bulma.css | 745.3 KB | Chromium 156.0.8078.4 | 5.97 ms (127.9 MB/s) | 3.55 ms (214.7 MB/s) | – | 22.66 ms (33.7 MB/s) | 3.80× faster |
| primer.css | 728.0 KB | Node.js 24.15.0 | 5.55 ms (134.3 MB/s) | 3.25 ms (229.5 MB/s) | – | – | – |
| primer.css | 728.0 KB | Bun 1.3.14 | 5.97 ms (124.9 MB/s) | 3.05 ms (244.7 MB/s) | – | – | – |
| primer.css | 728.0 KB | Chromium 156.0.8078.4 | 4.94 ms (150.9 MB/s) | 3.13 ms (237.8 MB/s) | – | – | – |
| bootstrap.css | 274.5 KB | Node.js 24.15.0 | 2.98 ms (94.3 MB/s) | 1.91 ms (147.2 MB/s) | 3.83 ms (73.4 MB/s) | 8.61 ms (32.7 MB/s) | 1.28× faster |
| bootstrap.css | 274.5 KB | Bun 1.3.14 | 2.67 ms (105.2 MB/s) | 1.90 ms (148.0 MB/s) | 3.76 ms (74.8 MB/s) | 14.65 ms (19.2 MB/s) | 1.41× faster |
| bootstrap.css | 274.5 KB | Chromium 156.0.8078.4 | 2.73 ms (103.1 MB/s) | 1.89 ms (148.7 MB/s) | – | 8.62 ms (32.6 MB/s) | 3.16× faster |
| bootstrap.min.css | 227.3 KB | Node.js 24.15.0 | 2.81 ms (82.8 MB/s) | 1.67 ms (139.2 MB/s) | 3.69 ms (63.1 MB/s) | 8.33 ms (27.9 MB/s) | 1.31× faster |
| bootstrap.min.css | 227.3 KB | Bun 1.3.14 | 2.70 ms (86.1 MB/s) | 1.68 ms (138.3 MB/s) | 3.27 ms (71.3 MB/s) | 14.16 ms (16.4 MB/s) | 1.21× faster |
| bootstrap.min.css | 227.3 KB | Chromium 156.0.8078.4 | 2.57 ms (90.8 MB/s) | 1.65 ms (141.1 MB/s) | – | 8.11 ms (28.7 MB/s) | 3.16× faster |
| foundation.css | 164.1 KB | Node.js 24.15.0 | 2.12 ms (79.4 MB/s) | 1.38 ms (121.7 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Bun 1.3.14 | 2.22 ms (75.6 MB/s) | 1.38 ms (121.9 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Chromium 156.0.8078.4 | 1.91 ms (88.1 MB/s) | 1.35 ms (124.7 MB/s) | – | – | – |
| font-awesome.css | 129.5 KB | Node.js 24.15.0 | 1.40 ms (94.4 MB/s) | 881.0 µs (150.6 MB/s) | 2.09 ms (63.3 MB/s) | 4.84 ms (27.4 MB/s) | 1.49× faster |
| font-awesome.css | 129.5 KB | Bun 1.3.14 | 1.39 ms (95.3 MB/s) | 964.1 µs (137.6 MB/s) | 1.95 ms (68.0 MB/s) | 9.28 ms (14.3 MB/s) | 1.40× faster |
| font-awesome.css | 129.5 KB | Chromium 156.0.8078.4 | 1.19 ms (111.5 MB/s) | 815.0 µs (162.8 MB/s) | – | 4.65 ms (28.5 MB/s) | 3.91× faster |

Lightning CSS reports errors on primer.css (6 errors, first: Unknown at rule: @custom-media) and foundation.css (1 error, first: Invalid media query).

### Per call

What one call costs when there is next to nothing to parse, so a lead on small files is not read as a lead in throughput. Median time per call.

| File | Runtime | yuku-css, parse and print | yuku-css, parse only | yuku-css, positions | css-tree, positions | lightningcss | lightningcss-wasm | postcss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty.css (0 B) | Node.js 24.15.0 | 0.5 µs | 0.4 µs | 0.4 µs | 0.4 µs | 2.3 µs | 3.1 µs | 0.2 µs |
| empty.css (0 B) | Bun 1.3.14 | 0.2 µs | 0.2 µs | 0.3 µs | 0.7 µs | 1.1 µs | 3.6 µs | 0.1 µs |
| empty.css (0 B) | Chromium 156.0.8078.4 | 0.5 µs | 0.4 µs | 0.4 µs | 0.4 µs | – | 3.3 µs | 0.1 µs |
| tiny.css (18 B) | Node.js 24.15.0 | 0.8 µs | 0.6 µs | 0.7 µs | 1.4 µs | 2.5 µs | 5.8 µs | 0.6 µs |
| tiny.css (18 B) | Bun 1.3.14 | 0.6 µs | 0.5 µs | 0.6 µs | 0.9 µs | 1.7 µs | 6.8 µs | 0.7 µs |
| tiny.css (18 B) | Chromium 156.0.8078.4 | 0.9 µs | 0.7 µs | 0.8 µs | 1.0 µs | – | 5.6 µs | 0.6 µs |

On Node.js 24.15.0, a call on an empty file costs yuku-css 0.5 µs to parse and print and the Lightning CSS addon 2.3 µs, so on the smallest files part of yuku-css's lead is the cost of a call.

### Where yuku-css wins

- On Node.js 24.15.0, parsing and printing beats the addon on every size of file, by 1.25× to 2.18×.
- On Bun 1.3.14, parsing and printing beats the addon on every size of file, by 1.26× to 1.96×.
- On Chromium 156.0.8078.4, parsing and printing beats `lightningcss-wasm` on every size of file, by 3.69× to 5.21×.
- A browser downloads 55.5 KB gzipped to parse and print with yuku-css, against 3670.3 KB for `lightningcss-wasm`.

### Where yuku-css loses

- On Node.js 24.15.0, parsing and printing is slower than the addon on long-selector-list.css (1.68×).
- On Bun 1.3.14, parsing and printing is slower than the addon on long-selector-list.css (1.35×).
- In a fresh Node.js 24.15.0 process, loading the library and parsing and printing bootstrap.css once takes yuku-css 15.66 ms, compiling its WebAssembly included, and the Lightning CSS addon 7.52 ms.
- Lightning CSS does more with the time: it types every value, so it can minify, lower syntax for older browsers and report invalid values, none of which yuku-css does. Its output is a normalized style sheet, where yuku-css prints its tree as written.

## Summary

On 228 Markless style sheets, yuku-css parses a file in 13.0 µs on Node.js 24.15.0, 2.90× faster than css-tree building the same tree: selectors parsed, values and at-rule preludes kept raw, positions on; 1.18× on Bun 1.3.14, and 1.83× in Chromium. Over all 248 files both parse cleanly, 12.0 MB of CSS, it reads 98.4 MB/s against css-tree's 31.6 MB/s; the lead is widest on files of > 1 MB (3.23×) and narrowest on 10–100 KB (2.66×). css-tree's defaults, which also parse values, take 3.11× as long, and Lightning CSS's native addon, which parses values into typed structures and prints CSS back, 1.94×. Printing css-tree's own tree back to CSS, `yuku-css/codegen` takes 242.1 µs a file against css-tree's 617.7 µs (2.55×), and with a source map 520.1 µs against 1467.5 µs (2.82×). Its `tokenize` takes 139.9 µs a file against css-tree's 260.2 µs (1.86×). Where yuku-css loses: on long-selector-list.css on Node.js 24.15.0, lightningcss (1.24×) and postcss (1.04×) parse faster; on empty.css on Node.js 24.15.0, postcss (2.57×) parse faster; on tiny.css on Node.js 24.15.0, postcss (1.20×) parse faster; on normalize.css on Bun 1.3.14, css-tree, defaults (1.31×) parse faster; on preflight.css on Bun 1.3.14, css-tree, defaults (1.09×) parse faster; on pure.css on Bun 1.3.14, css-tree, defaults (1.13×) parse faster; on font-awesome.css on Bun 1.3.14, css-tree, same work (1.18×) and css-tree, defaults (1.24×) parse faster; on foundation.css on Bun 1.3.14, css-tree, same work (1.18×) and css-tree, defaults (1.33×) parse faster; on bootstrap.css on Bun 1.3.14, css-tree, same work (1.13×) and css-tree, defaults (1.23×) parse faster; on tailwind.css on Bun 1.3.14, css-tree, same work (1.05×) and css-tree, defaults (1.23×) parse faster; on deep-nesting.css on Bun 1.3.14, css-tree, defaults (1.08×) parse faster; on long-selector-list.css on Bun 1.3.14, css-tree, defaults (1.04×) and lightningcss (1.08×) parse faster; on empty.css on Bun 1.3.14, postcss (2.08×) parse faster; it holds more memory outside the JS heap: after parsing tailwind.css its WebAssembly memory has grown to 191.8 MB, and on files of 100 KB or more its peak resident memory is a median 1.35× css-tree's, though its tree retains 0.89× the JS heap css-tree's does; `css-tree/parser` (12.6 KB) and `postcss` (17.2 KB) download less than its 50.2 KB gzipped.

![Time per file to parse the Markless corpus on Node.js 24.15.0](benchmark/corpus.svg)

Median time per file, 228 Markless files, Node.js 24.15.0.

## Parse time

Each row says the work it does. Only rows marked the same as yuku-css build what yuku-css builds; the others are context.

### Markless corpus, 228 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values raw, positions | 13.0 µs | 15.5 µs |  | 12.3 µs | 15.9 µs |  |
| yuku-css, values raw, no positions | values raw, no positions; start and end offsets | 9.1 µs | 10.4 µs |  | 8.2 µs | 9.5 µs |  |
| yuku-css print | values raw, no positions; parses, values raw, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 15.0 µs | 17.3 µs | 1.16× | 13.9 µs | 17.1 µs | 1.13× |
| css-tree, same work | values raw, positions (same as yuku-css) | 37.5 µs | 42.5 µs | 2.90× | 14.5 µs | 18.1 µs | 1.18× |
| css-tree, values raw, no positions | values raw, no positions (same as yuku-css, less its start and end offsets) | 33.2 µs | 37.3 µs | 3.64× | 11.3 µs | 13.5 µs | 1.38× |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 42.7 µs | 49.0 µs | 3.30× | 18.3 µs | 22.2 µs | 1.49× |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 40.3 µs | 46.1 µs | 3.11× | 14.2 µs | 16.9 µs | 1.15× |
| lightningcss | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 25.2 µs | 31.8 µs | 1.94× | 22.4 µs | 27.3 µs | 1.82× |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 116.1 µs | 5648.4 µs | 8.97× | 105.7 µs | 343.0 µs | 8.62× |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 20.0 µs | 22.9 µs | 1.54× | 26.4 µs | 36.8 µs | 2.15× |

### All files, 242 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values raw, positions | 475.6 µs | 716.3 µs |  | 425.8 µs | 480.4 µs |  |
| yuku-css, values raw, no positions | values raw, no positions; start and end offsets | 319.0 µs | 363.6 µs |  | 261.4 µs | 299.7 µs |  |
| yuku-css print | values raw, no positions; parses, values raw, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 534.3 µs | 563.5 µs | 1.12× | 469.3 µs | 525.3 µs | 1.10× |
| css-tree, same work | values raw, positions (same as yuku-css) | 1475.4 µs | 1694.4 µs | 3.10× | 495.6 µs | 656.6 µs | 1.16× |
| css-tree, values raw, no positions | values raw, no positions (same as yuku-css, less its start and end offsets) | 1077.0 µs | 1126.2 µs | 3.38× | 382.4 µs | 471.9 µs | 1.46× |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 1673.1 µs | 1948.1 µs | 3.52× | 557.4 µs | 787.9 µs | 1.31× |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 1122.2 µs | 1174.1 µs | 2.36× | 424.9 µs | 527.2 µs | 1.00× |
| lightningcss | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 789.2 µs | 838.4 µs | 1.66× | 785.7 µs | 830.6 µs | 1.84× |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 2160.8 µs | 7975.4 µs | 4.54× | 3088.8 µs | 3563.9 µs | 7.25× |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 932.7 µs | 1110.6 µs | 1.96× | 941.4 µs | 1122.5 µs | 2.21× |

### By size

Throughput on Node.js 24.15.0, by file size, on the 248 files both yuku-css and css-tree parse cleanly, less any a context parser leaves out.

| Size | Files | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| < 1 KB | 125 | 120.7 MB/s | 42.1 MB/s | 39.6 MB/s | 46.5 MB/s | 19.0 MB/s | 81.0 MB/s | 2.87× |
| 1–10 KB | 107 | 118.4 MB/s | 40.7 MB/s | 38.0 MB/s | 63.6 MB/s | 12.7 MB/s | 75.6 MB/s | 2.91× |
| 10–100 KB | 4 | 123.0 MB/s | 46.3 MB/s | 42.0 MB/s | 96.0 MB/s | 3.2 MB/s | 85.6 MB/s | 2.66× |
| 100 KB–1 MB | 9 | 106.8 MB/s | 36.5 MB/s | 36.7 MB/s | 48.8 MB/s | 19.2 MB/s | 47.4 MB/s | 2.93× |
| > 1 MB | 3 | 93.0 MB/s | 28.8 MB/s | 42.0 MB/s | 61.6 MB/s | 26.5 MB/s | 50.1 MB/s | 3.23× |

![Throughput by file size on Node.js 24.15.0](benchmark/buckets.svg)

### Real-world CSS from npm

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normalize.css | 6.0 KB | 31.0 µs (34.5 µs) | 80.3 µs (97.6 µs) | 66.7 µs (81.9 µs) | 38.6 µs (44.2 µs) | 169.0 µs (15.56 ms) | 47.1 µs (50.2 µs) | 2.59× |
| preflight.css | 7.6 KB | 39.2 µs (43.8 µs) | 101.8 µs (117.9 µs) | 92.7 µs (115.0 µs) | 55.1 µs (66.2 µs) | 231.3 µs (19.66 ms) | 59.1 µs (63.5 µs) | 2.60× |
| pure.css | 25.6 KB | 194.1 µs (239.4 µs) | 554.1 µs (613.7 µs) | 494.0 µs (592.1 µs) | 248.9 µs (295.0 µs) | 10.73 ms (29.32 ms) | 261.5 µs (314.0 µs) | 2.85× |
| github-markdown.css | 28.7 KB | 230.8 µs (321.4 µs) | 650.7 µs (725.8 µs) | 619.3 µs (699.6 µs) | 338.3 µs (399.5 µs) | 14.85 ms (26.33 ms) | 302.3 µs (364.4 µs) | 2.82× |
| animate.css | 93.1 KB | 790.8 µs (949.4 µs) | 1.97 ms (2.16 ms) | 2.42 ms (2.83 ms) | 926.4 µs (1.04 ms) | 24.98 ms (26.59 ms) | 1.20 ms (1.36 ms) | 2.50× |
| font-awesome.css | 129.5 KB | 1.64 ms (2.10 ms) | 3.73 ms (4.00 ms) | 3.53 ms (4.02 ms) | 2.09 ms (2.36 ms) | 4.84 ms (4.96 ms) | 1.93 ms (2.56 ms) | 2.27× |
| foundation.css | 164.1 KB | 2.28 ms (2.58 ms) | 4.46 ms (4.80 ms) | 4.54 ms (5.04 ms) | – | – | 2.45 ms (2.69 ms) | 1.96× |
| bootstrap.css | 274.5 KB | 3.34 ms (3.82 ms) | 6.42 ms (7.40 ms) | 6.38 ms (7.46 ms) | 3.83 ms (4.06 ms) | 8.61 ms (8.88 ms) | 4.04 ms (5.15 ms) | 1.92× |
| bootstrap.min.css | 227.3 KB | 2.10 ms (2.41 ms) | 5.07 ms (5.55 ms) | 5.63 ms (6.03 ms) | 3.69 ms (3.92 ms) | 8.33 ms (8.61 ms) | 2.45 ms (3.01 ms) | 2.42× |
| primer.css | 728.0 KB | 4.14 ms (5.57 ms) | 13.18 ms (13.95 ms) | – | – | – | 6.79 ms (7.71 ms) | 3.18× |
| bulma.css | 745.3 KB | 6.16 ms (7.37 ms) | 12.66 ms (13.64 ms) | 13.42 ms (14.42 ms) | 10.19 ms (10.71 ms) | 23.05 ms (23.89 ms) | 8.84 ms (9.39 ms) | 2.05× |
| tailwind.min.css | 2865.3 KB | 24.53 ms (38.66 ms) | 85.56 ms (101.74 ms) | 60.50 ms (63.23 ms) | 53.52 ms (56.12 ms) | 126.95 ms (146.07 ms) | 56.19 ms (63.29 ms) | 3.49× |
| tailwind.css | 3557.0 KB | 40.37 ms (62.67 ms) | 104.12 ms (116.37 ms) | 72.54 ms (73.33 ms) | 56.58 ms (60.00 ms) | 128.08 ms (160.31 ms) | 79.66 ms (89.34 ms) | 2.58× |

### Synthetic stress files

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deep-nesting.css | 393.6 KB | 7.26 ms (7.82 ms) | 19.86 ms (20.56 ms) | 18.76 ms (20.60 ms) | 13.05 ms (13.93 ms) | 43.19 ms (66.31 ms) | 10.34 ms (12.69 ms) | 2.73× |
| long-selector-list.css | 1033.0 KB | 17.14 ms (34.53 ms) | 75.16 ms (92.56 ms) | 48.93 ms (50.63 ms) | 13.82 ms (14.21 ms) | 33.06 ms (34.73 ms) | 16.51 ms (29.19 ms) | 4.38× |
| huge-custom-properties.css | 976.8 KB | 8.31 ms (8.83 ms) | 32.56 ms (34.81 ms) | 29.02 ms (29.57 ms) | 26.86 ms (28.49 ms) | 69.38 ms (70.99 ms) | 39.33 ms (46.76 ms) | 3.92× |
| many-at-rules.css | 673.4 KB | 6.12 ms (6.47 ms) | 23.04 ms (25.74 ms) | – | 12.07 ms (12.37 ms) | 25.28 ms (26.16 ms) | 16.90 ms (17.45 ms) | 3.77× |

## Cost per node

Every tree's nodes are counted the same way: each object with a string `type`, reached through fields and lists. yuku-css builds css-tree's tree, so with the same work the counts differ only where the two read CSS differently; css-tree with parsed values has a node for each value token; PostCSS has none below a rule's selector. Lightning CSS, and yuku-css when it prints, return no tree. Each row covers the files it parses cleanly.

| Parser | Files | Nodes | Node.js 24.15.0, ns per node | Bun 1.3.14, ns per node | Node.js 24.15.0, MB/s | Bun 1.3.14, MB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | 269 | 1,490,909 | 86.7 | 78.4 | 99.2 MB/s | 109.6 MB/s |
| yuku-css, values raw, no positions | 269 | 1,490,909 | 58.6 | 48.7 | 146.6 MB/s | 176.5 MB/s |
| css-tree, same work | 248 | 1,472,223 | 270.4 | 92.9 | 31.6 MB/s | 91.9 MB/s |
| css-tree, values raw, no positions | 248 | 1,472,223 | 199.9 | 71.8 | 42.7 MB/s | 118.9 MB/s |
| css-tree, values parsed, positions | 246 | 1,645,480 | 249.4 | 83.4 | 27.1 MB/s | 81.2 MB/s |
| css-tree, defaults | 246 | 1,645,480 | 168.1 | 63.5 | 40.3 MB/s | 106.5 MB/s |
| postcss | 269 | 336,882 | 754.3 | 779.6 | 50.4 MB/s | 48.8 MB/s |

## Where yuku-css spends its time

Its `parse` has three steps: encoding the source to UTF-8 in WebAssembly memory, parsing and serializing the tree in WebAssembly, and decoding the tree into JS objects. Each step is timed on its own (bench/yuku-phases.ts), per file, values raw, positions, over the files yuku-css parses cleanly.

| Runtime | Size | Encode | Parse and serialize | Decode | Sum | Whole parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 0.2 µs (6%) | 1.4 µs (52%) | 1.2 µs (42%) | 2.8 µs | 2.8 µs |
| Node.js 24.15.0 | 1–10 KB | 1.4 µs (5%) | 13.5 µs (51%) | 11.5 µs (43%) | 26.4 µs | 26.7 µs |
| Node.js 24.15.0 | 10–100 KB | 10.5 µs (4%) | 128.7 µs (51%) | 111.0 µs (44%) | 250.2 µs | 260.6 µs |
| Node.js 24.15.0 | 100 KB–1 MB | 234.9 µs (5%) | 2.41 ms (56%) | 1.64 ms (38%) | 4.29 ms | 4.18 ms |
| Node.js 24.15.0 | > 1 MB | 901.1 µs (2%) | 10.93 ms (30%) | 24.66 ms (68%) | 36.49 ms | 27.35 ms |
| Node.js 24.15.0 | All | 19.7 µs (3%) | 221.6 µs (38%) | 344.6 µs (59%) | 586.0 µs | 480.5 µs |
| Bun 1.3.14 | < 1 KB | 0.0 µs (1%) | 1.3 µs (53%) | 1.2 µs (46%) | 2.5 µs | 2.6 µs |
| Bun 1.3.14 | 1–10 KB | 0.1 µs (1%) | 12.6 µs (52%) | 11.5 µs (48%) | 24.2 µs | 25.2 µs |
| Bun 1.3.14 | 10–100 KB | 0.5 µs (0%) | 119.2 µs (52%) | 111.7 µs (48%) | 231.5 µs | 249.1 µs |
| Bun 1.3.14 | 100 KB–1 MB | 19.2 µs (1%) | 1.87 ms (55%) | 1.53 ms (45%) | 3.42 ms | 3.77 ms |
| Bun 1.3.14 | > 1 MB | 42.7 µs (0%) | 9.70 ms (47%) | 10.84 ms (53%) | 20.58 ms | 24.71 ms |
| Bun 1.3.14 | All | 1.3 µs (0%) | 187.2 µs (50%) | 186.4 µs (50%) | 374.8 µs | 434.8 µs |

## Tokenizing

yuku-css's `tokenize` returns every token packed into a `Uint32Array`, type and end offset, as css-tree packs its `offsetAndType`. css-tree's `tokenize` calls back once for each token, timed here counting them. Both on the 248 files yuku-css and css-tree parse cleanly.

| Runtime | Tokenizer | Per file | MB/s | vs yuku-css | Share of its same-work parse |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 139.9 µs | 362.3 MB/s |  | 27% |
| Node.js 24.15.0 | css-tree | 260.2 µs | 194.8 MB/s | 1.86× | 16% |
| Bun 1.3.14 | yuku-css | 107.6 µs | 471.3 MB/s |  | 23% |
| Bun 1.3.14 | css-tree | 206.8 µs | 245.1 MB/s | 1.92× | 38% |

## Printing

`generate` from `yuku-css/codegen` against css-tree's `generate`, both printing css-tree's own tree of each file, values parsed and positions on, built before timing. Both print the same bytes; with `sourceMap: true` each also builds a source map, timed through `map.toString()`. On the 246 files css-tree parses cleanly that way.

| Runtime | Printer | Per file | MB/s | vs yuku-css |
| --- | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 242.1 µs | 187.0 MB/s |  |
| Node.js 24.15.0 | yuku-css, source map | 520.1 µs | 87.0 MB/s |  |
| Node.js 24.15.0 | css-tree | 617.7 µs | 73.3 MB/s | 2.55× |
| Node.js 24.15.0 | css-tree, source map | 1467.5 µs | 30.9 MB/s | 2.82× |
| Bun 1.3.14 | yuku-css | 146.9 µs | 308.2 MB/s |  |
| Bun 1.3.14 | yuku-css, source map | 300.6 µs | 150.6 MB/s |  |
| Bun 1.3.14 | css-tree | 400.7 µs | 113.0 MB/s | 2.73× |
| Bun 1.3.14 | css-tree, source map | 746.4 µs | 60.7 MB/s | 2.48× |

![Time per file to print css-tree's tree on Node.js 24.15.0](benchmark/generate.svg)

## Cold start

The median of 10 fresh processes. Load is the `import` of the library, which for yuku-css includes compiling its WebAssembly. First and second are the first two parses in that process. Warm is the median from the parse timings.

| Runtime | File | Parser | Load | First parse | Second parse | Warm parse | Load and first parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 2.76 ms | 1.48 ms | 75.1 µs | 6.4 µs | 4.22 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 3.30 ms | 1.81 ms | 122.2 µs | 7.7 µs | 5.26 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 23.40 ms | 1.10 ms | 177.6 µs | 18.6 µs | 24.55 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.55 ms | 357.8 µs | 37.0 µs | 19.4 µs | 2.93 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 13.76 ms | 69.49 ms | 727.3 µs | 43.8 µs | 83.69 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 6.94 ms | 1.23 ms | 125.9 µs | 11.0 µs | 8.14 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css | 2.55 ms | 10.37 ms | 7.48 ms | 3.34 ms | 13.01 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css print | 3.23 ms | 12.19 ms | 7.68 ms | 2.98 ms | 15.66 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | css-tree | 23.88 ms | 19.41 ms | 10.01 ms | 6.42 ms | 43.02 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss | 2.44 ms | 5.16 ms | 4.28 ms | 3.83 ms | 7.52 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss-wasm | 13.91 ms | 112.02 ms | 21.96 ms | 8.61 ms | 126.27 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | postcss | 6.87 ms | 13.63 ms | 10.07 ms | 4.04 ms | 20.32 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 3.76 ms | 1.44 ms | 275.1 µs | 5.9 µs | 5.17 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 5.24 ms | 1.82 ms | 334.9 µs | 6.6 µs | 7.03 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 12.34 ms | 1.63 ms | 369.4 µs | 7.6 µs | 13.85 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.78 ms | 404.2 µs | 36.6 µs | 15.2 µs | 3.17 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 21.96 ms | 5.07 ms | 2.64 ms | 59.5 µs | 27.13 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 10.95 ms | 1.59 ms | 322.2 µs | 12.7 µs | 12.67 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css | 3.88 ms | 10.27 ms | 6.37 ms | 2.97 ms | 14.04 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css print | 5.70 ms | 12.28 ms | 5.94 ms | 2.67 ms | 18.00 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | css-tree | 12.56 ms | 12.61 ms | 6.53 ms | 2.63 ms | 24.96 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss | 3.01 ms | 4.77 ms | 3.97 ms | 3.76 ms | 7.70 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss-wasm | 23.33 ms | 63.76 ms | 33.13 ms | 14.65 ms | 86.95 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | postcss | 10.64 ms | 12.18 ms | 8.01 ms | 5.62 ms | 22.84 ms |

![Load and first parse in a fresh Node.js 24.15.0 process](benchmark/cold.svg)

## Memory

Each file of 100 KB or more, parsed in a fresh Node.js 24.15.0 process run with `--expose-gc`, median of 3. Heap is the JS heap the tree retains after a full GC. External is memory outside the JS heap, such as WebAssembly memory, which only grows. Peak is how far resident memory rose during the parse. Negative readings, which are noise, show as 0.

| File | Size | yuku-css: heap / external / peak | css-tree, same work: heap / external / peak | css-tree, defaults: heap / external / peak | lightningcss: heap / external / peak | lightningcss-wasm: heap / external / peak | postcss: heap / external / peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| website__styles__global.css | 120.5 KB | 0.7 MB / 6.4 MB / 3.2 MB | – | – | 0.0 MB / 0.2 MB / 2.4 MB | 0.2 MB / 0.0 MB / 103.1 MB | 0.9 MB / 0.0 MB / 0.6 MB |
| font-awesome.css | 129.5 KB | 4.7 MB / 7.2 MB / 9.8 MB | 5.5 MB / 2.0 MB / 6.9 MB | 3.1 MB / 1.0 MB / 4.8 MB | 0.0 MB / 0.2 MB / 6.4 MB | 0.1 MB / 0.0 MB / 91.8 MB | 3.7 MB / 0.0 MB / 10.9 MB |
| foundation.css | 164.1 KB | 4.7 MB / 11.2 MB / 12.6 MB | 5.6 MB / 2.6 MB / 8.2 MB | 3.6 MB / 1.3 MB / 6.4 MB | – | – | 4.0 MB / 0.0 MB / 11.8 MB |
| bootstrap.css | 274.5 KB | 6.3 MB / 21.7 MB / 14.2 MB | 7.1 MB / 4.3 MB / 12.0 MB | 4.6 MB / 2.1 MB / 8.2 MB | 0.0 MB / 0.5 MB / 7.8 MB | 0.2 MB / 0.0 MB / 133.1 MB | 5.9 MB / 0.0 MB / 16.7 MB |
| bootstrap.min.css | 227.3 KB | 6.2 MB / 11.7 MB / 14.5 MB | 7.1 MB / 3.6 MB / 10.4 MB | 4.5 MB / 1.8 MB / 8.0 MB | 0.0 MB / 0.5 MB / 8.1 MB | 0.2 MB / 0.0 MB / 128.4 MB | 5.3 MB / 0.0 MB / 16.9 MB |
| primer.css | 728.0 KB | 13.0 MB / 45.7 MB / 31.8 MB | 14.6 MB / 11.4 MB / 21.3 MB | – | – | – | 12.9 MB / 0.0 MB / 32.0 MB |
| bulma.css | 745.3 KB | 11.1 MB / 45.7 MB / 31.0 MB | 12.6 MB / 11.6 MB / 20.3 MB | 8.4 MB / 5.8 MB / 12.7 MB | 0.0 MB / 1.4 MB / 15.7 MB | 0.2 MB / 0.0 MB / 203.5 MB | 11.2 MB / 0.0 MB / 30.1 MB |
| tailwind.min.css | 2865.3 KB | 77.9 MB / 191.8 MB / 139.9 MB | 86.5 MB / 44.5 MB / 136.8 MB | 53.4 MB / 22.3 MB / 72.5 MB | 0.0 MB / 6.2 MB / 92.1 MB | 0.2 MB / 48.7 MB / 521.7 MB | 71.6 MB / 0.0 MB / 154.4 MB |
| tailwind.css | 3557.0 KB | 78.2 MB / 191.8 MB / 136.2 MB | 86.8 MB / 55.3 MB / 145.7 MB | 53.7 MB / 27.7 MB / 87.7 MB | 0.0 MB / 6.9 MB / 85.5 MB | 0.2 MB / 47.4 MB / 573.4 MB | 52.6 MB / 0.0 MB / 181.0 MB |
| deep-nesting.css | 393.6 KB | 28.0 MB / 29.7 MB / 61.7 MB | 31.8 MB / 5.9 MB / 47.4 MB | 15.6 MB / 3.1 MB / 20.0 MB | 0.0 MB / 2.0 MB / 32.5 MB | 0.0 MB / 6.3 MB / 235.5 MB | 12.5 MB / 0.0 MB / 50.1 MB |
| long-selector-list.css | 1033.0 KB | 60.8 MB / 67.7 MB / 105.1 MB | 70.6 MB / 15.9 MB / 88.8 MB | 31.7 MB / 7.9 MB / 52.3 MB | 0.0 MB / 2.0 MB / 17.8 MB | 0.0 MB / 0.0 MB / 30.3 MB | 15.7 MB / 0.0 MB / 62.3 MB |
| huge-custom-properties.css | 976.8 KB | 0.3 MB / 51.7 MB / 19.9 MB | 0.1 MB / 15.3 MB / 13.8 MB | 0.1 MB / 7.6 MB / 7.1 MB | 0.0 MB / 1.9 MB / 149.2 MB | 0.0 MB / 61.4 MB / 228.1 MB | 1.0 MB / 0.0 MB / 112.2 MB |
| many-at-rules.css | 673.4 KB | 20.5 MB / 45.7 MB / 44.3 MB | 22.3 MB / 10.3 MB / 40.1 MB | – | 0.0 MB / 1.3 MB / 31.0 MB | 0.1 MB / 4.3 MB / 229.5 MB | 18.8 MB / 0.0 MB / 49.5 MB |

## Bundle size

What a browser downloads to parse: the library bundled by [Rolldown](https://rolldown.rs) for the browser and minified, keeping only its parse function (`transform` for Lightning CSS, `generate` for `yuku-css/codegen`), plus any file it fetches beside the JS. yuku-css inlines its WebAssembly into the JS as base64. Lightning CSS's WebAssembly is a separate file; its native addon does not run in a browser.

| Entry | Minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `yuku-css` | 146.5 KB | 50.2 KB | 40.8 KB |
| `yuku-css/codegen` | 15.0 KB | 5.4 KB | 4.9 KB |
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
| yuku-css | values raw, positions | 12.8 µs | 14.0 µs |  | 94.2 MB/s |
| yuku-css, values raw, no positions | values raw, no positions; start and end offsets | 9.0 µs | 9.5 µs |  | 162.6 MB/s |
| yuku-css print | values raw, no positions; parses, values raw, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 13.6 µs | 14.3 µs | 1.06× | 100.6 MB/s |
| css-tree, same work | values raw, positions (same as yuku-css) | 23.4 µs | 25.8 µs | 1.83× | 50.9 MB/s |
| css-tree, values raw, no positions | values raw, no positions (same as yuku-css, less its start and end offsets) | 19.9 µs | 21.8 µs | 2.22× | 74.3 MB/s |
| css-tree, values parsed, positions | values parsed, positions (**not the same work**) | 25.7 µs | 29.4 µs | 2.01× | 47.3 MB/s |
| css-tree, defaults | values parsed, no positions (**not the same work**) | 21.9 µs | 24.3 µs | 1.71× | 73.8 MB/s |
| lightningcss-wasm | values parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 62.9 µs | 81.5 µs | 4.92× | 26.8 MB/s |
| postcss | values raw, positions; keeps selectors as strings (**not the same work**) | 17.8 µs | 20.7 µs | 1.39× | 59.1 MB/s |

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

- **Corpus.** 252 style sheets from the Markless repository ([test/corpus](../test/corpus)); 13 files from npm packages, pinned by version and checked by SHA-256; 4 generated stress files: deep nesting, a long selector list, huge custom properties, and many at-rules; and an empty file and a one-rule file, timed only for the cost of a call. `node bench/corpus.ts` fetches and generates them ([bench/corpus.ts](../bench/corpus.ts)).
- **Processes.** Each measurement runs in a fresh process, 3 times, with the runs of every configuration taking turns. A file's time is the median over runs of its median; its p95 is the median over runs of its 95th percentile.
- **Sampling.** A process first parses its files in turn for at least a second, so the JIT has compiled the hot paths. It then parses each file for 6 ms more and samples it for 30 ms and at least 10 samples (half that in the browser). A sample times enough parses to last 20 µs (500 µs in the browser), so the clock's cost and precision do not count.
- **Smallest first.** A process times its files a size bucket at a time, from the smallest, warming each bucket up first. css-tree resets its token buffers in full on every parse (`balance.fill(0)` in its `TokenStream`), and they keep the size of the largest source it has parsed: in a one-off check, `.a { color: red }` took 1.4 µs to parse before a 3.6 MB file and 60 µs after. Timing small files after large ones would charge css-tree for that.
- **Per file** is the sum of the files' medians over the number of files, as in the README chart. **MB/s** is the files' bytes over that sum.
- **Same work.** yuku-css and css-tree get the same options: `parseValue`, `parseAtrulePrelude`, and `parseCustomProperty` off, which is what yuku-css builds, and `positions` on, so both build css-tree's `loc` with lines and columns. css-tree's defaults turn the first two on and positions off. Without positions yuku-css still gives each node `start` and `end` offsets, so it does more than css-tree there. Each library is called through one adapter in [bench/adapters.ts](../bench/adapters.ts), so after an API change only the adapter changes.
- **Lightning CSS** has no parse-only API in JS. It is timed calling `transform({ filename, code, minify: false })`, which parses into typed structures, values included, and prints CSS back with no minifying and no targets, so nothing is lowered. Encoding the source string to bytes is part of the timed call, as it is in yuku-css's `parse`.

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 |
| Runtimes | Node.js 24.15.0, Bun 1.3.14, Chromium 156.0.8078.4 |
| Libraries | yuku-css 0.1.0 (54481a0), css-tree 3.2.1, lightningcss 1.33.0, postcss 8.5.30 |
| Duration | 32 min: modes 0 s, gate 8 s, parse 890 s, tokenize 145 s, generate 325 s, phases 192 s, cold 34 s, memory 80 s, bundle 21 s, browser 255 s |

## Caveats

- The trees are not identical even when the work is the same: where css-tree reads CSS otherwise than the CSS specifications, yuku-css follows the specifications, and it collects every comment, which css-tree does only when given `onComment`. [test/divergences.ts](../test/divergences.ts) lists every difference.
- css-tree reads a nested rule that starts with a type selector, such as `html.dark & {}`, as a declaration and reports an error, which is why it leaves out most of the Markless files it does.
- css-tree is imported from its main entry, which also loads its lexer and syntax data. `css-tree/parser` loads less; its bundle size is listed.
- yuku-css's WebAssembly memory grows to fit the largest file it has parsed and does not shrink until it has passed 128 MB and a small file comes, so its external memory is a high-water mark.
- One machine, one run of the suite: differences under about 5% are noise.
