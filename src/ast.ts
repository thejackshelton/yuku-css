/** UTF-16 offsets into the source, `end` exclusive, so `source.slice(start, end)` is the node's text. */
export interface Offsets {
  start: number;
  end: number;
}

export interface Location {
  source: string;
  start: Point;
  end: Point;
}

export interface Point {
  offset: number;
  line: number;
  column: number;
}

/** With `positions: true`: css-tree's `loc`, null on the descendant combinator. */
export interface Positions {
  loc: Location | null;
}

export type Position = Offsets | Positions;

export type StyleSheet<P extends Position = Offsets> = P & {
  type: "StyleSheet";
  children: (Comment<P> | CDO<P> | CDC<P> | Atrule<P> | Rule<P> | Raw<P>)[];
};

/** A comment: in the tree, a `/*! *\/` at the top of the style sheet, the only kind css-tree keeps. */
export type Comment<P extends Position = Offsets> = P & {
  type: "Comment";
  /** Between `/*` and `*\/`. */
  value: string;
};

/** `<!--` */
export type CDO<P extends Position = Offsets> = P & { type: "CDO" };

/** `-->` */
export type CDC<P extends Position = Offsets> = P & { type: "CDC" };

export type Atrule<P extends Position = Offsets> = P & {
  type: "Atrule";
  name: string;
  /** A `Raw` when the prelude does not parse, or with `parseAtrulePrelude: false`. */
  prelude: AtrulePrelude<P> | Raw<P> | null;
  block: Block<P> | null;
};

export type Rule<P extends Position = Offsets> = P & {
  type: "Rule";
  /** A `Raw` when the selector does not parse, or with `parseRulePrelude: false`. */
  prelude: SelectorList<P> | Raw<P>;
  block: Block<P>;
};

export type Block<P extends Position = Offsets> = P & {
  type: "Block";
  children: (Atrule<P> | Rule<P> | Declaration<P> | Raw<P>)[];
};

/** The contents of a style block without its braces, as the `declarationList` context reads them. */
export type DeclarationList<P extends Position = Offsets> = P & {
  type: "DeclarationList";
  children: (Atrule<P> | Rule<P> | Declaration<P> | Raw<P>)[];
};

export type Declaration<P extends Position = Offsets> = P & {
  type: "Declaration";
  /** `true` for `!important`, the word after `!` for any other, as in `!ie`. */
  important: boolean | string;
  property: string;
  /**
   * A `Raw` when the value does not parse, with `parseValue: false`, or for a custom property
   * without `parseCustomProperty`.
   */
  value: Value<P> | Raw<P>;
};

/** Source text kept as written. */
export type Raw<P extends Position = Offsets> = P & {
  type: "Raw";
  value: string;
};

export type SelectorList<P extends Position = Offsets> = P & {
  type: "SelectorList";
  children: Selector<P>[];
};

/** Simple selectors and the combinators between them, in order. */
export type Selector<P extends Position = Offsets> = P & {
  type: "Selector";
  children: (SimpleSelector<P> | Combinator<P> | Percentage<P>)[];
};

export type SimpleSelector<P extends Position = Offsets> =
  | TypeSelector<P>
  | IdSelector<P>
  | ClassSelector<P>
  | AttributeSelector<P>
  | PseudoClassSelector<P>
  | PseudoElementSelector<P>
  | NestingSelector<P>;

export type TypeSelector<P extends Position = Offsets> = P & {
  type: "TypeSelector";
  /** As written, with a namespace before `|`: `a`, `*`, `svg|a`, `|a`. */
  name: string;
};

export type IdSelector<P extends Position = Offsets> = P & { type: "IdSelector"; name: string };

export type ClassSelector<P extends Position = Offsets> = P & { type: "ClassSelector"; name: string };

export type AttributeSelector<P extends Position = Offsets> = P & {
  type: "AttributeSelector";
  name: Identifier<P>;
  matcher: "=" | "~=" | "|=" | "^=" | "$=" | "*=" | null;
  value: StringNode<P> | Identifier<P> | null;
  flags: string | null;
};

export type PseudoClassSelector<P extends Position = Offsets> = P & {
  type: "PseudoClassSelector";
  name: string;
  /**
   * Null without parentheses. A `SelectorList` for `:is()`, `:where()`, `:not()`, `:has()`,
   * `:matches()`, `:-moz-any()` and `:-webkit-any()`; a `Selector` for `:host()` and
   * `:host-context()`; an `Nth` for `:nth-child()` and its kin; an `Identifier` for `:dir()`;
   * identifiers, strings, and commas for `:lang()`; a `Raw` for any other.
   */
  children: (SelectorList<P> | Selector<P> | Nth<P> | Identifier<P> | StringNode<P> | Operator<P> | Raw<P>)[] | null;
};

export type PseudoElementSelector<P extends Position = Offsets> = P & {
  type: "PseudoElementSelector";
  name: string;
  /** Null without parentheses. A `Selector` for `::slotted()`, a `Raw` for any other. */
  children: (Selector<P> | Raw<P>)[] | null;
};

/** `&` */
export type NestingSelector<P extends Position = Offsets> = P & { type: "NestingSelector" };

export type Combinator<P extends Position = Offsets> = P & {
  type: "Combinator";
  /** `" "` is the descendant combinator. */
  name: " " | ">" | "+" | "~" | (string & {});
};

/** The argument of `:nth-child()` and its kin. */
export type Nth<P extends Position = Offsets> = P & {
  type: "Nth";
  /** An `Identifier` for `odd` and `even`. */
  nth: AnPlusB<P> | Identifier<P>;
  /** The selector after `of`. */
  selector: SelectorList<P> | null;
};

export type AnPlusB<P extends Position = Offsets> = P & {
  type: "AnPlusB";
  a: string | null;
  b: string | null;
};

export type Identifier<P extends Position = Offsets> = P & { type: "Identifier"; name: string };

/** A string, its quotes removed and its escapes decoded. */
export type StringNode<P extends Position = Offsets> = P & { type: "String"; value: string };

/** A percentage without its `%`, such as the keyframe selector `50%`. */
export type Percentage<P extends Position = Offsets> = P & { type: "Percentage"; value: string };

/** `,`, `/`, `*`, `+` or `-`; in a value, a `+` or `-` keeps one space on each side that has whitespace. */
export type Operator<P extends Position = Offsets> = P & { type: "Operator"; value: string };

/** A declaration value: its component values, without the whitespace and comments between them. */
export type Value<P extends Position = Offsets> = P & { type: "Value"; children: ValueChild<P>[] };

/** A component value. */
export type ValueChild<P extends Position = Offsets> =
  | Identifier<P>
  | NumberNode<P>
  | Dimension<P>
  | Percentage<P>
  | Hash<P>
  | StringNode<P>
  | Url<P>
  | FunctionNode<P>
  | Parentheses<P>
  | Brackets<P>
  | Operator<P>
  | UnicodeRange<P>
  | WhiteSpace<P>
  | Raw<P>
  | Value<P>;

/** A number as written, sign and exponent included. */
export type NumberNode<P extends Position = Offsets> = P & { type: "Number"; value: string };

export type Dimension<P extends Position = Offsets> = P & {
  type: "Dimension";
  /** The number as written. */
  value: string;
  unit: string;
};

/** A hash, such as a hex color, without its `#`. */
export type Hash<P extends Position = Offsets> = P & { type: "Hash"; value: string };

/** A URL, without `url(`, quotes and `)`, its escapes decoded. */
export type Url<P extends Position = Offsets> = P & { type: "Url"; value: string };

export type FunctionNode<P extends Position = Offsets> = P & {
  type: "Function";
  /** As written, without `(`. */
  name: string;
  /**
   * The arguments; for `var()`, an `Identifier`, then a comma `Operator` and a `Raw` fallback
   * (a `Value` with `parseCustomProperty`); for `expression()`, a `Raw`.
   */
  children: ValueChild<P>[];
};

export type Parentheses<P extends Position = Offsets> = P & { type: "Parentheses"; children: ValueChild<P>[] };

export type Brackets<P extends Position = Offsets> = P & { type: "Brackets"; children: ValueChild<P>[] };

/** A `<urange>` as written, such as `U+0025-00FF`. */
export type UnicodeRange<P extends Position = Offsets> = P & { type: "UnicodeRange"; value: string };

/** A `<ratio>`, such as `16 / 9`. */
export type Ratio<P extends Position = Offsets> = P & {
  type: "Ratio";
  left: NumberNode<P> | FunctionNode<P>;
  /** Null for a lone number. */
  right: NumberNode<P> | FunctionNode<P> | null;
};

/** The `" "` css-tree places in an empty custom property value, or `var()` fallback, that has whitespace. */
export type WhiteSpace<P extends Position = Offsets> = P & { type: "WhiteSpace"; value: " " };

/**
 * An at-rule's prelude: for `@media`, a `MediaQueryList`; for `@supports`, a `Condition`; for
 * `@container`, an optional name `Identifier` and a `Condition`; for `@import`, a `StringNode` or
 * `Url`, then `layer` or a `layer()` and a `supports()` `FunctionNode`, then a `MediaQueryList`; for
 * `@layer`, a `LayerList`; for `@scope`, a `Scope`; for `@page` and `@nest`, a `SelectorList`; for
 * any other, component values.
 */
export type AtrulePrelude<P extends Position = Offsets> = P & {
  type: "AtrulePrelude";
  children: (MediaQueryList<P> | Condition<P> | LayerList<P> | Scope<P> | SelectorList<P> | ValueChild<P>)[];
};

export type MediaQueryList<P extends Position = Offsets> = P & { type: "MediaQueryList"; children: MediaQuery<P>[] };

export type MediaQuery<P extends Position = Offsets> = P & {
  type: "MediaQuery";
  /** Lowercased. */
  modifier: "not" | "only" | null;
  mediaType: string | null;
  condition: Condition<P> | null;
};

export type ConditionKind = "media" | "supports" | "container";

/** Terms, the `and`, `or` and `not` between them as identifiers, and conditions in parentheses. */
export type Condition<P extends Position = Offsets> = P & {
  type: "Condition";
  kind: ConditionKind;
  children: (
    | Identifier<P>
    | Feature<P>
    | FeatureRange<P>
    | FeatureFunction<P>
    | GeneralEnclosed<P>
    | SupportsDeclaration<P>
    | Condition<P>
  )[];
};

/** `(name)` or `(name: value)`. */
export type Feature<P extends Position = Offsets> = P & {
  type: "Feature";
  kind: ConditionKind;
  name: string;
  value: NumberNode<P> | Dimension<P> | Identifier<P> | Ratio<P> | FunctionNode<P> | null;
};

export type FeatureRangeTerm<P extends Position = Offsets> = NumberNode<P> | Dimension<P> | Identifier<P> | Ratio<P> | FunctionNode<P>;

/** `(left < middle)` or `(left < middle < right)`. */
export type FeatureRange<P extends Position = Offsets> = P & {
  type: "FeatureRange";
  kind: ConditionKind;
  left: FeatureRangeTerm<P>;
  leftComparison: "<" | "<=" | ">" | ">=" | "=";
  middle: FeatureRangeTerm<P>;
  rightComparison: "<" | "<=" | ">" | ">=" | "=" | null;
  right: FeatureRangeTerm<P> | null;
};

/** `selector()` in `@supports`, `style()` in `@container`. */
export type FeatureFunction<P extends Position = Offsets> = P & {
  type: "FeatureFunction";
  kind: ConditionKind;
  /** As written, without `(`. */
  feature: string;
  value: Selector<P> | Declaration<P> | Raw<P>;
};

/** A function or parentheses no other term reads; its contents a `Raw` when they do not parse. */
export type GeneralEnclosed<P extends Position = Offsets> = P & {
  type: "GeneralEnclosed";
  kind: ConditionKind;
  /** Null for parentheses. */
  function: string | null;
  children: ValueChild<P>[];
};

export type SupportsDeclaration<P extends Position = Offsets> = P & { type: "SupportsDeclaration"; declaration: Declaration<P> };

/** A layer name as written, such as `a.b`. */
export type Layer<P extends Position = Offsets> = P & { type: "Layer"; name: string };

export type LayerList<P extends Position = Offsets> = P & { type: "LayerList"; children: Layer<P>[] };

/** `@scope`'s root and limit selectors, each a `Raw` when it does not parse. */
export type Scope<P extends Position = Offsets> = P & {
  type: "Scope";
  root: SelectorList<P> | Raw<P> | null;
  limit: SelectorList<P> | Raw<P> | null;
};

export type CssNode<P extends Position = Offsets> =
  | StyleSheet<P>
  | Comment<P>
  | CDO<P>
  | CDC<P>
  | Atrule<P>
  | Rule<P>
  | Block<P>
  | DeclarationList<P>
  | Declaration<P>
  | Raw<P>
  | SelectorList<P>
  | Selector<P>
  | SimpleSelector<P>
  | Combinator<P>
  | Nth<P>
  | AnPlusB<P>
  | Identifier<P>
  | StringNode<P>
  | Percentage<P>
  | Operator<P>
  | Value<P>
  | NumberNode<P>
  | Dimension<P>
  | Hash<P>
  | Url<P>
  | FunctionNode<P>
  | Parentheses<P>
  | Brackets<P>
  | UnicodeRange<P>
  | Ratio<P>
  | WhiteSpace<P>
  | AtrulePrelude<P>
  | MediaQueryList<P>
  | MediaQuery<P>
  | Condition<P>
  | Feature<P>
  | FeatureRange<P>
  | FeatureFunction<P>
  | GeneralEnclosed<P>
  | SupportsDeclaration<P>
  | Layer<P>
  | LayerList<P>
  | Scope<P>;

/** A problem in the source, in the shape Yuku gives it. */
export interface Diagnostic extends Offsets {
  severity: "error";
  /** css-tree's message for the error, or the spec's where css-tree reads none. */
  message: string;
  /** `filename`, or null without one. */
  path: string | null;
  labels: { start: number; end: number; message: string }[];
  help: string | null;
}

/** The node each parse context gives, by css-tree's name for the context. */
export interface Contexts<P extends Position = Offsets> {
  stylesheet: StyleSheet<P>;
  atrule: Atrule<P>;
  atrulePrelude: AtrulePrelude<P>;
  mediaQueryList: MediaQueryList<P>;
  mediaQuery: MediaQuery<P>;
  rule: Rule<P>;
  selectorList: SelectorList<P>;
  selector: Selector<P>;
  block: Block<P>;
  declarationList: DeclarationList<P>;
  declaration: Declaration<P>;
  value: Value<P>;
}

export interface ParseResult<P extends Position = Offsets, C extends keyof Contexts = "stylesheet"> {
  /**
   * The node of the context; for any context but `stylesheet`, a `Raw` of the source when it does not
   * parse as one. Built when first read.
   */
  ast: C extends "stylesheet" ? StyleSheet<P> : Contexts<P>[C] | Raw<P>;
  /** Every comment, in source order. */
  comments: Comment<P>[];
  /** Every token, with `tokens: true`. */
  tokens?: Uint32Array;
  /** Empty when the source parsed without error. */
  diagnostics: Diagnostic[];
}
