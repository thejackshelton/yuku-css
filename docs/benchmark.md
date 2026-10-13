# Benchmark

yuku-css 0.1.0 (bd51648) against [Lightning CSS](https://lightningcss.dev) 1.33.0, its fastest rival, and [css-tree](https://github.com/csstree/csstree) 3.2.1, whose tree it builds, with [PostCSS](https://postcss.org) for context, on an Apple M5 Pro, 2026-10-13. Run it with `bun run bench:full`; the raw data is in [bench/results/2026-10-13.json](../bench/results/2026-10-13.json).

## Against Lightning CSS

Lightning CSS returns no tree to JS. Its `transform({ filename, code, minify: false })` parses every value into typed Rust structures and prints CSS back. yuku-css's `transform` does the same in kind: one WebAssembly call parses, values and at-rule preludes included, and prints CSS back, with no tree built in JS. The work still differs: Lightning CSS types every value, where yuku-css splits values and preludes into css-tree's untyped nodes, and Lightning CSS pretty-prints, where yuku-css prints compactly, as css-tree's `generate` does. yuku-css parsing with `parse` and printing with `generate` from `yuku-css/codegen`, which builds the JS tree in between, and parsing alone are listed too. Lightning CSS runs as its native Node.js addon and as `lightningcss-wasm`; in Chromium only the WebAssembly runs.

### By size

Throughput on the 264 files that yuku-css and both builds of Lightning CSS parse cleanly. The last column sets yuku-css's `transform` against Lightning CSS's addon, or in Chromium its WebAssembly.

| Runtime | Size | Files | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css `transform` vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 129 | 190.5 MB/s | 94.1 MB/s | 136.9 MB/s | 49.6 MB/s | 19.0 MB/s | 3.84× faster |
| Node.js 24.15.0 | 1–10 KB | 117 | 204.2 MB/s | 100.3 MB/s | 157.1 MB/s | 64.5 MB/s | 23.9 MB/s | 3.17× faster |
| Node.js 24.15.0 | 10–100 KB | 7 | 205.3 MB/s | 101.0 MB/s | 161.9 MB/s | 84.4 MB/s | 33.4 MB/s | 2.43× faster |
| Node.js 24.15.0 | 100 KB–1 MB | 8 | 217.8 MB/s | 88.1 MB/s | 190.2 MB/s | 51.8 MB/s | 22.1 MB/s | 4.20× faster |
| Node.js 24.15.0 | > 1 MB | 3 | 233.7 MB/s | 99.6 MB/s | 160.5 MB/s | 65.0 MB/s | 27.9 MB/s | 3.59× faster |
| Bun 1.3.14 | < 1 KB | 129 | 245.3 MB/s | 106.5 MB/s | 168.1 MB/s | 59.5 MB/s | 14.6 MB/s | 4.13× faster |
| Bun 1.3.14 | 1–10 KB | 117 | 273.1 MB/s | 101.1 MB/s | 181.8 MB/s | 68.8 MB/s | 13.7 MB/s | 3.97× faster |
| Bun 1.3.14 | 10–100 KB | 7 | 261.0 MB/s | 100.4 MB/s | 187.6 MB/s | 86.2 MB/s | 20.4 MB/s | 3.03× faster |
| Bun 1.3.14 | 100 KB–1 MB | 8 | 279.2 MB/s | 107.1 MB/s | 219.8 MB/s | 53.2 MB/s | 12.9 MB/s | 5.25× faster |
| Bun 1.3.14 | > 1 MB | 3 | 302.4 MB/s | 110.2 MB/s | 214.8 MB/s | 66.1 MB/s | 15.8 MB/s | 4.57× faster |
| Chromium 156.0.8078.4 | < 1 KB | 129 | 201.6 MB/s | 102.8 MB/s | 141.9 MB/s | – | 21.6 MB/s | 9.33× faster |
| Chromium 156.0.8078.4 | 1–10 KB | 117 | 232.8 MB/s | 114.4 MB/s | 168.6 MB/s | – | 27.0 MB/s | 8.61× faster |
| Chromium 156.0.8078.4 | 10–100 KB | 7 | 231.5 MB/s | 116.6 MB/s | 172.5 MB/s | – | 36.3 MB/s | 6.38× faster |
| Chromium 156.0.8078.4 | 100 KB–1 MB | 8 | 247.5 MB/s | 98.0 MB/s | 210.2 MB/s | – | 25.8 MB/s | 9.60× faster |
| Chromium 156.0.8078.4 | > 1 MB | 3 | 273.8 MB/s | 93.0 MB/s | 195.8 MB/s | – | 31.5 MB/s | 8.68× faster |

![Throughput by file size against Lightning CSS on Node.js 24.15.0](benchmark/lightning.svg)

### Large real files

Median time per parse, MB/s in parentheses. A dash marks a parse that reported errors, with the first error below.

| File | Size | Runtime | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | lightningcss | lightningcss-wasm | yuku-css `transform` vs Lightning CSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| tailwind.css | 3557.0 KB | Node.js 24.15.0 | 13.69 ms (266.0 MB/s) | 28.85 ms (126.3 MB/s) | 19.20 ms (189.7 MB/s) | 53.26 ms (68.4 MB/s) | 124.22 ms (29.3 MB/s) | 3.89× faster |
| tailwind.css | 3557.0 KB | Bun 1.3.14 | 10.58 ms (344.3 MB/s) | 27.24 ms (133.7 MB/s) | 14.51 ms (250.9 MB/s) | 52.44 ms (69.5 MB/s) | 199.76 ms (18.2 MB/s) | 4.96× faster |
| tailwind.css | 3557.0 KB | Chromium 156.0.8078.4 | 12.02 ms (302.9 MB/s) | 36.98 ms (98.5 MB/s) | 16.13 ms (225.9 MB/s) | – | 110.31 ms (33.0 MB/s) | 9.17× faster |
| tailwind.min.css | 2865.3 KB | Node.js 24.15.0 | 12.39 ms (236.8 MB/s) | 27.46 ms (106.9 MB/s) | 18.04 ms (162.6 MB/s) | 50.50 ms (58.1 MB/s) | 117.40 ms (25.0 MB/s) | 4.08× faster |
| tailwind.min.css | 2865.3 KB | Bun 1.3.14 | 9.49 ms (309.3 MB/s) | 26.77 ms (109.6 MB/s) | 13.49 ms (217.5 MB/s) | 49.98 ms (58.7 MB/s) | 193.16 ms (15.2 MB/s) | 5.27× faster |
| tailwind.min.css | 2865.3 KB | Chromium 156.0.8078.4 | 10.55 ms (278.0 MB/s) | 30.36 ms (96.7 MB/s) | 15.30 ms (191.8 MB/s) | – | 101.96 ms (28.8 MB/s) | 9.66× faster |
| bulma.css | 745.3 KB | Node.js 24.15.0 | 2.96 ms (257.6 MB/s) | 6.00 ms (127.2 MB/s) | 3.44 ms (222.0 MB/s) | 9.54 ms (80.0 MB/s) | 21.81 ms (35.0 MB/s) | 3.22× faster |
| bulma.css | 745.3 KB | Bun 1.3.14 | 2.04 ms (374.2 MB/s) | 5.06 ms (150.8 MB/s) | 2.62 ms (291.0 MB/s) | 8.79 ms (86.8 MB/s) | 34.28 ms (22.3 MB/s) | 4.31× faster |
| bulma.css | 745.3 KB | Chromium 156.0.8078.4 | 2.75 ms (277.8 MB/s) | 5.34 ms (142.8 MB/s) | 3.16 ms (241.7 MB/s) | – | 19.87 ms (38.4 MB/s) | 7.23× faster |
| primer.css | 728.0 KB | Node.js 24.15.0 | 2.68 ms (278.0 MB/s) | 5.39 ms (138.3 MB/s) | 3.13 ms (237.8 MB/s) | – | – | – |
| primer.css | 728.0 KB | Bun 1.3.14 | 2.05 ms (363.9 MB/s) | 4.92 ms (151.4 MB/s) | 3.02 ms (246.7 MB/s) | – | – | – |
| primer.css | 728.0 KB | Chromium 156.0.8078.4 | 2.29 ms (325.2 MB/s) | 4.75 ms (156.9 MB/s) | 2.83 ms (263.6 MB/s) | – | – | – |
| bootstrap.css | 274.5 KB | Node.js 24.15.0 | 1.26 ms (223.9 MB/s) | 2.59 ms (108.7 MB/s) | 1.72 ms (163.8 MB/s) | 3.69 ms (76.2 MB/s) | 8.80 ms (32.0 MB/s) | 2.94× faster |
| bootstrap.css | 274.5 KB | Bun 1.3.14 | 997.9 µs (281.6 MB/s) | 2.54 ms (110.5 MB/s) | 1.62 ms (173.8 MB/s) | 3.52 ms (79.7 MB/s) | 14.37 ms (19.6 MB/s) | 3.53× faster |
| bootstrap.css | 274.5 KB | Chromium 156.0.8078.4 | 1.18 ms (238.2 MB/s) | 2.42 ms (116.1 MB/s) | 1.67 ms (168.0 MB/s) | – | 8.37 ms (33.6 MB/s) | 7.09× faster |
| bootstrap.min.css | 227.3 KB | Node.js 24.15.0 | 1.17 ms (199.5 MB/s) | 2.51 ms (92.9 MB/s) | 1.60 ms (145.4 MB/s) | 3.50 ms (66.4 MB/s) | 8.16 ms (28.5 MB/s) | 3.00× faster |
| bootstrap.min.css | 227.3 KB | Bun 1.3.14 | 857.9 µs (271.4 MB/s) | 2.31 ms (100.8 MB/s) | 1.48 ms (157.1 MB/s) | 3.26 ms (71.5 MB/s) | 13.54 ms (17.2 MB/s) | 3.80× faster |
| bootstrap.min.css | 227.3 KB | Chromium 156.0.8078.4 | 1.02 ms (227.7 MB/s) | 2.17 ms (107.3 MB/s) | 1.55 ms (150.0 MB/s) | – | 7.17 ms (32.5 MB/s) | 7.01× faster |
| foundation.css | 164.1 KB | Node.js 24.15.0 | 895.3 µs (187.6 MB/s) | 1.92 ms (87.5 MB/s) | 1.27 ms (132.4 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Bun 1.3.14 | 645.8 µs (260.1 MB/s) | 1.87 ms (89.8 MB/s) | 1.15 ms (146.4 MB/s) | – | – | – |
| foundation.css | 164.1 KB | Chromium 156.0.8078.4 | 837.5 µs (200.6 MB/s) | 1.67 ms (100.9 MB/s) | 1.16 ms (144.2 MB/s) | – | – | – |
| font-awesome.css | 129.5 KB | Node.js 24.15.0 | 830.4 µs (159.8 MB/s) | 1.77 ms (75.0 MB/s) | 1.18 ms (112.7 MB/s) | 1.93 ms (68.7 MB/s) | 4.85 ms (27.4 MB/s) | 2.33× faster |
| font-awesome.css | 129.5 KB | Bun 1.3.14 | 700.9 µs (189.3 MB/s) | 1.48 ms (89.6 MB/s) | 994.2 µs (133.4 MB/s) | 1.91 ms (69.5 MB/s) | 9.06 ms (14.6 MB/s) | 2.72× faster |
| font-awesome.css | 129.5 KB | Chromium 156.0.8078.4 | 780.0 µs (170.1 MB/s) | 1.56 ms (85.2 MB/s) | 1.12 ms (118.2 MB/s) | – | 4.28 ms (31.0 MB/s) | 5.49× faster |

Lightning CSS reports errors on primer.css (6 errors, first: Unknown at rule: @custom-media) and foundation.css (1 error, first: Invalid media query).

### Per call

What one call costs when there is next to nothing to parse, so a lead on small files is not read as a lead in throughput. Median time per call.

| File | Runtime | yuku-css `transform` | yuku-css, `parse` and `generate` | yuku-css, parse only | yuku-css, positions | css-tree, positions | lightningcss | lightningcss-wasm | postcss |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty.css (0 B) | Node.js 24.15.0 | 0.3 µs | 0.7 µs | 0.6 µs | 0.7 µs | 0.5 µs | 1.6 µs | 3.5 µs | 0.2 µs |
| empty.css (0 B) | Bun 1.3.14 | 0.2 µs | 0.4 µs | 0.4 µs | 0.6 µs | 0.7 µs | 1.0 µs | 5.6 µs | 0.1 µs |
| empty.css (0 B) | Chromium 156.0.8078.4 | 0.4 µs | 0.7 µs | 0.6 µs | 0.7 µs | 0.4 µs | – | 3.4 µs | 0.1 µs |
| tiny.css (18 B) | Node.js 24.15.0 | 0.5 µs | 1.1 µs | 0.9 µs | 1.0 µs | 1.5 µs | 2.4 µs | 6.3 µs | 0.6 µs |
| tiny.css (18 B) | Bun 1.3.14 | 0.4 µs | 0.8 µs | 0.6 µs | 1.0 µs | 0.9 µs | 1.6 µs | 8.9 µs | 0.6 µs |
| tiny.css (18 B) | Chromium 156.0.8078.4 | 0.6 µs | 1.0 µs | 0.8 µs | 1.0 µs | 0.9 µs | – | 5.6 µs | 0.5 µs |

On Node.js 24.15.0, a call on an empty file costs yuku-css's `transform` 0.3 µs and the Lightning CSS addon 1.6 µs, so on the smallest files part of yuku-css's lead is the cost of a call.

### Where yuku-css wins

- On Node.js 24.15.0, `transform` beats the addon on every size of file, by 2.43× to 4.20×.
- On Bun 1.3.14, `transform` beats the addon on every size of file, by 3.03× to 5.25×.
- On Chromium 156.0.8078.4, `transform` beats `lightningcss-wasm` on every size of file, by 6.38× to 9.60×.
- A browser downloads 56.1 KB gzipped to transform with yuku-css, against 3670.3 KB for `lightningcss-wasm`.

### Where yuku-css loses

- In a fresh Node.js 24.15.0 process, loading the library and transforming bootstrap.css once takes yuku-css 8.84 ms, compiling its WebAssembly included, and the Lightning CSS addon 6.90 ms.
- Lightning CSS does more with the time: it types every value, so it can minify, lower syntax for older browsers and report invalid values, none of which yuku-css does. Its output is a normalized style sheet, where yuku-css prints its tree as written.

## Summary

On 228 Markless style sheets, yuku-css parses a file in 13.6 µs on Node.js 24.15.0, 3.19× faster than css-tree building the same tree: selectors, values and at-rule preludes parsed, positions on; 1.38× on Bun 1.3.14, and 2.01× in Chromium. Over all 246 files both parse cleanly, 10.6 MB of CSS, it reads 80.4 MB/s against css-tree's 27.3 MB/s; the lead is widest on files of 100 KB–1 MB (4.92×) and narrowest on > 1 MB (2.61×). css-tree's defaults, which give no positions, take 2.97× as long, and Lightning CSS's native addon, which parses values into typed structures and prints CSS back, 1.81×. Printing css-tree's own tree back to CSS, `yuku-css/codegen` takes 227.3 µs a file against css-tree's 496.2 µs (2.18×), and with a source map 463.3 µs against 1313.2 µs (2.83×). Validating every declaration of a file with `yuku-css/lexer`'s `matchStylesheet` takes 18.6 µs on the Markless corpus against 155.3 µs for css-tree parsing it and calling `matchDeclaration` on each declaration (8.37×). Its `tokenize` takes 112.6 µs a file against css-tree's 221.2 µs (1.96×). Where yuku-css loses: on long-selector-list.css on Node.js 24.15.0, lightningcss (1.71×) and postcss (1.44×) parse faster; on empty.css on Node.js 24.15.0, css-tree, same work (1.55×), css-tree, defaults (1.61×) and postcss (4.21×) parse faster; on tiny.css on Node.js 24.15.0, postcss (1.60×) parse faster; on normalize.css on Bun 1.3.14, css-tree, defaults (1.07×) parse faster; on preflight.css on Bun 1.3.14, css-tree, defaults (1.03×) parse faster; on font-awesome.css on Bun 1.3.14, css-tree, defaults (1.14×) parse faster; on foundation.css on Bun 1.3.14, css-tree, defaults (1.01×) parse faster; on bootstrap.css on Bun 1.3.14, css-tree, defaults (1.03×) parse faster; on deep-nesting.css on Bun 1.3.14, css-tree, defaults (1.03×) parse faster; on empty.css on Bun 1.3.14, postcss (4.33×) parse faster; on tiny.css on Bun 1.3.14, css-tree, same work (1.01×), css-tree, defaults (1.12×) and postcss (1.54×) parse faster; it holds more memory outside the JS heap: after parsing tailwind.css its WebAssembly memory has grown to 80.5 MB, and on files of 100 KB or more its peak resident memory is a median 1.35× css-tree's, though its tree retains 0.86× the JS heap css-tree's does; `css-tree` (53.2 KB), `css-tree/parser` (12.6 KB) and `postcss` (17.2 KB) download less than its 59.6 KB gzipped.

![Time per file to parse the Markless corpus on Node.js 24.15.0](benchmark/corpus.svg)

Median time per file, 228 Markless files, Node.js 24.15.0.

## Parse time

Each row says the work it does. Only rows marked the same as yuku-css build what yuku-css builds; the others are context.

### Markless corpus, 228 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 13.6 µs | 17.9 µs |  | 13.0 µs | 16.2 µs |  |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 10.2 µs | 12.5 µs |  | 8.7 µs | 10.4 µs |  |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 10.1 µs | 13.1 µs |  | 9.7 µs | 12.0 µs |  |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 7.7 µs | 8.6 µs |  | 6.2 µs | 7.0 µs |  |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 15.5 µs | 17.7 µs | 1.14× | 15.3 µs | 19.3 µs | 1.17× |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 7.7 µs | 8.2 µs | 0.56× | 5.8 µs | 7.0 µs | 0.44× |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 7.6 µs | 14.7 µs | 0.56× | 5.6 µs | 8.1 µs | 0.43× |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 43.6 µs | 48.2 µs | 3.19× | 18.0 µs | 23.3 µs | 1.38× |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 40.5 µs | 43.8 µs | 3.97× | 14.1 µs | 18.6 µs | 1.63× |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 36.7 µs | 42.6 µs | 3.63× | 14.4 µs | 20.2 µs | 1.49× |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 34.1 µs | 36.7 µs | 4.44× | 11.2 µs | 12.9 µs | 1.82× |
| lightningcss | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 24.7 µs | 28.2 µs | 1.81× | 22.5 µs | 29.8 µs | 1.73× |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 66.1 µs | 87.0 µs | 4.84× | 109.1 µs | 363.4 µs | 8.37× |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 20.5 µs | 24.3 µs | 1.50× | 24.3 µs | 33.9 µs | 1.86× |

### All files, 242 files

| Parser | Work | Node.js 24.15.0, per file | p95 | vs yuku-css | Bun 1.3.14, per file | p95 | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 564.2 µs | 765.5 µs |  | 302.1 µs | 411.3 µs |  |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 264.3 µs | 307.1 µs |  | 204.2 µs | 227.9 µs |  |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 281.6 µs | 495.2 µs |  | 247.6 µs | 310.4 µs |  |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 223.6 µs | 259.7 µs |  | 169.3 µs | 198.6 µs |  |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 460.6 µs | 504.0 µs | 0.82× | 408.7 µs | 477.2 µs | 1.35× |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 195.3 µs | 205.0 µs | 0.35× | 150.8 µs | 160.4 µs | 0.50× |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 154.5 µs | 179.4 µs | 0.27× | 121.2 µs | 129.8 µs | 0.40× |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 1663.7 µs | 1861.9 µs | 2.95× | 544.2 µs | 709.1 µs | 1.80× |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 1137.6 µs | 1190.4 µs | 4.30× | 409.4 µs | 477.8 µs | 2.00× |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 1463.9 µs | 1678.0 µs | 5.20× | 470.5 µs | 585.9 µs | 1.90× |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 1063.0 µs | 1107.4 µs | 4.75× | 368.4 µs | 424.3 µs | 2.18× |
| lightningcss | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 754.4 µs | 776.3 µs | 1.34× | 738.4 µs | 768.7 µs | 2.44× |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 1783.0 µs | 1856.4 µs | 3.16× | 3118.9 µs | 3442.0 µs | 10.32× |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 938.2 µs | 1050.3 µs | 1.66× | 805.5 µs | 919.3 µs | 2.67× |

### By size

Throughput on Node.js 24.15.0, by file size, on the 246 files both yuku-css and css-tree parse cleanly, less any a context parser leaves out.

| Size | Files | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| < 1 KB | 125 | 105.4 MB/s | 36.3 MB/s | 40.1 MB/s | 48.9 MB/s | 18.7 MB/s | 80.2 MB/s | 2.90× |
| 1–10 KB | 107 | 113.8 MB/s | 35.1 MB/s | 37.6 MB/s | 64.6 MB/s | 24.0 MB/s | 73.8 MB/s | 3.24× |
| 10–100 KB | 4 | 134.5 MB/s | 38.4 MB/s | 42.8 MB/s | 95.1 MB/s | 38.2 MB/s | 82.6 MB/s | 3.50× |
| 100 KB–1 MB | 7 | 160.1 MB/s | 32.5 MB/s | 36.5 MB/s | 48.6 MB/s | 20.3 MB/s | 43.9 MB/s | 4.92× |
| > 1 MB | 3 | 66.1 MB/s | 25.3 MB/s | 41.2 MB/s | 65.0 MB/s | 27.9 MB/s | 49.2 MB/s | 2.61× |

![Throughput by file size on Node.js 24.15.0](benchmark/buckets.svg)

### Real-world CSS from npm

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| normalize.css | 6.0 KB | 27.6 µs (31.2 µs) | 84.3 µs (85.9 µs) | 71.2 µs (78.1 µs) | 37.1 µs (41.3 µs) | 92.9 µs (127.2 µs) | 46.2 µs (50.6 µs) | 3.06× |
| preflight.css | 7.6 KB | 35.9 µs (40.7 µs) | 112.1 µs (113.7 µs) | 101.2 µs (101.9 µs) | 53.9 µs (56.7 µs) | 150.8 µs (199.1 µs) | 57.1 µs (59.4 µs) | 3.12× |
| pure.css | 25.6 KB | 166.5 µs (170.8 µs) | 564.1 µs (612.9 µs) | 490.9 µs (502.1 µs) | 249.0 µs (258.3 µs) | 643.9 µs (684.5 µs) | 272.7 µs (382.5 µs) | 3.39× |
| github-markdown.css | 28.7 KB | 188.2 µs (192.5 µs) | 701.3 µs (902.0 µs) | 582.5 µs (672.7 µs) | 341.9 µs (345.3 µs) | 870.5 µs (941.2 µs) | 305.8 µs (319.9 µs) | 3.73× |
| animate.css | 93.1 KB | 742.7 µs (1.04 ms) | 2.59 ms (2.92 ms) | 2.40 ms (2.72 ms) | 934.4 µs (1.04 ms) | 2.29 ms (2.44 ms) | 1.24 ms (1.33 ms) | 3.49× |
| font-awesome.css | 129.5 KB | 1.50 ms (1.53 ms) | 3.92 ms (5.67 ms) | 3.41 ms (3.75 ms) | 1.93 ms (2.01 ms) | 4.85 ms (5.18 ms) | 1.99 ms (2.55 ms) | 2.62× |
| foundation.css | 164.1 KB | 1.80 ms (2.07 ms) | 4.80 ms (5.03 ms) | 4.36 ms (4.94 ms) | – | – | 2.53 ms (2.90 ms) | 2.66× |
| bootstrap.css | 274.5 KB | 2.42 ms (3.16 ms) | 6.87 ms (8.40 ms) | 6.13 ms (6.69 ms) | 3.69 ms (3.85 ms) | 8.80 ms (8.97 ms) | 4.16 ms (5.00 ms) | 2.84× |
| bootstrap.min.css | 227.3 KB | 1.96 ms (2.42 ms) | 5.92 ms (6.74 ms) | 5.07 ms (5.42 ms) | 3.50 ms (3.67 ms) | 8.16 ms (8.47 ms) | 2.42 ms (2.52 ms) | 3.02× |
| primer.css | 728.0 KB | 3.89 ms (5.29 ms) | – | – | – | – | 6.94 ms (7.54 ms) | – |
| bulma.css | 745.3 KB | 4.51 ms (4.83 ms) | 15.41 ms (16.46 ms) | 13.41 ms (16.10 ms) | 9.54 ms (10.06 ms) | 21.81 ms (22.23 ms) | 8.95 ms (9.42 ms) | 3.41× |
| tailwind.min.css | 2865.3 KB | 44.25 ms (61.26 ms) | 106.09 ms (118.29 ms) | 61.28 ms (61.94 ms) | 50.50 ms (52.17 ms) | 117.40 ms (119.90 ms) | 56.38 ms (63.20 ms) | 2.40× |
| tailwind.css | 3557.0 KB | 47.88 ms (70.42 ms) | 119.23 ms (133.66 ms) | 75.18 ms (76.01 ms) | 53.26 ms (54.08 ms) | 124.22 ms (126.94 ms) | 82.52 ms (86.85 ms) | 2.49× |

### Synthetic stress files

Median time per parse on Node.js 24.15.0, p95 in parentheses. A dash marks a parse that reported errors.

| File | Size | yuku-css | css-tree, same work | css-tree, defaults | lightningcss | lightningcss-wasm | postcss | css-tree, same work, vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| deep-nesting.css | 393.6 KB | 5.71 ms (6.15 ms) | 23.24 ms (24.23 ms) | 19.47 ms (21.36 ms) | 12.81 ms (13.11 ms) | 26.32 ms (29.51 ms) | 10.29 ms (12.74 ms) | 4.07× |
| long-selector-list.css | 1033.0 KB | 23.32 ms (29.09 ms) | 76.43 ms (89.35 ms) | 48.71 ms (52.17 ms) | 13.65 ms (13.79 ms) | 32.40 ms (33.63 ms) | 16.16 ms (16.61 ms) | 3.28× |
| huge-custom-properties.css | 976.8 KB | 710.6 µs (843.2 µs) | 31.53 ms (32.19 ms) | 29.78 ms (30.57 ms) | 26.43 ms (26.94 ms) | 68.41 ms (70.19 ms) | 37.59 ms (47.60 ms) | 44.38× |
| many-at-rules.css | 673.4 KB | 10.57 ms (10.96 ms) | – | – | 11.37 ms (11.90 ms) | 24.25 ms (24.91 ms) | 16.28 ms (16.71 ms) | – |

## Cost per node

Every tree's nodes are counted the same way: each object with a string `type`, reached through fields and lists. yuku-css builds css-tree's tree, so with the same work the counts differ only where the two read CSS differently; with values parsed, both have a node for each part of a value and prelude; PostCSS has none below a rule's selector. Lightning CSS, and yuku-css when it prints, transforms or is read for diagnostics only, return no tree. Each row covers the files it parses cleanly.

| Parser | Files | Nodes | Node.js 24.15.0, ns per node | Bun 1.3.14, ns per node | Node.js 24.15.0, MB/s | Bun 1.3.14, MB/s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| yuku-css | 269 | 1,907,105 | 80.9 | 45.7 | 83.0 MB/s | 146.9 MB/s |
| yuku-css, values and preludes parsed, no positions | 269 | 1,907,105 | 39.4 | 31.3 | 170.6 MB/s | 214.6 MB/s |
| yuku-css, values and preludes raw, positions | 269 | 1,490,909 | 52.5 | 46.6 | 163.7 MB/s | 184.6 MB/s |
| yuku-css, values and preludes raw, no positions | 269 | 1,490,909 | 41.6 | 32.0 | 206.8 MB/s | 269.0 MB/s |
| css-tree, same work | 246 | 1,645,480 | 247.9 | 81.4 | 27.3 MB/s | 83.1 MB/s |
| css-tree, defaults | 246 | 1,645,480 | 170.2 | 61.3 | 39.8 MB/s | 110.3 MB/s |
| css-tree, values and preludes raw, positions | 248 | 1,472,223 | 267.7 | 88.0 | 31.9 MB/s | 97.0 MB/s |
| css-tree, values and preludes raw, no positions | 248 | 1,472,223 | 198.3 | 69.0 | 43.1 MB/s | 123.8 MB/s |
| postcss | 269 | 336,882 | 757.2 | 674.2 | 50.2 MB/s | 56.4 MB/s |

## Where yuku-css spends its time

Its `parse` has three steps: encoding the source to UTF-8 in WebAssembly memory, parsing and serializing the tree in WebAssembly, and decoding the tree into JS objects. Each step is timed on its own (bench/yuku-phases.ts), per file, values and preludes parsed, positions, over the files yuku-css parses cleanly.

| Runtime | Size | Encode | Parse and serialize | Decode | Sum | Whole parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | < 1 KB | 0.2 µs (5%) | 1.4 µs (42%) | 1.7 µs (53%) | 3.2 µs | 3.2 µs |
| Node.js 24.15.0 | 1–10 KB | 1.4 µs (5%) | 12.9 µs (48%) | 12.4 µs (47%) | 26.7 µs | 27.4 µs |
| Node.js 24.15.0 | 10–100 KB | 10.6 µs (4%) | 120.8 µs (49%) | 116.6 µs (47%) | 248.0 µs | 241.9 µs |
| Node.js 24.15.0 | 100 KB–1 MB | 219.1 µs (7%) | 1.43 ms (43%) | 1.67 ms (50%) | 3.32 ms | 3.35 ms |
| Node.js 24.15.0 | > 1 MB | 865.3 µs (2%) | 7.85 ms (21%) | 29.02 ms (77%) | 37.74 ms | 38.48 ms |
| Node.js 24.15.0 | All | 18.8 µs (3%) | 150.3 µs (27%) | 395.0 µs (70%) | 564.1 µs | 573.9 µs |
| Bun 1.3.14 | < 1 KB | 0.0 µs (1%) | 1.1 µs (41%) | 1.6 µs (58%) | 2.7 µs | 3.0 µs |
| Bun 1.3.14 | 1–10 KB | 0.1 µs (1%) | 11.3 µs (47%) | 12.5 µs (52%) | 23.9 µs | 26.4 µs |
| Bun 1.3.14 | 10–100 KB | 0.5 µs (0%) | 105.8 µs (47%) | 119.9 µs (53%) | 226.3 µs | 251.1 µs |
| Bun 1.3.14 | 100 KB–1 MB | 19.7 µs (1%) | 1.25 ms (47%) | 1.41 ms (53%) | 2.68 ms | 2.91 ms |
| Bun 1.3.14 | > 1 MB | 45.0 µs (0%) | 6.92 ms (42%) | 9.41 ms (57%) | 16.38 ms | 17.62 ms |
| Bun 1.3.14 | All | 1.3 µs (0%) | 131.9 µs (44%) | 166.8 µs (56%) | 300.1 µs | 324.3 µs |

## Tokenizing

yuku-css's `tokenize` returns every token packed into a `Uint32Array`, type and end offset, as css-tree packs its `offsetAndType`. css-tree's `tokenize` calls back once for each token, timed here counting them. Both on the 246 files yuku-css and css-tree parse cleanly.

| Runtime | Tokenizer | Per file | MB/s | vs yuku-css | Share of its same-work parse |
| --- | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 112.6 µs | 401.9 MB/s |  | 20% |
| Node.js 24.15.0 | css-tree | 221.2 µs | 204.6 MB/s | 1.96× | 13% |
| Bun 1.3.14 | yuku-css | 91.9 µs | 492.7 MB/s |  | 30% |
| Bun 1.3.14 | css-tree | 179.9 µs | 251.7 MB/s | 1.96× | 33% |

## Printing

`generate` from `yuku-css/codegen` against css-tree's `generate`, both printing css-tree's own tree of each file, values parsed and positions on, built before timing. Both print the same bytes; with `sourceMap: true` each also builds a source map, timed through `map.toString()`. On the 246 files css-tree parses cleanly that way.

| Runtime | Printer | Per file | MB/s | vs yuku-css |
| --- | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 227.3 µs | 199.1 MB/s |  |
| Node.js 24.15.0 | yuku-css, source map | 463.3 µs | 97.7 MB/s |  |
| Node.js 24.15.0 | css-tree | 496.2 µs | 91.2 MB/s | 2.18× |
| Node.js 24.15.0 | css-tree, source map | 1313.2 µs | 34.5 MB/s | 2.83× |
| Bun 1.3.14 | yuku-css | 140.5 µs | 322.2 MB/s |  |
| Bun 1.3.14 | yuku-css, source map | 279.6 µs | 161.9 MB/s |  |
| Bun 1.3.14 | css-tree | 388.3 µs | 116.6 MB/s | 2.76× |
| Bun 1.3.14 | css-tree, source map | 706.1 µs | 64.1 MB/s | 2.53× |

![Time per file to print css-tree's tree on Node.js 24.15.0](benchmark/generate.svg)

## Validating

`matchStylesheet` from `yuku-css/lexer` parses a style sheet and matches every declaration against the grammar in one WebAssembly call; each result's `matched` and `error` are read, which builds css-tree's match tree and error. css-tree validates by parsing with values and calling `lexer.matchDeclaration` on each declaration, which builds both at once. `yuku-css unread` reads neither, as a caller that only counts errors would not. The grammars differ, yuku-css's from @webref/css and css-tree's from mdn-data, so the trees and errors are the same only where the grammars agree. On the 246 files both parse cleanly.

| Runtime | Validator | Markless corpus, per file (231 files) | MB/s | npm, per file (12 files) | MB/s | Synthetic, per file (3 files) | MB/s | vs yuku-css |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | yuku-css | 18.6 µs | 83.2 MB/s | 2.81 ms | 247.1 MB/s | 1.19 ms | 691.4 MB/s |  |
| Node.js 24.15.0 | yuku-css unread | 14.9 µs | 103.8 MB/s | 2.22 ms | 312.4 MB/s | 1.16 ms | 707.3 MB/s | 0.81× |
| Node.js 24.15.0 | css-tree | 155.3 µs | 9.9 MB/s | 63.21 ms | 11.0 MB/s | 40.66 ms | 20.2 MB/s | 22.07× |
| Bun 1.3.14 | yuku-css | 16.8 µs | 91.7 MB/s | 2.27 ms | 305.7 MB/s | 898.9 µs | 912.6 MB/s |  |
| Bun 1.3.14 | yuku-css unread | 12.2 µs | 126.3 MB/s | 1.74 ms | 399.0 MB/s | 830.2 µs | 988.1 MB/s | 0.77× |
| Bun 1.3.14 | css-tree | 58.1 µs | 26.6 MB/s | 14.63 ms | 47.4 MB/s | 15.14 ms | 54.2 MB/s | 6.94× |

## Cold start

The median of 1 fresh processes. Load is the `import` of the library, which for yuku-css includes compiling its WebAssembly. First and second are the first two parses in that process. Warm is the median from the parse timings.

| Runtime | File | Parser | Load | First parse | Second parse | Warm parse | Load and first parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 3.00 ms | 2.44 ms | 98.3 µs | 7.3 µs | 5.45 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 3.98 ms | 2.44 ms | 94.0 µs | 7.9 µs | 6.42 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css transform | 3.04 ms | 2.10 ms | 35.2 µs | 4.1 µs | 5.15 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css diagnostics | 3.07 ms | 2.11 ms | 36.4 µs | 4.6 µs | 5.18 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 21.70 ms | 1.17 ms | 175.7 µs | 23.0 µs | 22.86 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.45 ms | 340.0 µs | 36.0 µs | 16.4 µs | 2.79 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 13.92 ms | 67.45 ms | 611.5 µs | 40.3 µs | 81.37 ms |
| Node.js 24.15.0 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 6.51 ms | 888.9 µs | 111.2 µs | 11.4 µs | 7.40 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css | 2.98 ms | 12.04 ms | 8.31 ms | 2.42 ms | 15.02 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css print | 4.16 ms | 13.62 ms | 6.55 ms | 2.59 ms | 17.77 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css transform | 3.11 ms | 5.73 ms | 2.64 ms | 1.26 ms | 8.84 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | yuku-css diagnostics | 2.96 ms | 4.88 ms | 2.01 ms | 1.22 ms | 7.84 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | css-tree | 20.97 ms | 20.29 ms | 16.48 ms | 6.87 ms | 41.26 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss | 2.15 ms | 4.75 ms | 3.78 ms | 3.69 ms | 6.90 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | lightningcss-wasm | 13.70 ms | 111.68 ms | 22.08 ms | 8.80 ms | 125.38 ms |
| Node.js 24.15.0 | bootstrap.css (274.5 KB) | postcss | 5.99 ms | 12.02 ms | 9.33 ms | 4.16 ms | 18.02 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css | 4.57 ms | 1.70 ms | 371.9 µs | 7.3 µs | 6.27 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css print | 6.65 ms | 1.96 ms | 505.5 µs | 7.8 µs | 8.61 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css transform | 4.61 ms | 1.15 ms | 265.2 µs | 3.2 µs | 5.76 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | yuku-css diagnostics | 4.62 ms | 1.04 ms | 202.7 µs | 3.0 µs | 5.65 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | css-tree | 10.93 ms | 1.89 ms | 421.0 µs | 9.6 µs | 12.82 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss | 2.57 ms | 402.2 µs | 34.3 µs | 15.1 µs | 2.98 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | lightningcss-wasm | 20.73 ms | 4.98 ms | 2.28 ms | 75.9 µs | 25.71 ms |
| Bun 1.3.14 | website__components__sketch__concepts__basket-mugs-only.tsrx.0.css (0.8 KB) | postcss | 8.43 ms | 1.31 ms | 248.7 µs | 13.5 µs | 9.73 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css | 4.43 ms | 10.54 ms | 7.88 ms | 2.41 ms | 14.97 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css print | 6.30 ms | 12.59 ms | 6.67 ms | 2.54 ms | 18.90 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css transform | 4.60 ms | 5.39 ms | 2.22 ms | 997.9 µs | 9.98 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | yuku-css diagnostics | 4.65 ms | 4.90 ms | 1.98 ms | 881.0 µs | 9.54 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | css-tree | 11.42 ms | 13.73 ms | 8.58 ms | 3.09 ms | 25.15 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss | 2.47 ms | 4.57 ms | 3.68 ms | 3.52 ms | 7.04 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | lightningcss-wasm | 20.94 ms | 61.33 ms | 44.61 ms | 14.37 ms | 82.27 ms |
| Bun 1.3.14 | bootstrap.css (274.5 KB) | postcss | 8.67 ms | 10.20 ms | 7.77 ms | 5.01 ms | 18.87 ms |

![Load and first parse in a fresh Node.js 24.15.0 process](benchmark/cold.svg)

## Memory

Each file of 100 KB or more, parsed in a fresh Node.js 24.15.0 process run with `--expose-gc`, median of 1. Heap is the JS heap the tree retains after a full GC. External is memory outside the JS heap, such as WebAssembly memory, which only grows. Peak is how far resident memory rose during the parse. Negative readings, which are noise, show as 0.

| File | Size | yuku-css: heap / external / peak | css-tree, same work: heap / external / peak | css-tree, defaults: heap / external / peak | lightningcss: heap / external / peak | lightningcss-wasm: heap / external / peak | postcss: heap / external / peak |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| website__styles__global.css | 120.5 KB | 1.0 MB / 2.4 MB / 3.4 MB | – | – | 0.0 MB / 0.2 MB / 2.4 MB | 0.2 MB / 0.0 MB / 108.2 MB | 0.9 MB / 0.0 MB / 0.7 MB |
| font-awesome.css | 129.5 KB | 5.5 MB / 3.1 MB / 14.9 MB | 6.5 MB / 2.0 MB / 8.1 MB | 3.1 MB / 1.0 MB / 5.4 MB | 0.0 MB / 0.2 MB / 6.4 MB | 0.1 MB / 0.0 MB / 80.8 MB | 3.7 MB / 0.0 MB / 10.8 MB |
| foundation.css | 164.1 KB | 6.1 MB / 3.2 MB / 13.5 MB | 7.3 MB / 2.6 MB / 8.7 MB | 3.6 MB / 1.3 MB / 5.4 MB | – | – | 4.0 MB / 0.0 MB / 11.6 MB |
| bootstrap.css | 274.5 KB | 8.1 MB / 6.7 MB / 31.2 MB | 9.4 MB / 4.3 MB / 14.3 MB | 4.6 MB / 2.1 MB / 4.7 MB | 0.0 MB / 0.5 MB / 7.8 MB | 0.2 MB / 0.0 MB / 137.6 MB | 5.9 MB / 0.0 MB / 16.6 MB |
| bootstrap.min.css | 227.3 KB | 8.1 MB / 6.6 MB / 32.1 MB | 9.4 MB / 3.6 MB / 15.2 MB | 4.5 MB / 1.8 MB / 7.2 MB | 0.0 MB / 0.5 MB / 8.0 MB | 0.2 MB / 0.0 MB / 129.9 MB | 5.3 MB / 0.0 MB / 16.8 MB |
| primer.css | 728.0 KB | 16.9 MB / 15.7 MB / 46.8 MB | – | – | – | – | 12.9 MB / 0.0 MB / 30.1 MB |
| bulma.css | 745.3 KB | 15.6 MB / 15.7 MB / 37.9 MB | 17.8 MB / 11.4 MB / 31.4 MB | 8.4 MB / 5.8 MB / 12.0 MB | 0.0 MB / 1.5 MB / 15.7 MB | 0.2 MB / 0.0 MB / 204.1 MB | 11.3 MB / 0.0 MB / 30.2 MB |
| tailwind.min.css | 2865.3 KB | 104.8 MB / 63.8 MB / 167.1 MB | 118.0 MB / 44.5 MB / 163.7 MB | 53.4 MB / 22.3 MB / 85.7 MB | 0.0 MB / 6.2 MB / 92.1 MB | 0.2 MB / 48.7 MB / 577.6 MB | 71.6 MB / 0.0 MB / 162.5 MB |
| tailwind.css | 3557.0 KB | 105.1 MB / 80.5 MB / 169.3 MB | 118.3 MB / 55.3 MB / 173.1 MB | 53.7 MB / 27.7 MB / 88.1 MB | 0.0 MB / 6.9 MB / 85.5 MB | 0.2 MB / 47.4 MB / 569.5 MB | 52.5 MB / 0.0 MB / 200.7 MB |
| deep-nesting.css | 393.6 KB | 31.1 MB / 29.6 MB / 72.2 MB | 35.4 MB / 5.9 MB / 48.5 MB | 15.6 MB / 3.1 MB / 18.0 MB | 0.0 MB / 2.0 MB / 32.5 MB | 0.0 MB / 6.3 MB / 238.7 MB | 19.6 MB / 0.0 MB / 50.3 MB |
| long-selector-list.css | 1033.0 KB | 60.8 MB / 67.8 MB / 107.6 MB | 70.6 MB / 15.9 MB / 90.6 MB | 32.0 MB / 7.9 MB / 45.3 MB | 0.0 MB / 2.0 MB / 17.9 MB | 0.0 MB / 0.0 MB / 28.5 MB | 15.7 MB / 0.0 MB / 61.5 MB |
| huge-custom-properties.css | 976.8 KB | 0.1 MB / 19.7 MB / 1.2 MB | 0.1 MB / 15.3 MB / 13.7 MB | 0.1 MB / 7.6 MB / 5.9 MB | 0.0 MB / 1.9 MB / 149.2 MB | 0.0 MB / 61.4 MB / 228.4 MB | 1.0 MB / 0.0 MB / 112.9 MB |
| many-at-rules.css | 673.4 KB | 36.1 MB / 49.7 MB / 78.1 MB | – | – | 0.0 MB / 1.3 MB / 31.0 MB | 0.1 MB / 4.3 MB / 199.4 MB | 18.8 MB / 0.0 MB / 48.8 MB |

## Bundle size

What a browser downloads to parse: the library bundled by [Rolldown](https://rolldown.rs) for the browser and minified, keeping only its parse function (`transform` for Lightning CSS and for `yuku-css transform`, `generate` for `yuku-css/codegen`), plus any file it fetches beside the JS. yuku-css inlines its WebAssembly into the JS as base64. Lightning CSS's WebAssembly is a separate file; its native addon does not run in a browser.

| Entry | Minified | gzip | brotli |
| --- | ---: | ---: | ---: |
| `yuku-css` | 202.0 KB | 59.6 KB | 48.0 KB |
| `yuku-css/codegen` | 15.0 KB | 5.4 KB | 4.9 KB |
| yuku-css transform | 186.4 KB | 56.1 KB | 45.0 KB |
| `css-tree` | 194.3 KB | 53.2 KB | 46.8 KB |
| `css-tree/parser` | 48.0 KB | 12.6 KB | 11.4 KB |
| `lightningcss-wasm` | 15474.0 KB | 3670.3 KB | 2025.7 KB |
| `postcss` | 56.1 KB | 17.2 KB | 15.5 KB |

![Bytes downloaded, gzipped](benchmark/bundle.svg)

Gzipped. `lightningcss-wasm`, past 1 MB, is left off the chart.

## In the browser

The parse timings in headless Chromium 156.0.8078.4, a fresh browser for each of 1 runs, on a cross-origin isolated page, where `performance.now()` ticks every 5 µs. Each library is bundled by Rolldown as a consumer would bundle it.

| Parser | Work | Markless, per file (228 files) | p95 | vs yuku-css | All files, MB/s (242 files) |
| --- | ---: | ---: | ---: | ---: | ---: |
| yuku-css | values and preludes parsed, positions | 12.6 µs | 15.4 µs |  | 115.9 MB/s |
| yuku-css, values and preludes parsed, no positions | values and preludes parsed, no positions; start and end offsets | 9.5 µs | 10.9 µs |  | 203.7 MB/s |
| yuku-css, values and preludes raw, positions | values and preludes raw, positions | 9.5 µs | 11.8 µs |  | 159.0 MB/s |
| yuku-css, values and preludes raw, no positions | values and preludes raw, no positions; start and end offsets | 7.1 µs | 8.2 µs |  | 244.4 MB/s |
| yuku-css print | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back with `yuku-css/codegen` (**not the same work**) | 13.7 µs | 15.6 µs | 1.09× | 95.4 MB/s |
| yuku-css transform | values and preludes parsed, no positions; parses, values and at-rule preludes included, and prints CSS back in one WebAssembly call; returns no tree (**not the same work**) | 6.8 µs | 7.3 µs | 0.54× | 268.7 MB/s |
| yuku-css diagnostics | values and preludes parsed, no positions; diagnostics only: parses in WebAssembly but never reads `ast`, so builds no tree in JS (**not the same work**) | 7.3 µs | 9.9 µs | 0.58× | 306.5 MB/s |
| css-tree, same work | values and preludes parsed, positions (same as yuku-css) | 25.3 µs | 27.9 µs | 2.01× | 48.9 MB/s |
| css-tree, defaults | values and preludes parsed, no positions (same as yuku-css, less its start and end offsets) | 22.0 µs | 24.1 µs | 2.32× | 75.1 MB/s |
| css-tree, values and preludes raw, positions | values and preludes raw, positions (same as yuku-css) | 23.2 µs | 25.1 µs | 2.44× | 52.8 MB/s |
| css-tree, values and preludes raw, no positions | values and preludes raw, no positions (same as yuku-css, less its start and end offsets) | 19.3 µs | 20.6 µs | 2.71× | 76.8 MB/s |
| lightningcss-wasm | values and preludes parsed, no positions; parses values into typed structures and prints CSS back; returns no tree (**not the same work**) | 58.4 µs | 66.9 µs | 4.63× | 29.1 MB/s |
| postcss | values and preludes raw, positions; keeps selectors as strings (**not the same work**) | 17.6 µs | 19.4 µs | 1.39× | 61.5 MB/s |

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
| website__components__mascot__mug-studio.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 89 errors, first: ")" is expected |
| website__components__sketch__concepts__computed-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__concepts__lists-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__concepts__state-sketch.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__components__sketch__index-card.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 1 error, first: Colon is expected |
| website__pages__ui__accordion-examples.tsrx.0.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 2 errors, first: Colon is expected |
| website__styles__global.css | css-tree, same work; css-tree, defaults; css-tree, values and preludes raw, positions; css-tree, values and preludes raw, no positions | 4 errors, first: Colon is expected |
| primer.css | css-tree, same work; css-tree, defaults; lightningcss; lightningcss-wasm | 6 errors, first: ")" is expected |
| many-at-rules.css | css-tree, same work; css-tree, defaults | 2000 errors, first: Colon is expected |
| website__components__docs__anatomy-table-view.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-selection |
| website__components__docs__anatomy__branch.tsrx.0.css | lightningcss; lightningcss-wasm | 1 error, first: Unknown at rule: @anatomy-tree-selection |
| website__components__docs__keyboard-table.tsrx.0.css | lightningcss; lightningcss-wasm | 3 errors, first: Unknown at rule: @keyboard-inspection |
| foundation.css | lightningcss; lightningcss-wasm | 1 error, first: Invalid media query |

## Methodology

- **Corpus.** 252 style sheets from the Markless repository ([test/corpus](../test/corpus)); 13 files from npm packages, pinned by version and checked by SHA-256; 4 generated stress files: deep nesting, a long selector list, huge custom properties, and many at-rules; and an empty file and a one-rule file, timed only for the cost of a call. `node bench/corpus.ts` fetches and generates them ([bench/corpus.ts](../bench/corpus.ts)).
- **Processes.** Each measurement runs in a fresh process, 1 times, with the runs of every configuration taking turns. A file's time is the median over runs of its median; its p95 is the median over runs of its 95th percentile.
- **Sampling.** A process first parses its files in turn for at least a second, so the JIT has compiled the hot paths. It then parses each file for 0.2 ms more and samples it for 1 ms and at least 10 samples (half that in the browser). A sample times enough parses to last 20 µs (500 µs in the browser), so the clock's cost and precision do not count.
- **Smallest first.** A process times its files a size bucket at a time, from the smallest, warming each bucket up first. css-tree resets its token buffers in full on every parse (`balance.fill(0)` in its `TokenStream`), and they keep the size of the largest source it has parsed: in a one-off check, `.a { color: red }` took 1.4 µs to parse before a 3.6 MB file and 60 µs after. Timing small files after large ones would charge css-tree for that.
- **Per file** is the sum of the files' medians over the number of files, as in the README chart. **MB/s** is the files' bytes over that sum.
- **Same work.** yuku-css and css-tree get the same options: `parseValue` and `parseAtrulePrelude` on and `parseCustomProperty` off, which is what yuku-css builds by default, and `positions` on, so both build css-tree's `loc` with lines and columns. Rows with values raw turn the first two off for both. css-tree's defaults are the same with positions off. Without positions yuku-css still gives each node `start` and `end` offsets, so it does more than css-tree there. Each library is called through one adapter in [bench/adapters.ts](../bench/adapters.ts), so after an API change only the adapter changes.
- **Lightning CSS** has no parse-only API in JS. It is timed calling `transform({ filename, code, minify: false })`, which parses into typed structures, values included, and prints CSS back with no minifying and no targets, so nothing is lowered. Encoding the source string to bytes is part of the timed call, as it is in yuku-css's `parse`.

| | |
| --- | --- |
| Machine | Apple M5 Pro, 18 cores, 48 GB, darwin 25.6.0 |
| Runtimes | Node.js 24.15.0, Bun 1.3.14, Chromium 156.0.8078.4 |
| Libraries | yuku-css 0.1.0 (bd51648), css-tree 3.2.1, lightningcss 1.33.0, postcss 8.5.30 |
| Duration | 6 min: modes 0 s, gate 8 s, parse 130 s, tokenize 11 s, generate 34 s, validate 31 s, phases 7 s, cold 4 s, memory 28 s, bundle 19 s, browser 69 s |

## Caveats

- The trees are not identical even when the work is the same: where css-tree reads CSS otherwise than the CSS specifications, yuku-css follows the specifications, and it collects every comment, which css-tree does only when given `onComment`. [test/divergences.ts](../test/divergences.ts) lists every difference.
- css-tree reads a nested rule that starts with a type selector, such as `html.dark & {}`, as a declaration and reports an error, which is why it leaves out most of the Markless files it does.
- css-tree is imported from its main entry, which also loads its lexer and syntax data. `css-tree/parser` loads less; its bundle size is listed.
- yuku-css's WebAssembly memory grows to fit the largest file it has parsed and does not shrink until it has passed 128 MB and a small file comes, so its external memory is a high-water mark.
- One machine, one run of the suite: differences under about 5% are noise.
