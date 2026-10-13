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
      "A media, supports or container condition is `not` before one term in parentheses, or such terms joined all by `and` " +
      "or all by `or`, with no `or` after a media type; css-tree reads identifiers and terms in any order, so the tree " +
      "stays css-tree's and the first misplaced keyword or term is reported",
    spec: "mediaqueries-4 §3 syntax, css-conditional-3 §6.1 supports condition, css-contain-3 §6.1 container queries",
    fixtures: ["ast/atrule/atrule/media.json missed 'and' keyword", "ast/mediaQuery/MediaQuery.json media feature with comments"],
  },
  {
    rule:
      "The end of input closes an open media or container feature, range, condition in parentheses, `@scope` selector " +
      "list, or `@import` function; css-tree reports errors there and drops what the parentheses held",
    spec: "css-syntax-3 §5.4.8 consume a simple block, §5.4.9 consume a function",
    fixtures: ["ast/mediaQuery/MediaQuery.json error#4"],
  },
  {
    rule:
      "Parentheses in a condition read as a nested condition, as `(not (a: b))`, or as general-enclosed, as " +
      "`(a: b and (c))`, report none of the errors of the feature, range or supports declaration first tried there, " +
      "nor the Raw of general-enclosed; css-tree reports each and reads the same tree",
    spec:
      "css-conditional-3 §6.1 <supports-in-parens>, mediaqueries-4 §3 <media-in-parens> and <general-enclosed>, " +
      "css-contain-3 §6.1 <query-in-parens>",
    fixtures: [
      "ast/atrule/atrule/container.json complex query",
      "ast/atrule/atrule/media.json a list of conditions",
      "ast/atrule/atrule/supports.json complex prelude",
      "ast/mediaQuery/FeatureRange.json error#1",
      "ast/mediaQuery/GeneralEnclosed.json parentheses",
      "ast/mediaQuery/GeneralEnclosed.json empty parentheses",
      "ast/mediaQuery/GeneralEnclosed.json mixed",
      "ast/mediaQuery/GeneralEnclosed.json mixed empty",
      "ast/mediaQuery/MediaQuery.json error#1",
      "ast/mediaQuery/MediaQuery.json error#2",
      "ast/mediaQuery/MediaQuery.json error#3",
      "ast/mediaQuery/Ratio.json error#1",
    ],
  },
  {
    rule:
      "`@custom-media`'s prelude is an extension name `Identifier`, then a `MediaQueryList` or the `Identifier` `true` or " +
      "`false`, as `@container`'s name sits beside its condition; css-tree reads a sequence of component values",
    spec: "mediaqueries-5 §3.1 custom media queries",
    fixtures: [],
  },
  {
    rule: "The function named in `Unknown feature` is lowercased in ASCII only, where css-tree uses JavaScript's Unicode `toLowerCase`",
    spec: "none: the name is lowercased where it is reported, without a Unicode case table",
    fixtures: [],
  },
  {
    rule: "A media type of `only`, `not`, `and`, `or` or `layer` is reported",
    spec: "mediaqueries-4 §3 syntax, <media-type>",
    fixtures: [],
  },
  {
    rule:
      "Beyond 128 nested blocks, functional pseudo-classes, conditions, or value functions, parentheses and brackets, " +
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

const GENERATOR = "pending: no generator yet";

// fixtures of what yuku-css does not build yet: a fixture id, a fixture file, or a directory ending in `/`
export const pending: Record<string, string> = {
  "sourceMaps/": GENERATOR,
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
