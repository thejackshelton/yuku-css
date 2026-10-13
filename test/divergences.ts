// Every place yuku-css parses differently from css-tree 3.2.1, as a fork of css-tree that parses the
// same way. Parity tests compare yuku-css with this fork, so a difference not listed here fails them.
//
// 1. A statement of a style block that does not start with `&` is a nested rule, not a declaration,
//    when a `{}` block comes before any `;`, unless it starts with a custom property and a colon.
//    css-tree reads `.a { .b {} }`, `.a { div & {} }`, and `.a { :hover {} }` as declarations, and
//    keeps them as `Raw`, or for `html:is(.b) & {}` as a declaration whose value holds the block.
//    CSS Syntax 3 (consume a block's contents, consume a declaration) and CSS Nesting 1 §2 read a
//    nested rule: a declaration whose value holds a top-level `{}` block is no declaration.
//
// 2. `@layer`'s block, nested in a style rule, holds declarations as well as rules. css-tree always
//    reads it as rules. CSS Nesting 1 §3 (nested group rules) and CSS Cascade 5 §6.4.3.
//
// 3. A bad URL token that ends in an escape at the end of the source ends there. css-tree's tokenizer
//    ends it one code unit past the source, as in `url(a b\\`. CSS Syntax 3 §4.3.14 (consume the
//    remnants of a bad url) stops at the end of input. `expectTokens` in test/compare.ts clamps it.
//
// Beyond 128 nested blocks or functional pseudo-classes, yuku-css keeps the rest as `Raw` with
// "Nesting is too deep", where css-tree recurses until the JavaScript stack runs out.
import * as csstree from "css-tree";

const { Semicolon, LeftCurlyBracket, RightCurlyBracket, WhiteSpace, Comment, AtKeyword, Ident, Colon } = csstree.tokenTypes;

// css-tree's parser internals the fork calls; its typings leave them out
interface Parser {
  source: string;
  eof: boolean;
  tokenIndex: number;
  tokenCount: number;
  tokenType: number;
  tokenStart: number;
  balance: Uint32Array;
  getTokenType(index: number): number;
  isBlockOpenerTokenType(type: number): boolean;
  isDelim(code: number): boolean;
  lookupNonWSType(offset: number): number;
  next(): void;
  eat(type: number): void;
  createList(): unknown;
  createSingleNodeList(node: unknown): unknown;
  getLocation(start: number, end: number): unknown;
  parseWithFallback(consumer: () => unknown, fallback: () => unknown): unknown;
  consumeUntilSemicolonIncluded(code: number): number;
  Raw(consumeUntil: ((code: number) => number) | null, excludeWhiteSpace: boolean): unknown;
  Rule(): unknown;
  Declaration(): unknown;
  Atrule(isDeclaration: boolean): unknown;
  Block(isStyleBlock: boolean): unknown;
  LayerList(): unknown;
}

function nestedRuleAhead(this: Parser): boolean {
  const first = this.tokenIndex;
  for (let i = first; i < this.tokenCount; i++) {
    if (this.balance[i]! < first) return false;
    const type = this.getTokenType(i);
    if (type === Semicolon) return false;
    if (type === LeftCurlyBracket) return !customPropertyAhead.call(this);
    if (this.isBlockOpenerTokenType(type)) i = this.balance[i]!;
  }
  return false;
}

function customPropertyAhead(this: Parser): boolean {
  return this.tokenType === Ident && this.source.startsWith("--", this.tokenStart) && this.lookupNonWSType(1) === Colon;
}

// css-tree's Block, with divergence 1
function Block(this: Parser, isStyleBlock: boolean): unknown {
  const consumeRaw = () => this.Raw(null, true);
  const consumeRule = () => this.parseWithFallback(this.Rule, consumeRaw);
  const consumeDeclaration = () => {
    if (this.tokenType === Semicolon) return this.Raw(this.consumeUntilSemicolonIncluded, true);
    const node = this.parseWithFallback(this.Declaration, () => this.Raw(this.consumeUntilSemicolonIncluded, true));
    if (this.tokenType === Semicolon) this.next();
    return node;
  };
  const start = this.tokenStart;
  const children = this.createList() as { push(node: unknown): void };
  this.eat(LeftCurlyBracket);
  scan: while (!this.eof) {
    switch (this.tokenType) {
      case RightCurlyBracket:
        break scan;
      case WhiteSpace:
      case Comment:
        this.next();
        break;
      case AtKeyword:
        children.push(this.parseWithFallback(this.Atrule.bind(this, isStyleBlock), consumeRaw));
        break;
      default:
        if (!isStyleBlock || this.isDelim(0x26) || nestedRuleAhead.call(this)) children.push(consumeRule());
        else children.push(consumeDeclaration());
    }
  }
  if (!this.eof) this.eat(RightCurlyBracket);
  return { type: "Block", loc: this.getLocation(start, this.tokenStart), children };
}

export const reference: csstree.Syntax = csstree.fork({
  node: { Block: { parse: Block } },
  atrule: {
    // css-tree's `@layer`, with divergence 2
    layer: {
      parse: {
        prelude(this: Parser) {
          return this.createSingleNodeList(this.LayerList());
        },
        block(this: Parser, nested = false) {
          return this.Block(nested);
        },
      },
    },
  },
} as unknown as Parameters<typeof csstree.fork>[0]);
