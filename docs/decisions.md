# Decisions

- The AST is css-tree 3.2.1's, and css-tree's own fixtures are the parity suite (`bun run sync`).
- Where css-tree accepts what the CSS specs reject, yuku-css follows the specs; every such case is listed in `test/divergences.ts`.
- The lexer validates against `@webref/css` (W3C spec extracts), not mdn-data; where the two disagree with css-tree's fixtures, the case is listed as a divergence.
- The benchmark compares against css-tree, PostCSS, and Lightning CSS (native and wasm), always on equal work.
- The tree is css-tree's; parse errors the current CSS Syntax 3 draft defines (unclosed comment, string or url, bad escapes, newline in a string) are reported even where css-tree is silent, end of input inside a block is not (the current draft dropped it), and Selectors 4 syntax css-tree lacks (`||`) is parsed; all listed as divergences.
- `yuku-css/codegen` and `yuku-css/ast` are TypeScript over the decoded tree, as Yuku's are, and keep css-tree's function names. They take any css-tree tree, with arrays or `List`s, and `generate` matches css-tree's output and source maps byte for byte, so they are tested on trees css-tree parses.
- `yuku-css/lexer` is css-tree's lexer with its matching algorithm ported to Zig node for node, so over the same grammar it answers as css-tree does; the grammar is compiled from `@webref/css` at build time and embedded in a WebAssembly module of its own, so the parser does not carry it.
