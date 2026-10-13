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

/** A `/*! *\/` comment at the top of the style sheet, the only kind css-tree keeps. */
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
  /** Kept as written for now. */
  prelude: Raw<P> | null;
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

export type Declaration<P extends Position = Offsets> = P & {
  type: "Declaration";
  /** `true` for `!important`, the word after `!` for any other, as in `!ie`. */
  important: boolean | string;
  property: string;
  /** Kept as written for now. */
  value: Raw<P>;
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

/** A keyframe selector such as `50%`, without its `%`. */
export type Percentage<P extends Position = Offsets> = P & { type: "Percentage"; value: string };

export type Operator<P extends Position = Offsets> = P & { type: "Operator"; value: string };

export type CssNode<P extends Position = Offsets> =
  | StyleSheet<P>
  | Comment<P>
  | CDO<P>
  | CDC<P>
  | Atrule<P>
  | Rule<P>
  | Block<P>
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
  | Operator<P>;

export interface Diagnostic extends Offsets {
  /** css-tree's message for the error. */
  message: string;
}

export interface ParseResult<P extends Position = Offsets> {
  stylesheet: StyleSheet<P>;
  /** Empty when the source parsed without error. */
  diagnostics: Diagnostic[];
}
