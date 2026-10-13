# yuku-css

A fast CSS parser, written in Zig and compiled to WebAssembly.

```bash
npm install yuku-css
```

## Usage

```ts
import { parse, type Rule } from "yuku-css";

const source = `.card:has(> img) {
  color: red !important;
  &:hover { color: blue }
}`;

const { stylesheet, diagnostics } = parse(source);

const rule = stylesheet.children[0] as Rule;
rule.prelude; // SelectorList of ComplexSelector, each of CompoundSelector and Combinator
rule.block.children; // Declaration { property: "color", value: Raw { value: "red" }, important: true }, then Rule
```

It runs in Node.js 18 or newer, Bun, Deno, Workers, and browsers.

`parse` never throws on bad CSS. It returns what parses, with a diagnostic for each error, so a caller that must reject bad CSS checks `diagnostics.length`.

Every node has `start` and `end`, offsets into the source string, so `source.slice(node.start, node.end)` is its text. The tree follows [CSS Syntax Level 3](https://www.w3.org/TR/css-syntax-3/), with [nesting](https://www.w3.org/TR/css-nesting-1/), and [Selectors Level 4](https://www.w3.org/TR/selectors-4/). Its nodes are typed in [src/ast.ts](src/ast.ts):

- `StyleSheet`, `Rule`, `AtRule`, `Block`, `Declaration`, and `Raw` for text kept as written: declaration values, at-rule preludes, and keyframe selectors.
- `SelectorList`, `ComplexSelector`, `CompoundSelector`, and `Combinator`.
- `TypeSelector`, `IdSelector`, `ClassSelector`, `AttributeSelector`, `PseudoClassSelector`, `PseudoElementSelector`, `NestingSelector`, and `Nth` for the argument of `:nth-child()` and its kin.

## Benchmark

Parsing the 252 style sheets of [test/corpus](test/corpus) against [css-tree](https://github.com/csstree/csstree), set to build the same tree, with selectors parsed and values kept raw, and [PostCSS](https://postcss.org), which leaves selectors as strings.

![Time per file to parse with yuku-css, css-tree, and PostCSS](bench/chart.svg)

Median time per file over 3 runs, each in a fresh Node.js 24 process on an Apple M5 Pro. Run it with `bun run bench`.

[docs/benchmark.md](docs/benchmark.md) goes further: real-world and synthetic CSS by size, Bun and Chromium, css-tree's defaults, Lightning CSS, cold start, memory, and bundle size. Run it with `bun run bench:full`.

## Development

Needs [Zig](https://ziglang.org) 0.17 and [Bun](https://bun.sh).

```bash
bun install
bun run build      # zig build && tsdown
bun run typecheck
bun run test
zig build test     # the Zig tests
bun run corpus     # copies the CSS of a Markless checkout into test/corpus
```

The tests cover every node, and check yuku-css against css-tree on every file of the corpus, the `<style>` blocks and `.css` files of the [Markless](https://github.com/compiled-run/markless) repository. [test/parity.test.ts](test/parity.test.ts) lists where the two trees differ on purpose.

## License

MIT
