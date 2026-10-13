// Every place yuku-css parses differently from css-tree 3.2.1, each with the spec it follows and the
// css-tree fixtures it fails; test/compare.ts forks css-tree to parse the same way. Where css-tree
// reads what a spec rejects, the tree stays css-tree's and a diagnostic reports it.
export interface Divergence {
  /** What yuku-css does, where css-tree does otherwise. */
  rule: string;
  spec: string;
  fixtures: string[];
}

export const divergences: Divergence[] = [
  {
    rule:
      "A statement of a style block that does not start with `&` is a nested rule when a `{}` block comes before any `;`, " +
      "unless it starts with a custom property and a colon; css-tree reads a declaration, kept as `Raw` or holding the block",
    spec: "css-syntax-3 §5.5.5 consume a block's contents, css-nesting-1 §2",
    fixtures: [
      "ast/rule/nesting.json don't parse nested rule when it not started with &",
      "ast/declarationList/nesting.json don't parse nested rule when it not started with &",
      "ast/atrule/atrule/font-face.json @font-face with declaration looks like a rule in block",
      "ast/atrule/atrule/font-face.json error#1",
    ],
  },
  {
    rule: "`@layer`'s block nested in a style rule holds declarations as well as rules; css-tree reads rules only",
    spec: "css-nesting-1 §3 nested group rules, css-cascade-5 §6.4.3",
    fixtures: [],
  },
  {
    rule: "A bad URL token ending in an escape at the end of the source ends there; css-tree ends it one code unit past the source",
    spec: "css-syntax-3 §4.3.14 consume the remnants of a bad url",
    fixtures: [],
  },
  {
    rule:
      "Each tokenizer parse error is reported: a comment, string or URL the source ends in, a newline in a string, " +
      "a quote, `(` or non-printable code point in a URL, and a `\\` that starts no escape",
    spec: "css-syntax-3 §4.3.2 consume comments, §4.3.5 consume a string token, §4.3.6 consume a url token, §4.3.7 consume an escaped code point, §4.3.1",
    fixtures: [
      "ast/stylesheet/comment.json bad comment #1",
      "ast/stylesheet/comment.json bad comment #2",
      "ast/stylesheet/StyleSheet.json rule with a bad-string token (issue #93)",
    ],
  },
  {
    rule:
      "A selector starts with a combinator only in `:has()`, a nested rule, or `@scope`; elsewhere, " +
      "`:is()`, `:where()` and their prefixed forms included, it is reported",
    spec: "selectors-4 §4.2 the matches-any pseudo-class, §3.1 relative selectors, css-nesting-1 §2, css-cascade-6 §2.2",
    fixtures: [
      "ast/selector/functional-pseudo/is.json should support relative selectors",
      "ast/selector/functional-pseudo/where.json should support relative selectors",
      "ast/selector/functional-pseudo/-moz-any.json should support relative selectors",
      "ast/selector/functional-pseudo/-webkit-any.json should support relative selectors",
    ],
  },
  {
    rule: "A combinator after another, or ending a selector, is reported",
    spec: "selectors-4 §18 grammar, <complex-selector>",
    fixtures: [],
  },
  {
    rule: "A type selector after another simple selector of its compound, as in `a:hover|b`, is reported",
    spec: "selectors-4 §18 grammar, <compound-selector>",
    fixtures: [],
  },
  {
    rule: "`||` is the column combinator, a `Combinator` named `||`; css-tree reads a namespace and fails",
    spec: "selectors-4 §15.1 column combinator",
    fixtures: [],
  },
  {
    rule:
      "Beyond 128 nested blocks, functional pseudo-classes, or value functions, parentheses and brackets, " +
      "the rest is `Raw` with \"Nesting is too deep\"; " +
      "css-tree recurses until the JavaScript stack runs out",
    spec: "none, a bound on recursion",
    fixtures: [],
  },
  {
    rule:
      "The lexer's grammar is @webref/css, where rgb() reads through <legacy-rgb-syntax> and <modern-rgb-syntax>, " +
      "so a trace into rgb() names one more type than css-tree's mdn-data grammar gives",
    spec: "css-color-4 §5.1 the rgb() and rgba() functions",
    fixtures: ["lexer-match-result.js > lexer match result > getTrace()"],
  },
  {
    rule:
      "The lexer's grammar is @webref/css, where `font` and `font-family` list <font-family-name>, " +
      "which css-tree's mdn-data grammar calls <family-name>",
    spec: "css-fonts-4 §2.1 font family: the font-family property",
    fixtures: [
      "lexer-search-fragments.js > lexer search fragments > findValueFragments() > should find multiple entries",
      "lexer-search-fragments.js > lexer search fragments > findDeclarationValueFragments() > should find multiple entries",
    ],
  },
  {
    rule:
      "A lexer reads every definition it is given when it is made, so `createLexer` throws on bad definition syntax; " +
      "css-tree throws when the definition is first matched",
    spec: "none: an error at the call that brought the bad syntax in",
    fixtures: [],
  },
  {
    rule:
      "Definition syntax nests at most 64 groups deep, and a multiplier's minimum is at most 65535 and its maximum fits " +
      "32 bits, where css-tree has no bound; deeper or larger is a `Nesting is too deep` or `Number is too large` error",
    spec: "none: the parser's recursion and the packed tree are bounded",
    fixtures: [],
  },
  {
    rule:
      "Keyword and enum matching lowercase only ASCII letters of the value, where css-tree's enum lowercases with " +
      "JavaScript's Unicode `toLowerCase`, so a non-ASCII letter that lowercases to ASCII, as U+212A to `k`, matches no keyword",
    spec: "css-values-4 §4.2 keywords match ASCII case-insensitively",
    fixtures: [],
  },
  {
    rule:
      "Range checks read a number exactly up to 19 significant digits with an exponent within 22, and beyond within an " +
      "ulp or two of JavaScript's `Number`, so only a value at the very bound of a range could read otherwise",
    spec: "none: a small decimal reader in place of a full float parser",
    fixtures: [],
  },
  {
    rule:
      "`fork` extends the grammar only, so its config has no `node` definitions to add or check; the structure " +
      "`checkStructure` checks is css-tree's, with yuku-css's numeric `start` and `end` in place of `loc` and arrays as lists",
    spec: "none: the parser's node types are fixed, as css-tree's tree",
    fixtures: [
      "lexer-check-structure.js > Lexer#checkStructure() > structure in AST node definition > should fail when no structure field in node definition",
      "lexer-check-structure.js > Lexer#checkStructure() > structure in AST node definition > should fail on bad value in structure",
    ],
  },
  {
    rule: "A lone `+` at the end of a value matched as <an-plus-b> does not match, where css-tree throws a TypeError",
    spec: "css-syntax-3 §6 the An+B microsyntax",
    fixtures: [],
  },
];

const PRELUDES = "pending: at-rule preludes are `Raw` until the prelude parser lands";
const GENERATOR = "pending: no generator yet";

// fixtures of what yuku-css does not build yet: a fixture id, a fixture file, or a directory ending in `/`
export const pending: Record<string, string> = {
  "sourceMaps/": GENERATOR,
  "stringify.css": PRELUDES,
  "ast/atrulePrelude/": PRELUDES,
  "ast/mediaQuery/": PRELUDES,
  "ast/atrule/atrule/container.json": PRELUDES,
  "ast/atrule/atrule/font-face.json @font-face with prelude is not an error": PRELUDES,
  "ast/atrule/atrule/import.json with string": PRELUDES,
  "ast/atrule/atrule/import.json with url": PRELUDES,
  "ast/atrule/atrule/import.json with media": PRELUDES,
  "ast/atrule/atrule/import.json should be case insensetive": PRELUDES,
  "ast/atrule/atrule/import.json with anonymous layer": PRELUDES,
  "ast/atrule/atrule/import.json with layer()": PRELUDES,
  "ast/atrule/atrule/import.json with bad layer()#1": PRELUDES,
  "ast/atrule/atrule/import.json with bad layer()#2": PRELUDES,
  "ast/atrule/atrule/import.json with supports(declaration)": PRELUDES,
  "ast/atrule/atrule/import.json with supports(condition)": PRELUDES,
  "ast/atrule/atrule/import.json with bad supports()#1": PRELUDES,
  "ast/atrule/atrule/import.json with bad supports()#2": PRELUDES,
  "ast/atrule/atrule/import.json with layer & supports": PRELUDES,
  "ast/atrule/atrule/import.json with layer & supports & media": PRELUDES,
  "ast/atrule/atrule/import.json @import with block is not an error": PRELUDES,
  "ast/atrule/atrule/import.json white spaces and comment should not affect prelude consuming": PRELUDES,
  "ast/atrule/atrule/import.json error#1": PRELUDES,
  "ast/atrule/atrule/layer.json one layer name": PRELUDES,
  "ast/atrule/atrule/layer.json layer name with fullstop": PRELUDES,
  "ast/atrule/atrule/layer.json with a block": PRELUDES,
  "ast/atrule/atrule/layer.json layer name list": PRELUDES,
  "ast/atrule/atrule/layer.json error#1": PRELUDES,
  "ast/atrule/atrule/media.json single media type": PRELUDES,
  "ast/atrule/atrule/media.json single media type with negation": PRELUDES,
  "ast/atrule/atrule/media.json single media type with only": PRELUDES,
  "ast/atrule/atrule/media.json a list of conditions": PRELUDES,
  "ast/atrule/atrule/media.json should be case insensitive": PRELUDES,
  "ast/atrule/atrule/media.json missed 'and' keyword": PRELUDES,
  "ast/atrule/atrule/media.json @media with unclosed parentheses is not an error": PRELUDES,
  "ast/atrule/atrule/media.json error#1": PRELUDES,
  "ast/atrule/atrule/media.json error#2": PRELUDES,
  "ast/atrule/atrule/media.json error#3": PRELUDES,
  "ast/atrule/atrule/nest.json": PRELUDES,
  "ast/atrule/atrule/scope.json": PRELUDES,
  "ast/atrule/atrule/supports.json base test with spaces": PRELUDES,
  "ast/atrule/atrule/supports.json base test with comments": PRELUDES,
  "ast/atrule/atrule/supports.json should be case insensitive": PRELUDES,
  "ast/atrule/atrule/supports.json vendor property": PRELUDES,
  "ast/atrule/atrule/supports.json custom property": PRELUDES,
  "ast/atrule/atrule/supports.json simple supports with negation": PRELUDES,
  "ast/atrule/atrule/supports.json complex prelude": PRELUDES,
  "ast/atrule/atrule/supports.json using function": PRELUDES,
  "ast/atrule/atrule/supports.json using !important": PRELUDES,
  "ast/atrule/atrule/supports.json @supports with no block": PRELUDES,
  "ast/atrule/atrule/supports.json @supports with selector()": PRELUDES,
  "ast/atrule/atrule/supports.json @supports with selector() case-insensitive": PRELUDES,
  "ast/atrule/atrule/supports.json error#1": PRELUDES,
  "ast/atrule/atrule/supports.json error#2": PRELUDES,
  "ast/atrule/atrule/supports.json error#3": PRELUDES,
  "ast/atrule/no-block.json atrules.1": PRELUDES,
  "ast/atrule/no-block.json atrules.2": PRELUDES,
  "ast/atrule/no-block.json atrules.3": PRELUDES,
  "ast/atrule/no-block.json atrules.c.1": PRELUDES,
  "ast/atrule/no-block.json atrules.s.1": PRELUDES,
  "ast/atrule/no-block.json no at-rule ending on eof is not an error": PRELUDES,
  "ast/atrule/no-block.json error#1": PRELUDES,
  "ast/atrule/tolerant.json at-rule (unknown) may have any content in prelude": PRELUDES,
  "ast/atrule/tolerant.json at-rule (unknown) may have no a semicolon": PRELUDES,
  "ast/atrule/tolerant.json at-rule (known) may have any content in prelude": PRELUDES,
  "ast/atrule/tolerant.json at-rule (known) may have no a semicolon": PRELUDES,
  "ast/rule/nested-atrule.json with prelude": PRELUDES,
  "ast/rule/nested-atrule.json recursion": PRELUDES,
  "ast/atrule/atrule/font-feature-values.json": PRELUDES,
  "ast/atrule/atrule/supports.json base test": PRELUDES,
  "ast/atrule/block.json block at-rule #1": PRELUDES,
  "ast/atrule/block.json block at-rule #2": PRELUDES,
  "ast/atrule/block.json block at-rule #c.1": PRELUDES,
  "ast/atrule/block.json block at-rule #c.2": PRELUDES,
  "ast/atrule/block.json block at-rule #s.1": PRELUDES,
  "ast/atrule/block.json block at-rule #s.2": PRELUDES,
  "ast/atrule/block.json @page": PRELUDES,
  "ast/atrule/stylesheet.json atruler.1": PRELUDES,
  "ast/atrule/stylesheet.json atruler.3": PRELUDES,
  "ast/atrule/stylesheet.json atruler.c.1": PRELUDES,
  "ast/atrule/stylesheet.json atruler.c.2": PRELUDES,
  "ast/atrule/stylesheet.json atruler.s.1": PRELUDES,
  "ast/atrule/stylesheet.json atruler.s.2": PRELUDES,
  "ast/atrule/stylesheet.json webkit.keyfraymes.0": PRELUDES,
  "ast/block/Block.json at-rule in block": PRELUDES,
  "ast/block/Block.json at-rule in the ending of block": PRELUDES,
  "ast/declarationList/nesting.json basic": PRELUDES,
  "ast/declarationList/nesting.json nested @media": PRELUDES,
  "ast/rule/nested-atrule.json with block": PRELUDES,
  "ast/rule/nesting.json basic": PRELUDES,
  "ast/rule/nesting.json nested @media": PRELUDES,
  "ast/rule/nesting.json nested @supports": PRELUDES,
  "ast/rule/nesting.json nested @container": PRELUDES,
  "ast/stylesheet/StyleSheet.json issue90.test1": PRELUDES,
  "ast/stylesheet/StyleSheet.json issue90.test2": PRELUDES,
};

/**
 * Where the grammar, from `@webref/css`, and css-tree's, from mdn-data, disagree on a corpus
 * declaration: the property and whether yuku-css matches it.
 */
export const grammarDivergences: { property: string; reason: string }[] = [
  {
    property: "position-visibility does not match",
    reason: "css-anchor-position-1 renamed `anchors-visible` to `anchor-visible`; mdn-data keeps the old name",
  },
  {
    property: "-webkit-touch-callout does not match",
    reason: "no spec defines `-webkit-touch-callout`, so webref has no such property; mdn-data lists it",
  },
];

const reasons = new Map<string, string>();
for (const { rule, spec, fixtures } of divergences) for (const id of fixtures) reasons.set(id, `${rule} (${spec})`);
for (const [id, reason] of Object.entries(pending)) reasons.set(id, reason);

/** Every listed fixture id, file, and directory. */
export const listed: string[] = [...reasons.keys()];

/** Why a fixture, by id or path, differs from css-tree, or undefined when it does not. */
export function reasonOf(id: string): string | undefined {
  const file = id.split(" ")[0]!;
  let reason = reasons.get(id) ?? reasons.get(file);
  for (let at = file.indexOf("/"); reason === undefined && at !== -1; at = file.indexOf("/", at + 1)) {
    reason = reasons.get(file.slice(0, at + 1));
  }
  return reason;
}
