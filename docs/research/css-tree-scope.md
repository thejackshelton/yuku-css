# css-tree scope: inventory, gaps, and a build order for yuku-css

Research date: 2026-10-13. Reference: css-tree 3.2.1 as installed at `node_modules/css-tree` (lib/ paths below are relative to it), and the upstream repo cloned at `/tmp/csstree` (commit `f898015`, 2026-09-16, same 3.2.1) for tests, fixtures, and docs. yuku-css as of commit `0f8bebe`.

## 1. Summary

css-tree is about 11,800 lines of JavaScript in nine subsystems: tokenizer (1,497 lines), parser core (533), syntax definitions (the 49 node types, at-rule and pseudo-class hooks, scopes: 3,956), generator (378), walker (291), plain-object convertor (32), lexer, the part that checks values against property grammars (3,300), definition-syntax, the parser for the grammar notation itself (905), and utilities (924). It ships grammar data from `mdn-data` 2.27.1 plus its own `data/patch.json`: 499 value types, 704 properties, and 20 at-rules once merged.

yuku-css today covers one slice of that: the stylesheet structure (rules, at-rules, blocks, declarations) and selectors. Values and at-rule preludes stay as `Raw` text. It has no public tokenizer, no parse options or contexts, no line/column positions, no comment nodes, no generator, walker, clone, or List, no lexer, and no utilities. What it has is solid. It never throws, it reports diagnostics, its nested-rule handling follows the spec where css-tree misreads, and it matches css-tree on all 252 corpus files after documented normalizations.

Reaching full scope is roughly 9 times the current code (see §5). The biggest single item is the lexer (definition-syntax parser, match graph, matcher, generic types, data). The parser work, meaning values plus the media/supports/container/layer/scope/import preludes, is the next biggest. The rest is mostly JavaScript-side API work: generator, walker, List, utilities.

The first decision, and the one that shapes everything else, is the tree shape. yuku-css uses spans, arrays, `AtRule`, `ComplexSelector`, and `CompoundSelector`. css-tree uses `loc` objects, `List`, `Atrule`, and a flat `Selector`. Every parity test, the generator, the walker's per-type field tables, and the lexer's AST-to-token path all depend on that choice (open question 1).

## 2. css-tree inventory

### 2.1 Public exports

From `lib/index.js:1-29`: `tokenize`, `parse`, `generate`, `lexer`, `createLexer`, `walk`, `find`, `findLast`, `findAll`, `toPlainObject`, `fromPlainObject`, `fork`, `createSyntax`, `List`, `Lexer`, `tokenTypes`, `tokenNames`, `TokenStream`, `OffsetToLocation`, `definitionSyntax` (`parse`/`generate`/`walk`/`SyntaxError`), `clone`, `keyword`, `property`, `vendorPrefix`, `isCustomProperty`, `ident`, `string`, `url`, `version`.

Subpath exports (`package.json` "exports"): `./tokenizer`, `./parser`, `./selector-parser` (a selector-only parser built from `lib/syntax/config/parser-selector.js`), `./generator`, `./walker`, `./convertor`, `./lexer`, `./definition-syntax`, `./definition-syntax-data`, `./definition-syntax-data-patch`, `./utils`. Each is a smaller build of the same syntax, so a consumer can bundle only the parser, for example.

`createSyntax(config)` (`lib/syntax/create.js:9-55`) builds the whole toolset from one config object. That object holds `parseContext`, `scope`, `atrule`, `pseudo`, `node` (each node's `structure`/`parse`/`generate`/`walkContext`), `features`, plus the lexer data `types`/`properties`/`atrules`/`units`/`cssWideKeywords`/`generic`. `fork(extension)` merges an extension into a copy of that config through `mix` (`lib/syntax/config/mix.js:52-122`). Types and properties can be extended with a leading `|`, for example `"| foo"` appends an alternative. Atrule/pseudo entries merge only `parse`, and node entries merge `name/structure/parse/generate/walkContext`.

### 2.2 Tokenizer

- Token types (`lib/tokenizer/types.js:3-28`): the 25 CSS Syntax Level 3 token types plus `Comment = 25`. The 25 are EOF, Ident, Function, AtKeyword, Hash, String, BadString, Url, BadUrl, Delim, Number, Percentage, Dimension, WhiteSpace, CDO, CDC, Colon, Semicolon, Comma, `[`, `]`, `(`, `)`, `{`, `}`. The spec has no comment token, since comments are consumed and dropped. css-tree emits them so it can offer `onComment` and keep `/*! */`. Names are in `lib/tokenizer/names.js`.
- Algorithm: a direct transcription of CSS Syntax 3 §4.3. See `lib/tokenizer/index.js`: consume numeric token :30, ident-like (including the `url(` special case) :57, string :97, url :162, the main "consume a token" switch :255-504. Character classes are in `char-code-definitions.js` (`isIdentifierStart`, `isNumberStart`, `isValidEscape`, a category table at :195-212). Helpers are in `utils.js` (`consumeNumber` :147, `consumeName` :119, `consumeEscaped` :90, `consumeBadUrlRemnants` :207, `decodeEscaped` :234, `cmpStr`, `findWhiteSpaceStart/End`).
- Tokens are positions only. There is no decoded value, no numeric value, and no integer/number type flag. A token is `(type, start, end)`.
- Public API:
  - `tokenize(source, onToken(type, start, end))` (:25). It returns nothing and drives a callback.
  - `TokenStream` (`TokenStream.js:41-366`) packs type and end offset into one `Uint32Array` (`offsetAndType`). It also precomputes a `balance` array that maps every bracket opener to its closer and back (:52-135). On top of that it offers `lookupType`, `lookupTypeNonSC`, `lookupValue`, `lookupOffset`, `getTokenStart/End/Type`, `isBalanceEdge`, `isDelim`, `skip`, `next`, `skipSC`, `skipUntilBalanced` (:304-338, the engine of all error recovery), `getBlockTokenPairIndex`, `forEachToken`, and `dump`.
  - `OffsetToLocation` (`OffsetToLocation.js:43-80`) lazily builds a line/column table, with `offset`/`line`/`column` start overrides.
- Tests: `fixtures/tokenize/*.json` (7 files: at-keyword, dimension, function, hash, ident, string, url; 79 valid + 33 invalid strings, some with explicit token lists) driven by `lib/__tests/fixture/tokenize.js`. `lib/__tests/tokenizer.js` (328 lines, 15 cases) checks a 31-token stream including `balance` values, plus `dump`, `lookup*`, and `skip` behaviour.

### 2.3 Parser

Entry point: `createParser(config)` → `parse(source, options)` (`lib/parser/create.js:112-412`).

**Options** (`create.js:348-397`, `docs/parsing.md`):

| Option | Default | Effect |
|---|---|---|
| `context` | `'default'` (= stylesheet) | Which node to parse; unknown context throws (`:372-374`) |
| `atrule` | — | For `context: 'atrulePrelude'`, picks the at-rule's prelude parser (`config/parser.js:9-11`) |
| `kind` | — | For `context: 'condition'` (`media`/`supports`/`container`) |
| `positions` | false | Fill `loc` = `{source, start:{offset,line,column}, end:{…}}` |
| `filename` | `'<unknown>'` | `loc.source` |
| `offset`, `line`, `column` | 0, 1, 1 | Shift positions for fragments |
| `onParseError(error, fallbackNode)` | noop | Called once per recovered error |
| `onComment(value, loc)` | — | Every comment, without `/*` and `*/` (`:386-397`) |
| `onToken` | — | Function `(type,start,end,index)` with a token-iteration `this` API (`:317-346`), or an array to fill |
| `list` | true | `List` children (true) or plain arrays (false) (`:376`) |
| `parseAtrulePrelude` | true | false → prelude is `Raw` |
| `parseRulePrelude` | true | false → selector is `Raw` |
| `parseValue` | true | false → declaration value is `Raw` |
| `parseCustomProperty` | false | true → `--x` values (and `var()` fallbacks) parsed as `Value` |

**Contexts** (`lib/syntax/config/parser.js:6-26`): `default`, `stylesheet`, `atrule`, `atrulePrelude`, `mediaQueryList`, `mediaQuery`, `condition` (undocumented), `rule`, `selectorList`, `selector`, `block`, `declarationList`, `declaration`, `value`. If input is left over after the context node, parse throws a `SyntaxError` (`create.js:401-403`) instead of calling `onParseError`. For example, `parse("a b", {context:"declaration"})` throws "Colon is expected".

**Node types (49)**, from `lib/syntax/node/*.js` `structure` exports:

| Group | Nodes (fields) |
|---|---|
| Structure | `StyleSheet{children: Comment\|CDO\|CDC\|Atrule\|Rule\|Raw}`, `Atrule{name, prelude: AtrulePrelude\|Raw\|null, block: Block\|null}`, `AtrulePrelude{children}`, `Rule{prelude: SelectorList\|Raw, block}`, `Block{children: Atrule\|Rule\|Declaration}`, `DeclarationList{children}`, `Declaration{important: boolean\|string, property, value: Value\|Raw}`, `Raw{value}`, `Comment{value}`, `CDO`, `CDC` |
| Selectors | `SelectorList{children: Selector\|Raw}`, `Selector{children}` (flat: simple selectors and `Combinator` interleaved, no compound node), `TypeSelector{name}` (namespace kept inside the name, `ns\|a`), `IdSelector`, `ClassSelector`, `AttributeSelector{name: Identifier, matcher, value: String\|Identifier\|null, flags}`, `PseudoClassSelector{name, children: List\|null}`, `PseudoElementSelector{name, children}`, `NestingSelector`, `Combinator{name}`, `Nth{nth: AnPlusB\|Identifier, selector}`, `AnPlusB{a, b}` |
| Values | `Value{children}`, `Identifier{name}`, `Number{value}`, `Dimension{value, unit}`, `Percentage{value}`, `Hash{value}`, `String{value}` (decoded), `Url{value}` (decoded), `Function{name, children}`, `Operator{value}`, `Parentheses`, `Brackets`, `UnicodeRange{value}`, `WhiteSpace{value}`, `Ratio{left, right}` |
| Preludes | `MediaQueryList`, `MediaQuery{modifier, mediaType, condition}`, `Condition{kind, children}`, `Feature{kind, name, value}`, `FeatureRange{kind, left, leftComparison, middle, rightComparison, right}`, `FeatureFunction{kind, feature, value: Declaration\|Selector}`, `GeneralEnclosed{kind, function, children}`, `SupportsDeclaration{declaration}`, `Layer{name}`, `LayerList`, `Scope{root, limit}` |

Walk contexts (`walkContext` export): `stylesheet`, `atrule`, `atrulePrelude`, `rule`, `selector` (on SelectorList), `block`, `declaration`, `function` (on Function, PseudoClassSelector, PseudoElementSelector).

**Statement-level grammar and recovery.** All recovery goes through `parseWithFallback(consumer, fallback)` (`create.js:147-166`): it tries the consumer, and on a throw it rewinds to the start token, builds a `Raw` with `skipUntilBalanced` up to a stop character, then calls `onParseError(e, fallback)`.
- `StyleSheet` (`StyleSheet.js:28-78`): skips whitespace. It keeps a comment as a `Comment` node only when it starts with `/*!` (:40-45) and drops the rest. CDO/CDC become nodes, `@` goes to `Atrule`, and everything else goes to `Rule`. Both fall back to `Raw` up to `{`/`;`.
- `Block(isStyleBlock)` (`Block.js:45-85`): in a style block, an at-keyword goes to `Atrule`. A `&` delim goes to `Rule`. **Anything else is parsed as a `Declaration`**, falling back to `Raw` up to and including `;`. A lone `;` becomes `Raw ";"`. In a non-style block every item is a `Rule`.
- `Atrule` (`Atrule.js:36-86`): an at-rule listed in `lib/syntax/atrule/index.js` supplies its own `prelude`/`block` parsers. Otherwise the prelude is a generic `readSequence(scope.AtrulePrelude)` and the block kind is guessed by `isDeclarationBlockAtrule` (:12-27). The guess scans ahead: a `}` before any `{` or `@` means declarations.
- `Declaration` (`Declaration.js:50-109`): `readProperty` (:122-153) accepts the legacy hack prefixes `*`, `$`, `+`, `#`, `&`, `/`, `//` and a hash-token property name. `!` followed by any ident gives `important: true` for `important` and the ident string otherwise (`!ie` → `"ie"`, :156-165). Custom properties keep raw whitespace and get a lone `WhiteSpace` child when empty (:75-86).
- `Rule` (`Rule.js:26-46`): `SelectorList` falling back to `Raw` up to `{`; the block is always `Block(true)`.

**Per-at-rule prelude/block parsers** (`lib/syntax/atrule/`):

| At-rule | Prelude | Block |
|---|---|---|
| `@media` | `MediaQueryList` | `Block(nested)` |
| `@supports` | `Condition('supports')` | `Block(nested)` |
| `@container` | optional name `Identifier` (not `none/and/not/or`) + `Condition('container')` | `Block(nested)` |
| `@import` | `String`\|`Url`, then `layer`/`layer(…)` (`Layer`), `supports(…)` (`Declaration` or `Condition`), `MediaQueryList` | none |
| `@layer` | `LayerList` | `Block(false)` |
| `@scope` | `Scope` | `Block(nested)` |
| `@page` | `SelectorList` | `Block(true)` |
| `@nest` | `SelectorList` (obsolete draft) | `Block(true)` |
| `@font-face` | none | `Block(true)` |
| `@starting-style` | none | `Block(nested)` |
| others (`@keyframes`, `@font-feature-values`, `@property`, `@counter-style`, …) | generic value sequence | heuristic |

Condition grammar (`Condition.js:26-110`): an ident becomes an `Identifier` (`and`/`or`/`not`). For `(`, `media`/`container` try `Feature` or `FeatureRange` and `supports` tries `SupportsDeclaration`. That falls back to a nested `Condition` in parentheses, then to `GeneralEnclosed`. A function token goes to `FeatureFunction`, whose features are `supports: selector()` and `container: style()` (`config/parser.js:27-38`), falling back to `GeneralEnclosed`.

**Scopes** (`lib/syntax/scope/`): a scope tells `readSequence` how to turn the next token into a node. `Value`/`AtrulePrelude` use `default.js:23-85`: Hash, Comma→Operator, `(`→Parentheses, `[`→Brackets, String, Dimension, Percentage, Number, Function (or `url(`→Url), Url, Ident (or `u+…`→UnicodeRange), Delims `/ * + -`→Operator. A `#` delim is an error, and **any other delim ends the sequence** (TODO at :73-76), which triggers the `Raw` fallback. The `Value` scope adds the special functions `var()` (`function/var.js`: an Identifier, then `Raw` or `Value` fallback) and `expression()` (raw), and pads `+`/`-` operators with spaces (`scope/value.js:15-22`). The `Selector` scope (`scope/selector.js:33-89`) maps tokens to simple selectors and combinators (including `/deep/` via `/`). It accepts `Number`/`Percentage` as `Percentage` nodes so keyframe selectors parse, and its `onWhiteSpace` inserts descendant `Combinator{name:' ', loc:null}`.

**Pseudo-class argument parsers** (`lib/syntax/pseudo/index.js:39-56`): a SelectorList for `has`, `is`, `matches`, `-moz-any`, `-webkit-any`, `where`, `not`; `Nth` for `nth-child`, `nth-last-child`, `nth-of-type`, `nth-last-of-type`; a single `Selector` for `slotted`, `host`, `host-context`; an `Identifier` for `dir`; and a comma list of Identifier/String for `lang` (`pseudo/lang.js`). Unknown functional pseudos and all pseudo-elements other than `::slotted` get `[Raw]`.

**Errors**: `parse.SyntaxError` (`lib/parser/SyntaxError.js:52-70`) carries `message`, `source`, `offset`, `line`, `column`, `sourceFragment(extraLines)`, and `formattedMessage`, which draws the source excerpt with a caret and handles tabs and long lines.

**Parser tests**: `fixtures/ast/**.json` hold 721 positive cases and 214 error cases across 49 files. Each case has `source`, an optional `generate` (expected output) and `options`, and an `ast`, or an `error` message with a `^` offset marker. The scope is the parent directory name, which also becomes the parse context. Per area (positive + error): atrule 116+14 (incl. per-at-rule files for container, font-face, font-feature-values, import, layer, media, nest, scope, starting-style, supports), atrulePrelude 2, block 29, declaration 73+4, declarationList 19, mediaQuery 43+6, rule 33, selector 196+121 (incl. 12 functional-pseudo files), selectorList 2+8, stylesheet 48+28, value 160+33 (incl. calc/element/expression/var). The loader is `lib/__tests/fixture/ast.js`, which wraps a fixture AST in a parent when its type is narrower than the scope. `lib/__tests/parse.js` (581 lines) adds AnPlusB/UnicodeRange cases generated from `fixtures/definition-syntax-match/generic.json`, plus context, `list`, `onParseError`, `formattedMessage`, `onComment`, `onToken`, and `positions` tests. `parse-extension.js` covers `fork()` parser extensions and `parse-selector.js` covers the selector-only build.

### 2.4 Walker

`createWalker(config)` (`lib/walker/create.js:150-287`) derives, for each node type, the list of child fields from its `structure` (:16-59). Then `walk(ast, fn | {enter, leave, visit, reverse})`:
- `enter`/`leave` are called with `this` = context (`root`, `stylesheet`, `atrule`, `atrulePrelude`, `rule`, `selector`, `block`, `declaration`, `function`, plus `break`/`skip`) and arguments `(node, item, list)`. `item`/`list` are the List item and List, or undefined outside lists.
- Returning `walk.break`/`this.break` stops the walk; returning `walk.skip` from `enter` skips the node's children (:167-190).
- `visit: 'Type'` filters handlers to one type. For `Atrule`, `Rule`, and `Declaration` it also uses a fast path that walks only structural containers (:120-148, :221-232).
- `reverse: true` iterates fields and lists backward.
- `find`, `findLast` (reverse walk), `findAll` (:245-284).
- Tests: `lib/__tests/walk.js` (669 lines: order, break, skip, reverse, bad options, plus a per-fixture walk over every AST fixture) and `find.js`.

### 2.5 Generator

`createGenerator(config)` (`lib/generator/create.js:26-102`): each node's `generate` calls `this.token(type, value)`, `this.node(child)`, `this.children(node, delimiterFn)`, or `this.tokenize(raw)`. The generator decides when to insert whitespace by token-type pairs (`token-before.js`). In `spec` mode (:120) it follows the CSS Syntax §serialization pair table. `safe` mode (default, :121) adds extra pairs. A `\` delim gets a newline. Options:
- `sourceMap: true` returns `{css, map}` (a `source-map-js` `SourceMapGenerator`), mapping only `Atrule`, `Selector`, and `Declaration` starts (`sourceMap.js:3`).
- `decorator(handlers)` wraps `node`/`token`/`emit`/`result`. The lexer uses it to turn an AST into tokens (`lexer/prepare-tokens.js:3-28`).
- `mode: 'safe' | 'spec'`.
- Output is minified: no whitespace beyond what is needed, and `;` only between declarations (`Block.js:87-95`).
- Tests: `lib/__tests/generate.js` runs every AST fixture three ways (generate equals `generate` or `source`, generate from a plain object, and parse→generate→parse round trip), plus `fixture/generate-auto-emit-ws.js` (140 lines of token-pair cases) and `fixtures/sourceMaps/autoprefixer.css`. `fixtures/stringify.css`/`.ast` is a full-sheet golden file.

### 2.6 Clone, List, convertor

- `clone(node)` (`utils/clone.js:3-21`): a deep copy that also copies Lists and plain objects (so `loc` too).
- `List` (`utils/List.js`, 469 lines): a doubly linked list with live cursors, so it stays safe to mutate while iterating. It has `createItem`, `size`, `isEmpty`, `first`, `last`, `fromArray`, `toArray`, `toJSON`, `forEach(Right)`, `reduce(Right)`, `some`, `map`, `filter`, `nextUntil`, `prevUntil`, `clear`, `copy`, `prepend(Data)`, `append(Data)`, `insert(Data)`, `remove`, `push`, `pop`, `unshift`, `shift`, `prependList`, `appendList`, `insertList`, and `replace`. Tests: `list.js`, 813 lines and 60 cases.
- `toPlainObject` / `fromPlainObject` (`convertor/create.js:3-28`) convert List children to arrays and back, in place.

### 2.7 Lexer (validation)

- **Data** (`lib/data.js:1-118`): mdn-data `css/syntaxes.json`, `properties.json`, and `at-rules.json`. At-rule preludes are pulled out of the full at-rule syntax by regex (:26-29). `data/patch.json` is merged in (types 100, properties 85, at-rules 6 entries). A patch syntax that starts with `|` appends an alternative, and a null syntax deletes the entry (:35-63). After merging: 499 types, 704 properties, 20 at-rules. `dist/data.js` is 98 KB minified, 21 KB gzipped.
- **Generic types** (`lexer/generic.js:611-738`): the raw token types (`ident-token`, …), the production types `string`, `ident`, `percentage`, `zero`, `number`, `integer`, `custom-ident`, `dashed-ident`, `custom-property-name`, `hex-color`, `id-selector`, `an-plus-b` (`generic-an-plus-b.js`), `urange` (`generic-urange.js`), `declaration-value`, and `any-value`, plus dimension types per unit group (`length`, `angle`, `time`, `frequency`, `resolution`, `flex`, `decibel`, `semitones`, `dimension`, `attr-unit`). Units live in `lexer/units.js`; math functions are accepted via `math()` wrappers. CSS-wide keywords are listed in `lexer/generic-const.js`: initial, inherit, unset, revert, revert-layer.
- **Definition syntax** (`lib/definition-syntax/`): `parse(source)` (`parse.js:578`) builds an AST with node types `Group`, `Multiplier`, `Type`, `Property`, `Keyword`, `Function`, `Token`, `Comma`, `String`, `AtKeyword`, `Range`, `Boolean`, `Combinator`, `Spaces`. `generate(node, {compact, decorate})` turns that AST back into text, and `walk(node, options)` walks it. Tests: `fixtures/definition-syntax/*.json` (17 files, ~100 cases) and `definition-syntax-{parse,generate,walk}.js`.
- **Matching**: `buildMatchGraph` (`match-graph.js:516`) compiles a definition into a state graph, and `matchAsTree` (`match.js:585`) runs tokens through it with an iteration budget (`totalIterationCount`). `Lexer` (`Lexer.js:101-511`) exposes:
  - match: `match(syntax, value)`, `matchProperty(name, value)`, `matchDeclaration(node)`, `matchType(name, value)`, `matchAtrulePrelude(name, prelude)`, `matchAtruleDescriptor(atrule, name, value)`. The value can be an AST or a string. Values containing `var()` are refused (:79-81), and so are custom properties (:360-362).
  - check: `checkAtruleName`, `checkAtrulePrelude`, `checkAtruleDescriptorName`, `checkPropertyName`, `checkStructure(ast)` (validates every node against its `structure`, `lexer/structure.js`).
  - lookup: `getAtrule`, `getAtrulePrelude`, `getAtruleDescriptor`, `getProperty`, `getType`. Vendor-prefixed names fall back to the base name.
  - fragment search: `findValueFragments`, `findDeclarationValueFragments`, `findAllFragments` (`lexer/search.js`).
  - `validate()` lists broken or missing references; `dump()`/`toString()` serialize the definitions.
- **Match result** (`Lexer.js:66-73`): `{matched, iterations, error, getTrace, isType, isProperty, isKeyword}` (`lexer/trace.js`). `matched` is a tree of `{syntax, match: [...]}` / `{syntax, token, node}`. On failure `error` is a `SyntaxMatchError` (`lexer/error.js:95-123`) with `rawMessage`, `syntax`, `css`, `mismatchOffset`, `mismatchLength`, `offset`, `line`, `column`, `loc`, and a caret-drawn message. A missing name gives a `SyntaxReferenceError`.
- **Lexer tests**: `fixtures/definition-syntax-match/*.json` (12 files, ~118 cases: combinators, comma, multipliers, function, parentheses, string, custom-ident, generic types (29), length, default-properties, complex). The `lexer-*.js` files hold ~90 cases: match property, type, at-rule prelude, at-rule descriptor, result, search fragments, check-*, and structure. The structure test runs over every AST fixture.

### 2.8 Utilities

- `property(name)` (`utils/names.js:61-106`) → `{basename, name, hack, vendor, prefix, custom}`. It understands the hack prefixes `_ * $ # + & / //`. `keyword(name)` (:36-59) → `{basename, name, vendor, prefix, custom}`. `vendorPrefix(str)` (:16-34) and `isCustomProperty(str)` (:8-14). Results are cached in module-level Maps.
- `ident.decode/encode` (`utils/ident.js`), `string.decode/encode(str, apostrophe)` (`utils/string.js`), and `url.decode/encode` (`utils/url.js`) handle escapes, quotes, and `url()` wrapping. Tests: `decode-encode.js` (267 lines, table-driven) and `names.js` (318 lines, 27 cases).

## 3. Gap table

Effort: **S** < 300 lines, **M** 300–1,000, **L** 1,000–2,500, **XL** > 2,500 lines of new Zig or TS, tests excluded. "Difficulty" means the risk of the work, not the line count.

| Area | yuku-css has | Missing | Size | Difficulty |
|---|---|---|---|---|
| **Tree shape** | Own shape: `start`/`end` UTF-16 offsets, arrays, `AtRule`, `ComplexSelector`/`CompoundSelector`, `TypeSelector.namespace`, `AttributeSelector.value` as raw string, `PseudoClassSelector.argument`, `Nth.nth` as raw string (`src/ast.ts:1-157`, `src/ast.zig:32-53`) | css-tree node names/fields, `loc` with line/column/source, `List` children, `Selector` flat list, `AnPlusB{a,b}`, `Identifier`/`String` sub-nodes, `children` on pseudos | S (adapter) – M (native switch) | Decision, not code (open question 1) |
| **Tokenizer** | None public. The parser scans bytes directly (`parser.zig:552-746`: `skipTrivia`, `stringEnd`, `skipComponent`, `matchBlock`, `urlEnd`, `identEnd`); no numbers, dimensions, escapes-as-tokens, or BadUrl | Full CSS Syntax 3 tokenizer with all 26 types; `tokenize()` API; a TokenStream-like view (types, offsets, bracket pairs); `tokenTypes`/`tokenNames` | M | Low (the spec is a recipe), but the parser rewrite on top of it is the real cost |
| **Parse options** | `parse(source)` only (`index.ts:27`) | `context` (14), `atrule`, `kind`, `positions`/line-column, `filename`, `offset`/`line`/`column`, `onParseError`, `onComment`, `onToken`, `list`, the four `parse*` toggles | M | Medium: contexts need parser entry points per node, and line/column needs a JS-side `OffsetToLocation` |
| **Structure nodes** | StyleSheet, Rule, AtRule, Block, Declaration, Raw | `Comment` (`/*!`), `CDO`/`CDC` nodes (currently skipped, `parser.zig:98-105`), `DeclarationList` (context), `Raw` kept for dropped statements (yuku drops them: `parser.zig:121-124`, `236-240`) | S | Low |
| **Declarations** | property, `important: bool`, trimmed raw value (`parser.zig:232-268`) | Hack prefixes `*zoom` `_x` etc. (yuku reports `expected_property`), `important` as string (`!ie`), custom-property whitespace semantics, `Value` node | S | Low |
| **Values** | Raw only | `Value` + Identifier, Number, Dimension, Percentage, Hash, String (decoded), Url (decoded), Function, Operator (with css-tree's whitespace padding), Parentheses, Brackets, UnicodeRange, WhiteSpace, `var()` and `expression()` special cases, Delim behaviour | M | Medium: the fixtures pin down number edge cases (`-3e2`, `+.5`), the unicode-range sub-grammar, and the Raw fallback points |
| **At-rule preludes** | Raw only; keyframes detected by name suffix (`parser.zig:216`) | AtrulePrelude, MediaQueryList, MediaQuery, Condition (media/supports/container), Feature, FeatureRange, FeatureFunction, GeneralEnclosed, Ratio, SupportsDeclaration, Layer, LayerList, Scope; per-at-rule hooks for import, container, supports, media, layer, scope, page, nest, font-face, starting-style; generic sequence for others; block-kind selection per at-rule | L | High: nested try/fallback logic (`Condition.js:57-93`) is speculative, and the error offsets are pinned by 14+6 error fixtures |
| **Selectors** | Full Selectors 4 coverage incl. namespaces, `\|\|`, relative and forgiving lists, Nth with `of` (`parser.zig:277-550`) | `AnPlusB{a,b}` split; `:lang()`, `:dir()` argument nodes; `::slotted`/`:host`/`:host-context` as a single `Selector`; keyframe selectors (css-tree: SelectorList with Percentage/TypeSelector, yuku: Raw); `/deep/` combinator; css-tree error messages and offsets (121 selector error fixtures) | S–M | Low–medium |
| **Recovery and errors** | Never throws; 16 diagnostic messages (`ast.zig:62-100`); spans | `onParseError(error, fallbackNode)` callback; `SyntaxError` with line/column, `sourceFragment`, `formattedMessage`; css-tree's message texts if parity on messages is wanted | S–M | Medium if messages must match exactly (214 cases), low if only positions |
| **Generator** | None | `generate(ast, {mode, sourceMap, decorator})`, token-pair whitespace tables, per-node generate | M | Low–medium. The token-pair table is spec-defined, but it must work over yuku's tree (or the adapter's) |
| **Walker** | None | `walk` (enter/leave/visit/reverse/break/skip/context), `find`, `findLast`, `findAll` | S–M | Low; needs a per-type child-field table, which `transfer.zig`'s `description` already provides |
| **Clone, List, convertor** | None (plain arrays) | `clone`, `List` (469 lines in css-tree), `toPlainObject`/`fromPlainObject` | S–M | Low |
| **Utilities** | None | `property`, `keyword`, `vendorPrefix`, `isCustomProperty`, `ident`/`string`/`url` encode/decode | S | Low; tests are table-driven |
| **Definition syntax** | None | `definitionSyntax.parse/generate/walk`, `SyntaxError` | M | Medium |
| **Lexer** | None | Lexer class, match graph, matcher with iteration budget, generic types incl. an-plus-b and urange token-level matchers, units, math functions, CSS-wide keywords, match result/trace/fragments, `checkStructure`, `SyntaxMatchError`, `validate`, `dump` | XL | High: ~3,300 lines of subtle backtracking, and parity is judged on match trees |
| **Lexer data** | None | mdn-data + patch merge, a data update process, bundle-size decision (98 KB min / 21 KB gz) | S code + ongoing upkeep | Low code, but an ongoing data-maintenance burden |
| **Extensibility** | Fixed Zig grammar | `fork()`/`createSyntax()` with custom node types, at-rule/pseudo/scope parse hooks, data extension | L (data-only fork: S) | High for parser hooks, since JS callbacks cannot run inside the Zig parser without a different design |
| **Subpath builds** | One entry | Tokenizer-only, parser-only, selector-parser, generator, walker, lexer entries | S | Low, but the wasm module size per entry is a question |

## 4. Where css-tree departs from the specs, and what to match

Rule of thumb proposed for all of these: **match css-tree where the difference is only in how the tree is represented or where legacy authoring depends on it; follow the spec where css-tree loses or misreads content.** Each place the spec wins needs a named normalization in the parity harness, as `test/parity.test.ts:4-18` already does.

| # | Behaviour | css-tree | Spec | Recommendation |
|---|---|---|---|---|
| 1 | Nested rule starting with an ident or type selector, e.g. `a{ b{} }`, `html:is(.x) &{}` | Parsed as a `Declaration`; becomes `Raw` (`Block.js:67-72`), or a declaration whose raw value holds the block. Verified: `a{color:red; b{c:d}}` → `Raw "b{c:d}"` + error "Colon is expected" | CSS Nesting / Syntax ED: a statement whose `{}` comes before any `;` is a nested rule | **Spec** (yuku already does this, `parser.zig:176-179`). Keep the reparse normalization in the harness. |
| 2 | Block kind of unknown at-rules | Single lookahead guess for the whole block (`Atrule.js:12-27`) | Generic; the spec cannot know | **yuku's per-statement rule**, which equals css-tree's result whenever css-tree's guess is right and is correct for mixed blocks |
| 3 | Keyframe selectors | `SelectorList` → `Selector` → `TypeSelector "from"` / `Percentage "50"`, because the Selector scope accepts numbers (`scope/selector.js:51-53`) everywhere, so `50% {}` at top level also parses as a selector | `<keyframe-selector> = from \| to \| <percentage>`, only inside `@keyframes` | **Match css-tree's shape** inside keyframes (csso and other consumers expect it), but **accept percentages only inside keyframes** |
| 4 | Comments | Kept only as `Comment` nodes for `/*!` at stylesheet top level (`StyleSheet.js:40-45`); a `Comment` token type exists | No comment tokens; comments dropped | **Match css-tree**: `/*!` license comments matter to minifiers. Expose all comments through `onComment` |
| 5 | Empty statements `;` in blocks | `Raw ";"` nodes (`Block.js:22-25`) | Dropped | **Spec** (drop). Already normalized in the harness |
| 6 | Statements that fail to parse | Kept as `Raw` with `onParseError` (e.g. top-level `color:red;` → `Raw`) | Dropped | **Match css-tree** (keep `Raw`, plus a diagnostic). yuku currently drops them (`parser.zig:121-124`, `236-240`), which loses text and breaks generate round trips |
| 7 | Delims in values (`=`, `<`, `!` mid-value, lone `#`) | Ends the value sequence, so the whole value becomes `Raw` plus an error (`scope/default.js:66-83`, own TODO). Verified for `b:c = d` and `b:c < d` | Any component value is valid in a declaration value | **Owner question (6).** Matching css-tree is cheapest for parity; a `Delim` node would be more correct but is a node type css-tree lacks |
| 8 | Property hacks `*zoom`, `_x`, `$`, `+`, `#`, `&`, `/`, `//`; `!ie` | Accepted; `important: "ie"` (`Declaration.js:122-165`) | Invalid | **Match css-tree**. They are in the fixtures, and minifiers and linters depend on them. yuku reports `expected_property` for `*zoom` today |
| 9 | Custom property values | Raw text with its surrounding whitespace kept (fixture `declaration/custom-property.json`); empty value → `WhiteSpace` child | css-variables-1 (2022+): leading/trailing whitespace trimmed | **Spec for the value, css-tree for positions**: trim the value, and make generate print `--x: ;` faithfully. Normalize in the harness |
| 10 | Declaration end | Includes whitespace before `;` | — (positions are not specified) | **Keep yuku's** tighter span; normalize in the harness |
| 11 | Leftover input in a non-stylesheet context | Throws `SyntaxError` (`create.js:401-403`) | n/a | **Owner question (5).** Recommend never throwing by default and returning diagnostics, with an opt-in `throwOnError` for css-tree-style callers |
| 12 | `onParseError` during speculative branches | Fires even when a later branch succeeds. Verified: `@supports (not (display:grid))` reports "Colon is expected" yet yields a correct `Condition` | n/a | **Don't copy.** Report only errors that end in a `Raw` fallback. Parity checks error offsets only where css-tree produced `Raw` |
| 13 | Escapes in names | Ident, class, and id names keep escapes as written; `String`/`Url` values are decoded (`Url.js:22,32`) | Values are decoded | **Match css-tree** (round trips stay lossless); offer `ident.decode` |
| 14 | `:host()`, `:host-context()`, `::slotted()` | Single `Selector` (`pseudo/index.js:53-55`) | `<compound-selector>` | **Match css-tree** (closer to the spec than yuku's current SelectorList; the harness notes this at `parity.test.ts:10`) |
| 15 | `@nest` | Supported (`atrule/nest.js`) | Removed from the Nesting draft | Match: it costs about 10 lines |
| 16 | Operator whitespace | `+`/`-` operators get spaces padded into `value` (`scope/value.js:15-22`); other whitespace in values is dropped | Whitespace is a token | **Match css-tree**: the generator and lexer both rely on it |
| 17 | Data bugs | `patch.json` adds `font-features-values` (typo of `font-feature-values`); `Lexer.getAtruleDescriptor` reads `this.atrules.declarators`, so it always returns null (`Lexer.js:425-428`) | — | **Don't copy**; note them as known divergences |
| 18 | Unicode ranges | Parser-level: any ident starting `u+` goes to `UnicodeRange` (`scope/default.js:57-64`) | Syntax 3 dropped the unicode-range token; `<urange>` is parsed from tokens | Match: this is spec-compatible |

## 5. Phased build order

Each phase ends with css-tree's own fixtures running against yuku-css in CI. Pin the reference at css-tree 3.2.1 / commit `f898015`, either as a git submodule or by vendoring `fixtures/` (it is MIT-licensed). Running the upstream `.js` test files would need their mocha harness and `css-tree` import, so write a small Bun runner that reads the JSON fixtures the same way `lib/__tests/fixture/ast.js` does: scope = directory = context, and a wrapper when the fixture's AST type is narrower than the scope. Compare **through a converter from the yuku tree to the css-tree shape** (`toCssTree(ast)` in the parity tests, or shipped if open question 1 picks an adapter), with `loc` stripped as css-tree's own test does (`parse.js:9`). Track the expected-divergence list from §4 as data (fixture name → reason), never by skipping silently.

Sizes are relative to the current yuku-css codebase (≈1,500 lines of Zig + TS, tests excluded) = **1.0**.

**Phase 0: harness and shape decision (0.3).** Write the fixture runner, the `toCssTree` converter for today's nodes, and the divergence ledger. Today it should pass the stylesheet/rule/selector fixtures that use `parseValue:false`-compatible shapes. Mostly it shows which fixtures fail and why. This phase also settles open question 1, because everything else depends on it.

**Phase 1: tokenizer (0.6).** A Zig CSS Syntax 3 tokenizer with the 26 types and positions only, as css-tree has it, exposed as `tokenize(source)` returning packed `Uint32Array` type/end pairs (the same trick as `offsetAndType`), plus a JS `onToken` adapter. Then move the parser's byte scanner onto tokens, or share the scanner's primitives. Parity:
- `fixtures/tokenize` (112 strings);
- the 31-token stream test from `tokenizer.js:6-38`, including `balance`;
- differential tokenization against `csstree.tokenize` over `test/corpus` (252 files);
- a fuzz corpus.

The corpus benchmark should not regress.

**Phase 2: parser surface (0.6).**
- Contexts (14), `positions` with line/column (a lazy JS `OffsetToLocation` over the UTF-16 offsets yuku already emits), `filename`/`offset`/`line`/`column`.
- `onComment`, `onToken`, `onParseError`, the four `parse*` toggles.
- `Comment`/`CDO`/`CDC` nodes, `Raw` kept for failed statements (§4 #6), `DeclarationList`, and the declaration hacks (§4 #8).

Parity: `fixtures/ast/{stylesheet,block,rule,declarationList,declaration}` with `parseValue:false` set by the runner where values are not yet parsed, plus the option tests in `parse.js:111-581`.

**Phase 3: values (0.8).** The `Value` scope and its 15 node types, the `var()`/`expression()` hooks, and the `parseCustomProperty` semantics. Parity: `fixtures/ast/value` (160 + 33 error cases), `fixtures/ast/declaration` (73 + 4), and the AnPlusB/UnicodeRange cases generated from `definition-syntax-match/generic.json` (`parse.js:45-108`). A corpus parity diff with `parseValue: true` becomes possible here.

**Phase 4: at-rule preludes (1.2).** The 13 prelude nodes, the 10 at-rule hooks, the generic prelude sequence, and per-at-rule block kinds. Parity: `fixtures/ast/atrule` (116 + 14, incl. the 10 per-at-rule files), `mediaQuery` (43 + 6), and `atrulePrelude` (2). Then turn on `parseAtrulePrelude: true` in the corpus parity test.

**Phase 5: selector parity (0.3).** `AnPlusB`, `:lang`/`:dir`, `Selector` for host/slotted, keyframe selectors, `/deep/`, and css-tree error texts and offsets if wanted. Parity: `fixtures/ast/selector` (196 + 121) and `selectorList` (2 + 8). After this phase the full `fixtures/ast` set (721 + 214) is the regression gate.

**Phase 6: walker, clone, List, convertor, utilities (0.7, all TS).** The walker is driven by the child-field table `transfer.zig` already describes. Parity:
- `walk.js` (incl. its per-fixture walk) and `find.js`;
- `list.js` (60 cases);
- `names.js` (27);
- `decode-encode.js` (the table-driven half);
- `clone.js` and `convert.js`.

These can be ported nearly verbatim from mocha to `bun:test`. This phase can run in parallel with phases 3–5, since it touches no Zig.

**Phase 7: generator (0.6).** Per-node generate over the chosen tree shape, token-pair whitespace (`spec`/`safe`), `decorator`, and `sourceMap`. TS is the natural home because `decorator` takes JS functions; a Zig fast path for the plain-string case is an optional later optimization. Parity:
- every AST fixture three ways: string equal to `generate`/`source`, plain-object input, and parse→generate→parse round trip (`generate.js:6-35`), about 2,100 assertions;
- `generate-auto-emit-ws.js`;
- `fixtures/sourceMaps`;
- `stringify.css`/`.ast`;
- a corpus round trip.

**Phase 8: definition syntax + lexer + data (3.0).**
1. Port `definition-syntax` parse/generate/walk (TS). Parity: `fixtures/definition-syntax` (~100) and its three test files.
2. Data build: merge mdn-data + patch at build time into one JSON, version-pinned; fix the §4 #17 bugs or record them as divergences.
3. Match graph + matcher + generic types (an-plus-b, urange, units, math). Start in TS for correctness. A Zig matcher over precompiled graphs is a later performance phase.
4. Lexer API, match result, trace, fragments, `checkStructure`, errors.

Parity: `fixtures/definition-syntax-match` (~118, comparing match trees) and the `lexer*.js` files (~90 cases). Then a differential test: `matchDeclaration` on every declaration of the corpus must agree with css-tree on matched/unmatched and on mismatch offset.

**Phase 9: extensibility and subpath builds (0.5–1.5).** `fork()` with data-only extensions (types/properties/atrules) is cheap once phase 8 exists. Parser-hook extensions (custom at-rule/pseudo/node parse functions, `parse-extension.js`) need a design decision (open question 4). Subpath entries (`yuku-css/tokenizer`, `/walker`, `/lexer`, …).

Rough total: about **9×** the current codebase. The parser phases (1–5) are about 3.5×, the JS API phases (6–7) about 1.3×, and the lexer about 3×. Suggested order for value delivered per unit of work: 0 → 1 → 2 → 6 (in parallel) → 3 → 7 → 4 → 5 → 8 → 9. With the generator before at-rule preludes, a usable parse/walk/generate loop exists early, and preludes can round-trip as `Raw` until phase 4.

## 6. Open questions for the owner

1. **Tree shape.** Should yuku-css produce css-tree's tree (node names, `loc`, `List`, flat `Selector`) so it is a drop-in replacement, or keep its own spec-shaped tree (spans, arrays, `CompoundSelector`) and ship a `toCssTree` adapter? Recommendation: keep the native tree and ship the adapter. The native tree is more precise and faster to decode, and the adapter both feeds parity tests and serves callers that want compatibility. It does mean the generator, walker, and lexer are written against the native tree.
2. **Where each subsystem lives.** Recommendation: tokenizer and parser in Zig; walker, List, clone, utilities, and generator in TS (their APIs take JS callbacks); lexer in TS first, with a later Zig matcher only if measurements justify it.
3. **Lexer data.** Bundle mdn-data (98 KB min / 21 KB gz) in the main entry, or only behind a `yuku-css/lexer` subpath? Recommendation: subpath only, with the data version pinned and an update script, mirroring css-tree's `definition-syntax-data` export.
4. **Extensibility.** Must `fork()` support custom parser hooks (JS functions running inside parsing), or only data extensions? Hooks fight the Zig-in-wasm design. Recommendation: data-only `fork()`, plus configuration-driven hooks (e.g. "treat at-rule X's prelude as a selector list"), with no arbitrary JS callbacks.
5. **Throwing.** css-tree throws on leftover input in fragment contexts. Should yuku keep "never throws, returns diagnostics" everywhere? Recommendation: yes, plus an opt-in `onParseError` and a helper that throws a css-tree-style `SyntaxError` with `formattedMessage`.
6. **Delim in values (§4 #7).** Match css-tree's Raw fallback, or add a `Delim` node that css-tree lacks? Recommendation: match css-tree for now, behind the divergence ledger, because a new node type breaks compatibility for the lexer and generator.
7. **Error-message parity.** Do the 214 error fixtures need css-tree's exact message text, or only position and presence? Recommendation: positions only. Keep yuku's own message set (`ast.zig:62-100`) and grow it as needed.
8. **Default parse depth.** css-tree parses values and preludes by default. Should yuku's default change from raw to fully parsed once phases 3–4 land, given the benchmark claim in `README.md` ("values kept raw")? Recommendation: match css-tree's defaults (`parseValue: true`, `parseAtrulePrelude: true`), re-measure the benchmark, and update the README.
