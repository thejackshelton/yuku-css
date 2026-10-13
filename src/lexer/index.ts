import { createLexer, fork, Lexer, lexerOf, unitGroups } from "./lexer";
import { definitionSyntaxError, generate, parse, walk } from "./syntax";

export type * from "./syntax";
export type {
  AtruleDescriptor,
  Descriptor,
  LexerConfig,
  MatchNode,
  MatchResult,
  Position,
  SyntaxMatchError,
  SyntaxReferenceError,
  SyntaxSource,
  Units,
} from "./lexer";
export { createLexer, fork, Lexer, unitGroups };

/** css-tree's `definitionSyntax`: the CSS Value Definition Syntax as a tree. */
export const definitionSyntax: {
  parse: typeof parse;
  generate: typeof generate;
  walk: typeof walk;
  SyntaxError: typeof definitionSyntaxError;
} = { parse, generate, walk, SyntaxError: definitionSyntaxError };

/** The lexer over the CSS grammar: `@webref/css`, patched, with css-tree's generic types. */
export const lexer: Lexer = lexerOf();
