# yuku-css

A fast CSS parser, written in Zig and compiled to WebAssembly, that builds [css-tree](https://github.com/csstree/csstree)'s tree.

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

const { ast, comments, diagnostics } = parse(source);

const rule = ast.children[0] as Rule;
rule.prelude; // SelectorList of Selector, each of simple selectors and Combinator, as css-tree has them
rule.block.children; // Declaration { important: true, property: "color", value: Value { children: [Identifier] } }, then Rule
```

It runs in Node.js 18 or newer, Bun, Deno, Workers, and browsers.

The tree is css-tree 3.2.1's, node for node and field for field, with arrays in place of css-tree's `List`. Every node has `start` and `end`, UTF-16 offsets into the source, so `source.slice(node.start, node.end)` is its text. With `positions: true`, each node has css-tree's `loc` instead, with lines and columns. Its nodes are typed in [src/ast.ts](src/ast.ts).

`parse` returns `{ ast, comments, tokens?, diagnostics }`, as Yuku returns `{ program, comments, tokens?, diagnostics }`. `ast` is the node the source is read as: a `StyleSheet`, or with `context` any of css-tree's parse contexts. `comments` holds every comment, in source order. As Yuku builds `program`, the tree is built when `ast` is first read, so a caller that reads only `diagnostics` skips it.

`parse` never throws on bad CSS. What does not parse is kept as `Raw`, as css-tree keeps it, with a diagnostic in Yuku's shape carrying css-tree's message, so a caller that must reject bad CSS checks `diagnostics.length`. Where the CSS specifications read an error that css-tree does not, such as a comment the source ends in or a selector that starts with a combinator outside `:has()` and nesting, the tree is still css-tree's and a diagnostic reports the error.

### Options

| Option | Default | |
|---|---|---|
| `context` | `"stylesheet"` | read the source as `"atrule"`, `"atrulePrelude"`, `"mediaQueryList"`, `"mediaQuery"`, `"rule"`, `"selectorList"`, `"selector"`, `"block"`, `"declarationList"`, `"declaration"` or `"value"` |
| `atrule` | | the at-rule, such as `"media"`, whose prelude the `"atrulePrelude"` context reads; without one, the prelude is component values |
| `positions` | `false` | `loc` in place of `start` and `end` |
| `filename`, `offset`, `line`, `column` | `"<unknown>"`, `0`, `1`, `1` | where `loc` says the source is |
| `tokens` | `false` | keep every token in `tokens`, packed as `tokenize` packs them |
| `onParseError`, `onComment`, `onToken` | | css-tree's callbacks, called after parsing from the result: each diagnostic as a css-tree `SyntaxError`, each comment with its `loc`, each token's type and offsets |
| `parseRulePrelude` | `true` | `false` keeps each selector as `Raw` |
| `parseValue` | `true` | `false` keeps each declaration value as `Raw` |
| `parseCustomProperty` | `false` | `true` parses custom property values and `var()` fallbacks as a `Value` |
| `parseAtrulePrelude` | `true` | `false` keeps each at-rule prelude as `Raw` |

### Tokens

```ts
import { tokenize, tokenNames } from "yuku-css";

for (const token of tokenize("a { color: red }")) {
  tokenNames[token >>> 24]; // "ident-token", "whitespace-token", "{-token", …
  token & 0xffffff; // the UTF-16 offset where the token ends
}
```

`tokenize` packs each token as css-tree's `offsetAndType` does, with the 26 token types of `tokenTypes`.

### Printing

```ts
import { generate } from "yuku-css/codegen";

generate(stylesheet); // ".card:has(>img){color:red!important;&:hover{color:blue}}"
generate(stylesheet, { sourceMap: true }); // { css, map }, map.toString() the JSON
```

`yuku-css/codegen` prints css-tree's tree, any of its 49 node types, byte for byte as css-tree's `generate` does, from yuku-css or from css-tree, with arrays or `List`s for children. It takes css-tree's options: `sourceMap`, `mode` (`"safe"`, the default, or `"spec"`, which spaces only the token pairs the CSS Syntax needs spaced), and `decorator`, which wraps css-tree's generator handlers. A source map maps where each `Atrule`, `Selector`, and `Declaration` with a `loc` starts, as css-tree's does.

### Transforming

```ts
import { transform } from "yuku-css";

const { code, map, diagnostics } = transform(source, { filename: "card.css", sourceMap: true });
code; // ".card:has(>img){color:red!important;&:hover{color:blue}}"
```

`transform` parses and prints in one WebAssembly call, building no tree in JavaScript: `code` is byte for byte what `generate(parse(source).ast)` prints, and with `sourceMap: true`, `map` is the JSON of the map `generate` makes from a tree parsed with `positions`. It takes `mode`, `context`, `atrule`, `parseRulePrelude`, `parseValue`, `parseAtrulePrelude` and `parseCustomProperty` as `parse` and `generate` do. Like `parse`, it never throws on bad CSS and returns the same `diagnostics`. Its output drops whitespace and comments other than `/*!`, as css-tree's `generate` does, and minifies no further.

### Walking

```ts
import { walk, find, clone } from "yuku-css/ast";

walk(stylesheet, {
  visit: "Declaration",
  enter(node) {
    this.rule; // the Rule it is in
  },
});
```

`yuku-css/ast` has the rest of css-tree's API for its tree: `walk` (with `enter`, `leave`, `visit`, `reverse`, and `walk.break` and `walk.skip`), `find`, `findLast`, `findAll`, `clone`, `List`, `fromPlainObject`, `toPlainObject`, `property`, `keyword`, `vendorPrefix`, `isCustomProperty`, and `ident`, `string`, and `url`, each with `encode` and `decode`. A handler's `item` and `list` are the `List` item and `List`, or for an array the index and the array.

### Validating

```ts
import { lexer, definitionSyntax } from "yuku-css/lexer";

lexer.matchProperty("color", "rgb(1 2 3)").matched; // css-tree's match tree, or null
lexer.matchProperty("margin", "1px foo").error; // a SyntaxMatchError, mismatchOffset 4
lexer.matchType("length", "2em");
lexer.matchAtrulePrelude("media", "(width > 600px)");
lexer.matchStylesheet(".a { color: red; margin: 1px foo }"); // a match result for each declaration
definitionSyntax.parse("<length> | auto"); // css-tree's tree of the CSS Value Definition Syntax
```

`yuku-css/lexer` is css-tree's lexer: `matchProperty`, `matchType`, `matchAtrulePrelude`, `matchAtruleDescriptor`, `matchDeclaration`, `match`, the `check*` and `get*` methods, `validate` and `dump`, with `createLexer` and `fork` for grammars of your own, and `definitionSyntax` with `parse`, `generate` and `walk`. A match result has css-tree's shape, `{ matched, iterations, error, getTrace, isType, isProperty, isKeyword }`, with its tree and error built when first read. A value is a string or a tree, from yuku-css or css-tree. A tree is matched as the tokens it prints, each naming the node that printed it, as css-tree matches one, so a match tree's `node`, `getTrace`, `isType`, `isKeyword` and the fragment search, `findValueFragments`, `findDeclarationValueFragments` and `findAllFragments`, point at its nodes. `checkStructure` checks a tree against css-tree's node structure, taking yuku-css's arrays for lists and its `start` and `end` for `loc`.

The grammar is the W3C's own, [@webref/css](https://www.npmjs.com/package/@webref/css) 8.7.5, where css-tree's is mdn-data. Every definition is parsed at build time, by `tools/gen_grammar.zig`, into compact trees the WebAssembly embeds, so the lexer parses no grammar at startup. A definition webref lacks, and css-tree's fixtures need, is added in [src/grammar/patch.json](src/grammar/patch.json) with the reason. The grammar lives in its own WebAssembly module, 313.2 kB, 112.5 kB gzipped with the parser it carries for `matchStylesheet`, so `yuku-css` does not carry it.

`matchStylesheet(source)` parses a whole style sheet and matches every declaration in one call into the WebAssembly, writing all results to one buffer; a declaration written as an earlier one reuses its result and shares its tree. Each result is a match result with the property and the value's offsets, its error placed in the sheet. Errors carry css-tree's prototype, name, message, offsets and location, but no stack frames, which cost more than the match.

Matching is css-tree's algorithm, in Zig: the same match graph, the same backtracking, the same iteration budget. Over the same grammar it gives every declaration of [test/corpus](test/corpus) the same tree, iteration count and error as css-tree. Over their two grammars, yuku-css and css-tree disagree on 3 of the corpus's 12,945 declarations, each listed in [test/divergences.ts](test/divergences.ts) with the reason.

### Where it differs from css-tree

Where css-tree reads CSS otherwise than the CSS Syntax, Nesting, and Selectors specifications, yuku-css follows the specifications. Most visibly, css-tree reads a nested rule that does not start with `&`, such as `.a { .b {} }`, as a broken declaration, and reads no column combinator `||`. In at-rule preludes, a media, supports or container condition whose keywords Media Queries 4 or CSS Conditional 3 reject, as in `@media screen (color)`, keeps css-tree's tree with a diagnostic, and the end of input closes an open feature such as `@media (color` where css-tree reports an error and drops it. Parentheses in a condition that hold a nested condition, such as `@supports (not (display: grid))`, or any other balanced tokens, which the grammars read as general-enclosed, parse with no error where css-tree reports one, and `@custom-media`'s prelude is read as Media Queries 5 defines it, an extension name and then a media query list, `true` or `false`. [test/divergences.ts](test/divergences.ts) lists every difference with the spec it follows and the css-tree fixtures it fails; [test/compare.ts](test/compare.ts) forks css-tree to parse the same way for the parity tests.

css-tree's own fixtures run as the suite, `bun test test/suite.test.ts`, refreshed with `bun run sync`. A fixture of what yuku-css does not build yet, the generator, is listed as pending in the same file and must fail until it lands. The lexer's fixtures and css-tree's lexer tests run from [test/grammar](test/grammar), `bun test test/grammar`.

`generate` prints a `Ratio` without a right term as `16/1`, where css-tree throws, and `string.decode` and `url.decode` keep what comes before an escaped closing quote or parenthesis, as in `"ab\"`, where css-tree keeps only the quote.

## Benchmark

Parsing the 231 style sheets of [test/corpus](test/corpus) that every parser here reads without an error. [css-tree](https://github.com/csstree/csstree) is set to build the tree `yuku-css loc` builds: selectors, values and at-rule preludes parsed, with positions; `yuku-css` gives offsets in their place. [PostCSS](https://postcss.org) keeps selectors, values and preludes as strings, so it does less.

![Time per file to parse with yuku-css, css-tree, and PostCSS](bench/chart.svg)

Against `yuku-css loc`, css-tree takes 3.21× as long. The rest of the API, per file of the same corpus, each row on the files both sides read cleanly:

| Task | yuku-css | Against | Same work |
|---|---|---|---|
| Tokenize | `tokenize`, 3.8 µs | css-tree `tokenize`, 6.7 µs (1.78×) | yes |
| Print css-tree's tree | `generate`, 6.0 µs | css-tree `generate`, 10.3 µs (1.71×) | yes |
| Print css-tree's tree with a source map | `generate`, 15.1 µs | css-tree `generate`, 29.7 µs (1.97×) | yes |
| Validate every declaration | `lexer.matchStylesheet`, 18.6 µs | css-tree `parse` and `matchDeclaration`, 155.3 µs (8.37×) | yes, over a different grammar: @webref/css, where css-tree's is mdn-data |
| Check for parse errors | `parse`, reading only `diagnostics`, 7.8 µs | css-tree `parse` with `onParseError`, no positions, 41.7 µs (5.33×) | no: diagnostics only, yuku-css builds no tree in JS, where css-tree builds its whole tree |
| Parse and print | `transform`, 10.8 µs | Lightning CSS `transform`: native, 33.0 µs (3.06×); WebAssembly, 86.1 µs (7.99×) | no: Lightning CSS types every value and pretty-prints, yuku-css prints compactly |

Median time per file over 1 runs, each in a fresh Node.js 24.15.0 process on an Apple M5 Pro, files timed smallest first. [docs/benchmark.md](docs/benchmark.md) has Lightning CSS by file size, Bun and Chromium, real-world and synthetic CSS, cold start, memory, bundle size and where yuku-css loses. Run it with `bun run bench:full`; `bun run bench` times the chart's parsers alone, and `bun run bench tokenize`, `generate`, `match` or `validate` one row, without touching the README.

## Development

Needs [Zig](https://ziglang.org) 0.17 and [Bun](https://bun.sh).

```bash
bun install
bun run build      # zig build, which also writes src/decode.js from the Zig layouts, then tsdown
bun run typecheck
bun run test
zig build test     # the Zig tests
bun run corpus     # copies the CSS of a Markless checkout into test/corpus
bun run sync       # copies css-tree's test fixtures into test/csstree, as `bun run test` does
```

The tests check every token, node, position, and error against css-tree on every file of the corpus, the `<style>` blocks and `.css` files of the [Markless](https://github.com/compiled-run/markless) repository, on broken CSS, and on the corpus mutated at random. `generate` is checked against css-tree's on every case of css-tree's fixtures and on the corpus, with and without source maps, and the walker and its kin run css-tree's own tests.

## License

MIT
