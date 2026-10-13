# Decisions

- The AST is css-tree 3.2.1's, and css-tree's own fixtures are the parity suite (`bun run sync`).
- Where css-tree accepts what the CSS specs reject, yuku-css follows the specs; every such case is listed in `test/divergences.ts`.
- The lexer validates against `@webref/css` (W3C spec extracts), not mdn-data; where the two disagree with css-tree's fixtures, the case is listed as a divergence.
- The benchmark compares against css-tree, PostCSS, and Lightning CSS (native and wasm), always on equal work.
