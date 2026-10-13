import { encode as encodeString } from "../ast/string";
import type { AnyNode, Node } from "../ast/node";
import { encode as encodeUrl } from "../ast/url";
import {
  AT_KEYWORD,
  CDC,
  CDO,
  COLON,
  COMMA,
  COMMENT,
  DELIM,
  DIMENSION,
  FUNCTION,
  HASH,
  IDENT,
  LEFT_CURLY_BRACKET,
  LEFT_PARENTHESIS,
  NUMBER,
  PERCENTAGE,
  RIGHT_CURLY_BRACKET,
  RIGHT_PARENTHESIS,
  SEMICOLON,
  STRING,
  URL,
  WHITESPACE,
} from "./scan";

/** What a node's printer writes with: css-tree's generator API. */
export interface Printer {
  node(node: Node): void;
  token(type: number, value: string): void;
  tokenize(raw: string): void;
}

interface Item {
  data: AnyNode;
  next: Item | null;
}

const NONE = 0;
const COMMAS = 1;
const SEMICOLONS = 2;

function children(p: Printer, list: any, separator: number): void {
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      if (i > 0) separate(p, list[i - 1], separator);
      p.node(list[i]);
    }
  } else if (list != null && "head" in list) {
    for (let item: Item | null = list.head; item !== null; item = item.next) {
      p.node(item.data);
      if (item.next !== null) separate(p, item.data, separator);
    }
  } else {
    let prev: AnyNode | null = null;
    list.forEach((node: AnyNode) => {
      if (prev !== null) separate(p, prev, separator);
      p.node(node);
      prev = node;
    });
  }
}

function separate(p: Printer, prev: AnyNode, separator: number): void {
  if (separator === COMMAS) p.token(COMMA, ",");
  else if (separator === SEMICOLONS && prev.type === "Declaration") p.token(SEMICOLON, ";");
}

function parenthesized(p: Printer, node: Node): void {
  p.token(LEFT_PARENTHESIS, "(");
  p.node(node);
  p.token(RIGHT_PARENTHESIS, ")");
}

function call(p: Printer, name: string, list: any): void {
  p.token(FUNCTION, name + "(");
  children(p, list, NONE);
  p.token(RIGHT_PARENTHESIS, ")");
}

export function print(p: Printer, n: Node): void {
  const node = n as AnyNode;
  switch (node.type) {
    case "AnPlusB": {
      const a = node.a;
      if (!a) return p.tokenize(node.b);
      const n = a === "+1" || a === "1" ? "n" : a === "-1" ? "-n" : a + "n";
      const b = node.b;
      if (!b) return p.tokenize(n);
      return p.tokenize(n + (b[0] === "-" || b[0] === "+" ? b : "+" + b));
    }
    case "Atrule":
      p.token(AT_KEYWORD, "@" + node.name);
      if (node.prelude !== null) p.node(node.prelude);
      if (node.block) p.node(node.block);
      else p.token(SEMICOLON, ";");
      return;
    case "AtrulePrelude":
    case "Selector":
    case "StyleSheet":
    case "Value":
      return children(p, node.children, NONE);
    case "AttributeSelector":
      p.token(DELIM, "[");
      p.node(node.name);
      if (node.matcher !== null) {
        p.tokenize(node.matcher);
        p.node(node.value);
      }
      if (node.flags !== null) p.token(IDENT, node.flags);
      return p.token(DELIM, "]");
    case "Block":
      p.token(LEFT_CURLY_BRACKET, "{");
      children(p, node.children, SEMICOLONS);
      return p.token(RIGHT_CURLY_BRACKET, "}");
    case "Brackets":
      p.token(DELIM, "[");
      children(p, node.children, NONE);
      return p.token(DELIM, "]");
    case "CDC":
      return p.token(CDC, "-->");
    case "CDO":
      return p.token(CDO, "<!--");
    case "ClassSelector":
      p.token(DELIM, ".");
      return p.token(IDENT, node.name);
    case "Combinator":
    case "Layer":
    case "TypeSelector":
      return p.tokenize(node.name);
    case "Comment":
      return p.token(COMMENT, "/*" + node.value + "*/");
    case "Condition":
      for (const child of node.children) {
        if (child.type === "Condition") parenthesized(p, child);
        else p.node(child);
      }
      return;
    case "Declaration":
      p.token(IDENT, node.property);
      p.token(COLON, ":");
      p.node(node.value);
      if (node.important) {
        p.token(DELIM, "!");
        p.token(IDENT, node.important === true ? "important" : node.important);
      }
      return;
    case "DeclarationList":
      return children(p, node.children, SEMICOLONS);
    case "Dimension":
      return p.token(DIMENSION, node.value + node.unit);
    case "Feature":
      p.token(LEFT_PARENTHESIS, "(");
      p.token(IDENT, node.name);
      if (node.value !== null) {
        p.token(COLON, ":");
        p.node(node.value);
      }
      return p.token(RIGHT_PARENTHESIS, ")");
    case "FeatureFunction":
      p.token(FUNCTION, node.feature + "(");
      p.node(node.value);
      return p.token(RIGHT_PARENTHESIS, ")");
    case "FeatureRange":
      p.token(LEFT_PARENTHESIS, "(");
      p.node(node.left);
      p.tokenize(node.leftComparison);
      p.node(node.middle);
      if (node.right) {
        p.tokenize(node.rightComparison);
        p.node(node.right);
      }
      return p.token(RIGHT_PARENTHESIS, ")");
    case "Function":
      return call(p, node.name, node.children);
    case "GeneralEnclosed":
      if (node.function) return call(p, node.function, node.children);
      p.token(LEFT_PARENTHESIS, "(");
      children(p, node.children, NONE);
      return p.token(RIGHT_PARENTHESIS, ")");
    case "Hash":
      return p.token(HASH, "#" + node.value);
    // a delim, not a hash, so that `a#id` stays unspaced in safe mode
    case "IdSelector":
      return p.token(DELIM, "#" + node.name);
    case "Identifier":
      return p.token(IDENT, node.name);
    case "LayerList":
    case "MediaQueryList":
    case "SelectorList":
      return children(p, node.children, COMMAS);
    case "MediaQuery":
      if (node.mediaType) {
        if (node.modifier) p.token(IDENT, node.modifier);
        p.token(IDENT, node.mediaType);
        if (node.condition) {
          p.token(IDENT, "and");
          p.node(node.condition);
        }
      } else if (node.condition) {
        p.node(node.condition);
      }
      return;
    case "NestingSelector":
      return p.token(DELIM, "&");
    case "Nth":
      p.node(node.nth);
      if (node.selector !== null) {
        p.token(IDENT, "of");
        p.node(node.selector);
      }
      return;
    case "Number":
      return p.token(NUMBER, node.value);
    case "Operator":
    case "Raw":
    case "UnicodeRange":
      return p.tokenize(node.value);
    case "Parentheses":
      p.token(LEFT_PARENTHESIS, "(");
      children(p, node.children, NONE);
      return p.token(RIGHT_PARENTHESIS, ")");
    case "Percentage":
      return p.token(PERCENTAGE, node.value + "%");
    case "PseudoClassSelector":
      p.token(COLON, ":");
      if (node.children === null) return p.token(IDENT, node.name);
      return call(p, node.name, node.children);
    case "PseudoElementSelector":
      p.token(COLON, ":");
      p.token(COLON, ":");
      if (node.children === null) return p.token(IDENT, node.name);
      return call(p, node.name, node.children);
    case "Ratio":
      p.node(node.left);
      p.token(DELIM, "/");
      // css-tree throws here, calling `this.node(NumberToken, 1)` where it means a token
      if (node.right) p.node(node.right);
      else p.token(NUMBER, "1");
      return;
    case "Rule":
      p.node(node.prelude);
      return p.node(node.block);
    case "Scope":
      if (node.root) parenthesized(p, node.root);
      if (node.limit) {
        p.token(IDENT, "to");
        parenthesized(p, node.limit);
      }
      return;
    case "String":
      return p.token(STRING, encodeString(node.value));
    case "SupportsDeclaration":
      return parenthesized(p, node.declaration);
    case "Url":
      return p.token(URL, encodeUrl(node.value));
    case "WhiteSpace":
      return p.token(WHITESPACE, node.value);
    default:
      throw new Error("Unknown node type: " + node.type);
  }
}
