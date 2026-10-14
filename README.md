# yuku-css

A fast CSS parser, printer and validator, written in Zig and compiled to WebAssembly. It builds [css-tree](https://github.com/csstree/csstree)'s AST and passes css-tree's own test suite.

Parsing tailwind.css (3.5 MB), each parser installed from npm, on Bun:

![Time to parse tailwind.css with yuku-css, css-tree, Stylis, @csstools and PostCSS](https://raw.githubusercontent.com/thejackshelton/css-parser-benchmark-js/main/charts/parse-tailwind.png)

Parsing and printing it back:

![Time to parse and print tailwind.css with yuku-css, Lightning CSS, css-tree and esbuild](https://raw.githubusercontent.com/thejackshelton/css-parser-benchmark-js/main/charts/print-tailwind.png)

Across seven real-world style sheets, yuku-css parses 1.2x to 2.5x faster than css-tree on Bun and 2.7x to 5.4x on Node, and parses and prints 2.7x to 4.8x faster than Lightning CSS on Bun (2.2x to 3.7x on Node). Full results and method: [css-parser-benchmark-js](https://github.com/thejackshelton/css-parser-benchmark-js).

```bash
npm install yuku-css
```

## Usage

```ts
import { parse, transform } from "yuku-css";
import { lexer } from "yuku-css/lexer";

const { ast, diagnostics } = parse(".card { color: red }");

transform(".card { color: red }").code; // ".card{color:red}"

lexer.matchProperty("margin", "1px foo").error; // invalid value
```

It runs in Node.js 18 or newer, Bun, Deno, Workers, and browsers. See [docs/api.md](docs/api.md) for the full API.

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

## License

MIT
