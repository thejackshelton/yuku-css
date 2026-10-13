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
];

const GENERATOR = "pending: no generator yet";
const LEXER = "pending: no lexer yet";

// fixtures of what yuku-css does not build yet: a fixture id, a fixture file, or a directory ending in `/`
export const pending: Record<string, string> = {
  "definition-syntax/": LEXER,
  "definition-syntax-match/": LEXER,
  "sourceMaps/": GENERATOR,
};

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
