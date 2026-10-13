// fixtures yuku-css must not match: what it does not build yet, and where css-tree contradicts the CSS specs
const LEXER = "no lexer yet";
const PROPERTY = "a declaration starts with an ident, so this is no declaration (css-syntax-3)";
const IMPORTANT = "only `!important` marks a declaration important (css-syntax-3)";
const FORGIVING = ":is() and :where() take a forgiving selector list, which drops what does not parse (selectors-4)";
const COMPLEX = ":is() and :where() take complex selectors, never relative ones (selectors-4)";
const COMPOUND = "takes a <compound-selector>, which is never empty (css-scoping-1)";
const DEEP = "`/deep/` is no combinator (selectors-4)";
const NESTED =
  "a nested rule may start with any selector, and a declaration holding a {}-block is reparsed as a rule (css-nesting-1)";
const BOM = "U+FFFE is no byte order mark; only a leading U+FEFF is stripped (css-syntax-3)";

export const divergences: Record<string, string> = {
  "definition-syntax": LEXER,
  "definition-syntax-match": LEXER,
  sourceMaps: "no generator yet, which the `generate` fields of the ast fixtures also wait for",
  "stringify.css": `\`//color\` in its keyframes: ${PROPERTY}`,

  "ast/declaration/Declaration.json declaration property with // hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with / hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with $ hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with * hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with # hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with + hack": PROPERTY,
  "ast/declaration/Declaration.json declaration property with & hack": PROPERTY,
  "ast/declaration/filter.json filter.2": PROPERTY,
  "ast/rule/Rule.json declaration with //": PROPERTY,

  "ast/declaration/Important.json !ie hack#1": IMPORTANT,
  "ast/declaration/Important.json !ie hack#2": IMPORTANT,
  "ast/declaration/Important.json \\9 hack": IMPORTANT,

  "ast/rule/nesting.json don't parse nested rule when it not started with &": NESTED,
  "ast/declarationList/nesting.json don't parse nested rule when it not started with &": NESTED,
  "ast/atrule/atrule/font-face.json @font-face with declaration looks like a rule in block": NESTED,

  "ast/selector/functional-pseudo/is.json error#2": FORGIVING,
  "ast/selector/functional-pseudo/is.json error#3": FORGIVING,
  "ast/selector/functional-pseudo/is.json error#4": FORGIVING,
  "ast/selector/functional-pseudo/is.json error#6": FORGIVING,
  "ast/selector/functional-pseudo/where.json error#2": FORGIVING,
  "ast/selector/functional-pseudo/where.json error#3": FORGIVING,
  "ast/selector/functional-pseudo/where.json error#4": FORGIVING,
  "ast/selector/functional-pseudo/where.json error#6": FORGIVING,
  "ast/selector/functional-pseudo/is.json should support relative selectors": COMPLEX,
  "ast/selector/functional-pseudo/where.json should support relative selectors": COMPLEX,

  "ast/selector/functional-pseudo/has.json empty argument": ":has() takes a <relative-selector-list>, which is never empty (selectors-4)",
  "ast/selector/functional-pseudo/host.json empty argument": COMPOUND,
  "ast/selector/functional-pseudo/host-context.json empty argument": COMPOUND,
  "ast/selector/functional-pseudo/slotted.json empty argument": COMPOUND,
  "ast/selector/functional-pseudo/lang.json not an error": ":lang() takes a comma-separated list of idents or strings (selectors-4)",

  "ast/selector/Combinator.json legacy shadow-piercing descendant combinator": DEEP,
  "ast/selector/Combinator.json combinator with comments around #4": DEEP,
  "ast/selector/Combinator.json combinator with spaces around #4": DEEP,

  "ast/atrule/atrule/media.json missed 'and' keyword": "a media type and a condition are joined by `and` (mediaqueries-4)",
  "ast/value/function/var.json should be a error here (since unmatched tokens are disallowed), but ok for now":
    "a var() fallback is a <declaration-value>, which holds no unmatched `]` (css-variables-1)",

  "ast/stylesheet/StyleSheet.json BOM UTF-16LE": BOM,
  "ast/stylesheet/StyleSheet.json BOM UTF-16LE #2": BOM,
};
