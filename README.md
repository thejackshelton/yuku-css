# yuku-css

A fast CSS parser, printer and validator, written in Zig and compiled to WebAssembly. It builds [css-tree](https://github.com/csstree/csstree)'s AST, passes css-tree's own test suite, and has zero dependencies.

Up to **8.6x faster than css-tree**, **8.5x faster than esbuild** and **4.8x faster than Lightning CSS** at parsing and printing CSS, and up to **5.4x faster than css-tree** and **5.1x faster than PostCSS** at parsing it, every tool installed from npm.

Parsing and printing tailwind.css (3.5 MB) on Bun:

![Time to parse and print tailwind.css with yuku-css, Lightning CSS, css-tree, esbuild and @swc/css](https://raw.githubusercontent.com/thejackshelton/css-parser-benchmark-js/main/charts/print-tailwind.png)

Parsing it to an AST:

![Time to parse tailwind.css with yuku-css, css-tree, Stylis, @csstools and PostCSS](https://raw.githubusercontent.com/thejackshelton/css-parser-benchmark-js/main/charts/parse-tailwind.png)

Seven real-world style sheets on Bun and Node, with the method: [css-parser-benchmark-js](https://github.com/thejackshelton/css-parser-benchmark-js).

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
