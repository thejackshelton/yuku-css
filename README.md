# yuku-css

A fast CSS parser, printer and validator, written in Zig and compiled to WebAssembly. It builds [css-tree](https://github.com/csstree/csstree)'s AST and passes css-tree's own test suite.

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

## Benchmark

Each row does the same work on both sides, on the 231 real-world style sheets of [test/corpus](test/corpus):

| Task | Compared with | yuku-css is |
|---|---|---|
| Validate a style sheet | css-tree | **8.2x faster** |
| Parse into css-tree's AST | css-tree | **3.3x faster** |
| Parse and print | Lightning CSS (native) | **3.1x faster** |
| Print an AST | css-tree | **2.1x faster** |

Median time per file over 3 runs, each in a fresh Node.js 24 process on an Apple M5 Pro. Lightning CSS also types every value, so its row is not identical work. More in [docs/benchmark.md](docs/benchmark.md); run it with `bun run bench:full`.

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
