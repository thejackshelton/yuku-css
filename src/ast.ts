/** Offsets are UTF-16 code units into the source, `end` exclusive, so `source.slice(start, end)` is the node's text. */
export interface Span {
  start: number;
  end: number;
}

export interface StyleSheet extends Span {
  type: "StyleSheet";
  children: (Rule | AtRule)[];
}

export interface Rule extends Span {
  type: "Rule";
  /** A `Raw` in a keyframes block, and when the selector does not parse. */
  prelude: SelectorList | Raw;
  block: Block;
}

export interface AtRule extends Span {
  type: "AtRule";
  name: string;
  prelude: Raw | null;
  block: Block | null;
}

export interface Block extends Span {
  type: "Block";
  children: (Rule | AtRule | Declaration)[];
}

export interface Declaration extends Span {
  type: "Declaration";
  property: string;
  /** Without `!important`, and with the whitespace around it trimmed. */
  value: Raw;
  important: boolean;
}

/** Source text kept as written. */
export interface Raw extends Span {
  type: "Raw";
  value: string;
}

export interface SelectorList extends Span {
  type: "SelectorList";
  children: ComplexSelector[];
}

export interface ComplexSelector extends Span {
  type: "ComplexSelector";
  /** Starts with a `Combinator` only in a relative selector, as in `:has(> img)` or a nested rule. */
  children: (CompoundSelector | Combinator)[];
}

export interface CompoundSelector extends Span {
  type: "CompoundSelector";
  children: SimpleSelector[];
}

export interface Combinator extends Span {
  type: "Combinator";
  /** `" "` is the descendant combinator. */
  name: " " | ">" | "+" | "~" | "||";
}

export type SimpleSelector =
  | TypeSelector
  | IdSelector
  | ClassSelector
  | AttributeSelector
  | PseudoClassSelector
  | PseudoElementSelector
  | NestingSelector;

export interface TypeSelector extends Span {
  type: "TypeSelector";
  /** `""` for `|a`, `"*"` for `*|a`, null with no `|`. */
  namespace: string | null;
  /** An element name, or `"*"`. */
  name: string;
}

export interface IdSelector extends Span {
  type: "IdSelector";
  name: string;
}

export interface ClassSelector extends Span {
  type: "ClassSelector";
  name: string;
}

export interface AttributeSelector extends Span {
  type: "AttributeSelector";
  namespace: string | null;
  name: string;
  matcher: "=" | "~=" | "|=" | "^=" | "$=" | "*=" | null;
  /** As written, quotes included. */
  value: string | null;
  modifier: string | null;
}

export interface PseudoClassSelector extends Span {
  type: "PseudoClassSelector";
  name: string;
  /**
   * A `SelectorList` for `:is()`, `:where()`, `:not()`, `:has()`, `:matches()`, `:-webkit-any()`,
   * `:-moz-any()`, `:host()`, and `:host-context()`; an `Nth` for `:nth-child()` and its kin;
   * a `Raw` for any other argument; null without parentheses.
   */
  argument: SelectorList | Nth | Raw | null;
}

export interface PseudoElementSelector extends Span {
  type: "PseudoElementSelector";
  name: string;
  argument: Raw | null;
}

/** `&` */
export interface NestingSelector extends Span {
  type: "NestingSelector";
}

/** The argument of `:nth-child()`, `:nth-last-child()`, `:nth-of-type()`, and `:nth-last-of-type()`. */
export interface Nth extends Span {
  type: "Nth";
  /** The `An+B` part, as written. */
  nth: string;
  /** The selector after `of`. */
  selector: SelectorList | null;
}

export type Node =
  | StyleSheet
  | Rule
  | AtRule
  | Block
  | Declaration
  | Raw
  | SelectorList
  | ComplexSelector
  | CompoundSelector
  | Combinator
  | SimpleSelector
  | Nth;

export interface Diagnostic extends Span {
  message: string;
}

export interface ParseResult {
  stylesheet: StyleSheet;
  /** Empty when the source parsed without error. */
  diagnostics: Diagnostic[];
}
