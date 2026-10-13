# The Yuku way

How Arshad Yaseen builds Yuku, written as rules a yuku-css worker follows. Every rule cites its
evidence. Read on 2026-10-13 from `yuku` (branch `parser/tsrx-extension-points`, f8381097) and
`yuku-tsrx-arshad` (main, 80b5547). Paths starting `yuku/` or `tsrx/` refer to those two repos.
Measured performance detail is in `docs/research/yuku-performance.md` (cited as `perf §n`). This
file does not repeat it.

The written rulebook is `yuku/AGENTS.md`, cited as `AGENTS:line`. It ranks the goals as safety,
then performance, then developer experience (`AGENTS:11-15`). It also demands zero technical
debt: "When a problem is discovered, solve it. Do not defer." (`AGENTS:27-31`).

## 1. Architecture

1. **Zig does all the work. TypeScript is a thin layer.** Parsing, semantic analysis and the
   transfer buffer are Zig (`yuku/src/parser/{parser,semantic,ffi}`). JS only encodes the source,
   calls into wasm and decodes the result (`perf §2.5-2.7`). Analysis results stay in typed
   arrays read through accessors, so they never become per-item JS objects (`perf §2.7`). The
   tsrx wrapper is 20 lines of TS around one wasm module (`tsrx/src/index.ts`).
2. **Split the grammar by construct.** There is one file per construct (`yuku/src/parser/syntax/`:
   `class.zig`, `for_loop.zig`, `modules.zig` …), with `ts/` and `jsx/` subfolders. Core files
   are `lexer.zig`, `parser.zig`, `ast.zig` and `token.zig`, and the layout is documented in
   `yuku/CONTRIBUTING.md:59-79`. Syntax files run 135 to 1,326 lines. Only `ast.zig` (2,610,
   mostly `///` docs) and `lexer.zig` (1,475) are bigger.
3. **Data layout is fixed and asserted.** Nodes live in a `MultiArrayList` (struct of arrays),
   indexes are `enum(u32)`, child lists are ranges into one `extras` array, and strings are
   source spans (`perf §2.3`). Sizes are pinned at compile time
   (`yuku/src/parser/ast.zig:2605-2610`: `NodeData == 44`, `Node == 52`).
4. **Memory: one arena per parse, sized in advance.** Capacity is reserved from the source
   length (`perf §2.4`). Rules: `AGENTS:61-64`, `AGENTS:123`. Use `u32` everywhere you own the
   type (`AGENTS:40`).
5. **Transfer: one buffer, exact size, no imports.** The wasm module has no imports and exports
   `alloc`/`free`/`parse`. Records have a fixed width, and the `first_non_ascii` header lets the
   decoder skip UTF-16 mapping for ASCII text (`perf §2.5-2.6`).
6. **Derive code from the Zig types, never by hand.** `zig build package` runs
   `tools/gen_decoder.zig`, `gen_walk_tables.zig` and `gen_token_types.zig` and writes their
   output into `packages/yuku/` (`yuku/build.zig:187-208`). Unicode tables are generated too
   (`build.zig:48`). Tools have their own test step that CI runs (`build.zig:59`,
   `.github/workflows/ci.yml` job `tools`).
7. **One package with subpath exports.** The exports are `yuku`, `yuku/analyzer`, `yuku/ast`,
   `yuku/codegen`, `yuku/types` and `yuku/yuku.wasm` (`yuku/packages/yuku/package.json`
   `exports`). Separate packages were folded into one in 9f93ae63. Wasm loading goes through an
   `#module` import condition: inline bytes by default, a `.wasm` file for workerd (`perf §2.5`,
   `tsrx/package.json` `imports`).
8. **Extension costs nothing when unused.** Dialect hooks resolve at compile time. An unbound
   hook must leave no code behind: d24aa491 removed a dead token test because it grew the
   `parseStatement` frame from 656 to 912 bytes. A dialect is a Zig file of functions named after
   grammar positions (`tsrx/src/tsrx.zig:91-214`: `statement`, `expression`, `jsx_child` …),
   wired in a 6-line `build.zig` (`tsrx/build.zig`).
9. **Runtime floor: ES2020, Node 14.18, baseline wasm.** "Raising the floor is a breaking
   change" (`AGENTS:248-252`). The floor was restored on purpose: 82cff2cc ("build the
   WebAssembly as baseline so every runtime runs it") and be76b678 ("keep the Node.js 14.18
   runtime floor"). CI runs the package on that exact Node version (`ci.yml` "Run on the minimum
   runtime").
10. **Zero dependencies** beyond the toolchain (`AGENTS:230-232`). Scripts are written in Zig or
    TS, never shell (`AGENTS:240`).

## 2. Performance

1. **Design for speed first, then measure.** Write a back-of-the-envelope estimate before
   writing code (`AGENTS:105-113`). Keep the control plane (setup, errors) apart from the data
   plane (per byte, per token, per node) (`AGENTS:110`).
2. **Hot-loop rules** (`AGENTS:117-126`): order checks by cost × probability, keep the common
   path straight-line, move cold paths out of line (`@branchHint(.cold)`, `noinline`), use
   256-entry tables instead of branch chains, hoist invariants, never allocate in a loop, keep
   data small and dense, and validate once at the boundary. Each has a concrete instance in
   Yuku (`perf §2.1-2.2`).
3. **Verify with a stable benchmark.** It must be warmed up, repeated, compared by median, built
   in release mode and run on a quiet machine. Record the baseline first, and keep a change only
   if the numbers back it (`AGENTS:126`). The benchmark harness is `tsrx/bench/index.ts`:
   tinybench with a 5 s run and 1 s warmup (`:64`), each parser in a fresh Node process
   (`:50-57`), `RUNS = 3` and the median (`:11`, `:74-78`), reported as µs per file (`:71`). The
   fixture set is the parity suite itself (`:12`), and the README states the machine and method
   (`tsrx/README.md:37`). The comparison must do equal work: both sides build an ESTree
   (`tsrx/README.md:33`, `bench/index.ts:20-21`).
4. **Measure frame size and code size, not only time.** d24aa491 cites stack-frame bytes. The
   build-mode choice is backed by a measured trade-off (`perf §2.5`, `yuku/build.zig:134-141`).
5. **Every perf claim carries its number.** For example, d935e1bd's body says semanticErrors is
   "29 to 49 percent cheaper than the full analysis".

## 3. Correctness process

1. **An external reference suite is the spec, and it passes at 100%.** Yuku runs
   `parser-test-suite`: Test262, TypeScript and Babel, over 55,000 tests, with AST snapshots from
   Oxc that must match "down to every field, position, and comment", and zero failures
   (`yuku/docs/content/testing.smd:10-20`). The suite runs through the built package, so it
   checks the whole chain from Zig to JS (`testing.smd`, same section).
2. **Sync is a script, pinned to an upstream revision.** `yuku/test/parser/load.ts` resolves the
   remote SHA and re-downloads only when it changes (`:28-70`). CI keys its cache on that SHA
   (`ci.yml` "Resolve suite revision"). In tsrx, `test/sync.ts` clones `tsrx-org/tsrx` at the tag
   that matches the installed `@tsrx/core` version (`:23-34`). It collects every `.tsrx` file and
   every string fixture in the upstream tests (`:36-49`), runs the official parser to label each
   source pass or fail (`:66-77`), and writes it as `suite/{pass,fail}/<sha256-16>.tsrx`
   (`:54-58`).
3. **Each divergence is recorded with a one-line reason.** tsrx keeps an explicit `INVALID` hash
   set with a one-line reason: "what @tsrx/core reads, as acorn does, though TypeScript rejects
   it" (`sync.ts:12-22`). Deferred areas are excluded with a stated reason: "style errors wait
   for the CSS tree" (`sync.ts:74-75`). The README states the same rule (`tsrx/README.md:51`).
   yuku-css already does this in `test/divergences.ts` (`docs/decisions.md`).
4. **Pass cases also round-trip.** A pass case must parse with no errors, then
   generate → reparse → generate must reach a fixed point (`tsrx/test/suite.test.ts:16-22`).
   Codegen is checked the same way across option sets, and the Zig and JS printers must agree
   byte for byte (`testing.smd` "Codegen", `CONTRIBUTING.md:52-55`).
5. **Differential tests against real tools, plus pinned real projects.** The TypeScript checker
   and scope-manager are oracles (`yuku/test/analyzer/*-differential.test.ts`). Real codebases
   are pinned to a commit (`yuku/test/projects/manifest.ts`, `AGENTS:267`).
6. **Results are committed as files.** `yuku/test/parser/run.ts:200-207` writes one
   `results/<suite>.txt` per suite, such as "Passed: 5000/5000" (`results/js_fail.txt:1-4`), and
   exits non-zero on any failure.
7. **Fuzz with OOM injection and dump a reproducer.** The fuzzer runs 3M iterations and injects
   an out-of-memory failure every 20,000 (`yuku/src/parser/testing/fuzz/main.zig:4-7`). A panic
   prints the seed, mode and an escaped and hex input (`:16-50`). Run it with `zig build fuzz`.
8. **Assertions are the first defense.** Write at least two per function, pair them, and check
   both the positive and the negative space (`AGENTS:44-57`). `lexer.zig` has 79 `assert(` calls
   in 1,475 lines.
9. **Put each test in the home for its layer.** A fix almost never needs a new file. Parser
   fixtures go in `test/parser/misc/<lang>/` with auto-written snapshots, and codegen and
   analyzer tests are inline snapshots (`AGENTS:254-271`, `CONTRIBUTING.md:39-48`).
10. **Every commit is green.** "The tree builds and every suite passes at every commit"
    (`AGENTS:275`). CI runs every suite on Linux, macOS and Windows with `if: !cancelled()`, so
    all failures are reported in one run (`ci.yml` job `test`).

## 4. Code style

1. **Naming** (`AGENTS:134-161`): no abbreviations, acronyms keep their capitals (`JSXElement`),
   units come last (`latency_ms_max`), and names that are used together have the same length
   (`source`/`target`). Helpers take the caller's name as a prefix (`parseIf` → `parseIfRest`,
   `tsrx/src/tsrx.zig:404-411`). Use an options struct when arguments can be mixed up.
2. **Comments are rare, lowercase and timeless.** Default to no comment, never narrate history,
   and never use em dashes, semicolons or colons (`AGENTS:162-168`). Measured: `parser.zig` has
   13 `//` lines in 698, and `expressions.zig` has 27 in 1,326. A real one is
   `// reading `program` builds the AST` (`tsrx/bench/index.ts:20`). `///` doc comments are
   full professional prose, and `ast.zig` has 614 of them.
3. **Diagnostics** take a sentence-case message plus an optional help line
   (`yuku/src/parser/parser.zig:472-477`, `:545-549`). Messages follow tsc and V8 wording:
   "Expected '}' to close switch body", "Cannot use import statement outside a module"
   (`syntax/statements.zig:134`, `:348`). Errors are recovered and reported, never thrown
   (`perf §2.2`). Operating errors and programmer errors are kept apart (`AGENTS:95-96`).
4. **Format:** `zig fmt`, 4-space indent, a hard limit of 100 columns, and braced `if`s unless
   they fit on one line (`AGENTS:220-228`). Treat warnings as errors (`AGENTS:75`).
5. **Control flow:** recursion only when it has a bound and that bound is asserted, a limit on
   every loop, positive invariants, and split compound conditions (`AGENTS:37-39`, `:79-91`).
   The decoder recurses to depth 128, then switches to iteration (`perf §2.6`).
6. **Test style:** data-driven over fixture directories (`tsrx/test/suite.test.ts:9-23`, 24
   lines in total). A non-trivial test gets a header comment (`AGENTS:167`).

## 5. Commits and process

1. **Subject: lowercase, imperative, plain, under 72 characters, no prefix.** For example
   "accept legal line breaks in TypeScript declarations" (`AGENTS:276`,
   `CONTRIBUTING.md:94-96`). The style changed from Conventional Commits (e28e05c6
   `refactor!:`) to Go-style `area:` (d33f8963, 2026-10-01) to plain (df7b067a, 2026-10-10).
   All 54 non-merge subjects since 2026-10-01 are at most 71 characters long.
2. **The body says why, only when the subject cannot.** Bodies are prose wrapped at 72 columns.
   A breaking change always has a body that says what to do instead (`AGENTS:277`, examples
   9f93ae63, d935e1bd). There are no attribution trailers (`AGENTS:279`).
3. **One change, one purpose, and callers updated in the same commit** (`AGENTS:275`). Small
   direct commits sit beside large squashed PRs (#234, #239). Since 2026-09-01, 30 of 35 commits
   that touched source also touched tests.
4. **Docs move with the code.** 82cff2cc changes `build.zig`, `AGENTS.md` and the docs pages
   together. be76b678 changes the floor in `package.json`, the README and the docs together.
   Run `bun run docs:llms` after editing docs (`CONTRIBUTING.md:90`).
5. **Order inside a feature: suite first, then features against it.** tsrx went: initial commit
   (6fd06d3), then benchmark (45e7127, 487da97), then suite and sync (adc8144: 2,135 files),
   then dialect updates (80b5547).
6. **Delete, do not deprecate** (`AGENTS:280`). Removing a public export is breaking.
7. **Release notes are written by hand** in `CHANGELOG.md`, for users only. Commit the notes,
   then bump the version (`AGENTS:282-289`).

## 6. Pre-commit checklist for yuku-css work

- [ ] The change has one purpose, and every caller and generated file is updated in the same
      commit.
- [ ] Generated outputs (decoder, walk tables, types) were regenerated by the build, not edited
      by hand.
- [ ] Zig: `zig fmt` is clean, no line is over 100 columns, new functions carry at least 2
      assertions, every loop has a limit, there is no `usize` outside std seams, and any new
      node struct has its size pinned in a `comptime` assert.
- [ ] Hot path: nothing allocates inside the loop, byte classes come from tables, and cold paths
      are out of line. The perf estimate is written down before the code.
- [ ] `bun run sync` reproduces the suite from the pinned css-tree version with no unexplained
      diff. Every new divergence is in `test/divergences.ts` with a one-line reason.
- [ ] `bun run test` is fully green, including parity and round-trip (generate → reparse →
      generate is a fixed point). `bun run typecheck` passes.
- [ ] Any change that could affect speed was benchmarked with `bun run bench`, baseline vs change
      (fresh process, median of 3). Keep it only if the numbers back it, and put the numbers in
      the commit body.
- [ ] The runtime floor is unchanged: ES2020, Node 14.18, baseline wasm. Raising it is a
      deliberate breaking change.
- [ ] Comments are lowercase phrases that say why. There are no history or change narratives,
      no em dashes, semicolons or colons, and public API has `///` prose.
- [ ] README, `docs/decisions.md` and the docs are updated in the same commit when behavior or
      the floor changes.
- [ ] The commit message is a lowercase imperative subject of 72 characters or fewer with no
      prefix, plus a body only for why or a breaking change, and no trailers. (yuku-css's own
      history so far uses capitalized subjects, such as 6b7ef23. Yuku's rule is lowercase.)
