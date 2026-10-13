// Checks yuku-css against css-tree on every file of test/corpus: both trees are reduced to the
// same outline, one line per node with its span, and the outlines must match.
//
// Intentional differences, normalized away below:
// - css-tree has no compound selector node, so ours are flattened into the complex selector.
// - css-tree gives the descendant combinator no position, so no combinator outline has one.
// - css-tree parses keyframe selectors; ours stay raw, so both outline as the prelude's span.
// - css-tree parses the arguments of `:dir()`, `:lang()`, `::slotted()`, and the like; ours stay
//   raw unless they hold selectors, so an argument other than a selector list outlines as its span.
// - css-tree wraps `:host()`'s argument in a `Selector`; ours is a `SelectorList`.
// - css-tree ends a declaration after the whitespace before `;`; ours ends at the value.
// - css-tree keeps the whitespace around a custom property's value; ours trims it, as CSS does.
// - css-tree keeps an empty statement `;` as a `Raw` node and `/*! */` comments as `Comment` nodes.
//
// css-tree reads a nested rule that starts with a type selector, as in `html.dark & {}`, or with
// a selector list, as a declaration. It then either fails and keeps a `Raw` node, or, for
// `html:is(.a) & {}`, keeps a declaration whose value holds the block, where CSS reads a rule.
// Each such node is parsed again as rules, and the errors must all fall inside those nodes.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as csstree from "css-tree";
import { parse, type Node } from "yuku-css";

const CORPUS = new URL("corpus/", import.meta.url);
const OPTIONS = { positions: true, parseValue: false, parseAtrulePrelude: false, parseCustomProperty: false };

describe("parity with css-tree", () => {
  for (const name of readdirSync(CORPUS).sort()) {
    test(name, () => {
      const source = readFileSync(new URL(name, CORPUS), "utf8");
      const { stylesheet, diagnostics } = parse(source);
      expect(diagnostics).toEqual([]);
      const errors: number[] = [];
      const reference = csstree.parse(source, {
        ...OPTIONS,
        onParseError: (error) => errors.push((error as unknown as { offset: number }).offset),
      });
      const reparsed: [number, number][] = [];
      expect(outline(stylesheet, source)).toEqual(referenceOutline(reference, source, reparsed));
      const unexplained = errors.filter((offset) => !reparsed.some(([start, end]) => start <= offset && offset <= end));
      expect(unexplained).toEqual([]);
    });
  }
});

function span(node: { start: number; end: number }): string {
  return `${node.start}-${node.end}`;
}

function outline(root: Node, source: string): string[] {
  const lines: string[] = [];
  const visit = (node: Node): void => {
    switch (node.type) {
      case "StyleSheet":
      case "Block":
        lines.push(`${node.type} ${span(node)}`);
        node.children.forEach(visit);
        return;
      case "Rule":
        lines.push(`Rule ${span(node)}`);
        if (node.prelude.type === "Raw") lines.push(`Prelude ${span(node.prelude)}`);
        else visit(node.prelude);
        visit(node.block);
        return;
      case "AtRule":
        lines.push(`AtRule ${span(node)} ${node.name}`);
        if (node.prelude) lines.push(`Raw ${span(node.prelude)} ${node.prelude.value}`);
        if (node.block) visit(node.block);
        return;
      case "Declaration":
        lines.push(
          `Declaration ${node.start}-${trimEnd(source, node.end)} ${node.property} ${node.important}`,
          `Value ${span(node.value)} ${node.value.value}`,
        );
        return;
      case "SelectorList":
        lines.push(`SelectorList ${span(node)}`);
        node.children.forEach(visit);
        return;
      case "ComplexSelector":
        lines.push(`Selector ${span(node)}`);
        node.children.forEach(visit);
        return;
      case "CompoundSelector":
        node.children.forEach(visit);
        return;
      case "Combinator":
        lines.push(`Combinator ${node.name}`);
        return;
      case "TypeSelector":
        lines.push(`Type ${span(node)} ${node.namespace === null ? "" : `${node.namespace}|`}${node.name}`);
        return;
      case "IdSelector":
      case "ClassSelector":
        lines.push(`${node.type} ${span(node)} ${node.name}`);
        return;
      case "AttributeSelector": {
        const name = node.namespace === null ? node.name : `${node.namespace}|${node.name}`;
        lines.push(`Attribute ${span(node)} ${name} ${node.matcher} ${node.value} ${node.modifier}`);
        return;
      }
      case "PseudoClassSelector":
      case "PseudoElementSelector":
        lines.push(`${node.type} ${span(node)} ${node.name}`);
        if (node.argument === null) return;
        if (node.argument.type === "Raw") lines.push(`Argument ${span(node.argument)}`);
        else visit(node.argument);
        return;
      case "Nth":
        lines.push(`Nth ${span(node)}`);
        if (node.selector) visit(node.selector);
        return;
      case "NestingSelector":
        lines.push(`Nesting ${span(node)}`);
        return;
      case "Raw":
        lines.push(`Raw ${span(node)} ${node.value}`);
        return;
    }
  };
  visit(root);
  return lines;
}

function referenceOutline(root: csstree.CssNode, source: string, reparsed: [number, number][]): string[] {
  const lines: string[] = [];
  const at = (node: csstree.CssNode): string => `${node.loc!.start.offset}-${node.loc!.end.offset}`;
  const children = (node: { children: csstree.List<csstree.CssNode> }): csstree.CssNode[] => node.children.toArray();

  const visit = (node: csstree.CssNode, keyframes = false): void => {
    switch (node.type) {
      case "StyleSheet":
      case "Block":
        lines.push(`${node.type} ${at(node)}`);
        for (const child of children(node)) {
          if (child.type === "Comment") continue;
          if (child.type === "Raw" && child.value === ";") continue;
          const misread =
            child.type === "Raw" ||
            (child.type === "Declaration" && !child.property.startsWith("--") && (child.value as csstree.Raw).value.includes("{"));
          if (misread && node.type === "Block" && !keyframes) {
            const start = child.loc!.start.offset;
            const end = child.loc!.end.offset;
            reparsed.push([start, end]);
            let failed = false;
            const sheet = csstree.parse(source.slice(start, end), {
              ...OPTIONS,
              offset: start,
              onParseError: () => (failed = true),
            }) as csstree.StyleSheet;
            if (failed) lines.push(`Unparsed ${at(child)}`);
            else children(sheet).forEach((rule) => visit(rule));
            continue;
          }
          visit(child, keyframes);
        }
        return;
      case "Rule":
        lines.push(`Rule ${at(node)}`);
        if (keyframes || node.prelude.type === "Raw") lines.push(`Prelude ${at(node.prelude)}`);
        else visit(node.prelude);
        visit(node.block);
        return;
      case "Atrule":
        lines.push(`AtRule ${at(node)} ${node.name}`);
        if (node.prelude) lines.push(`Raw ${at(node.prelude)} ${(node.prelude as csstree.Raw).value}`);
        if (node.block) visit(node.block, node.name.toLowerCase().endsWith("keyframes"));
        return;
      case "Declaration": {
        const value = node.value as csstree.Raw;
        const start = value.loc!.start.offset;
        const end = value.loc!.end.offset;
        const trimmedStart = start + (source.slice(start, end).length - source.slice(start, end).trimStart().length);
        const trimmedEnd = trimEnd(source, end);
        const important = node.important === false ? "false" : "true";
        const declarationEnd = trimEnd(source, node.loc!.end.offset);
        lines.push(
          `Declaration ${node.loc!.start.offset}-${declarationEnd} ${node.property} ${important}`,
          `Value ${trimmedStart}-${Math.max(trimmedStart, trimmedEnd)} ${source.slice(trimmedStart, trimmedEnd)}`,
        );
        return;
      }
      case "SelectorList":
        lines.push(`SelectorList ${at(node)}`);
        children(node).forEach((child) => visit(child));
        return;
      case "Selector":
        lines.push(`Selector ${at(node)}`);
        children(node).forEach((child) => visit(child));
        return;
      case "Combinator":
        lines.push(`Combinator ${node.name}`);
        return;
      case "TypeSelector":
        lines.push(`Type ${at(node)} ${node.name}`);
        return;
      case "IdSelector":
      case "ClassSelector":
        lines.push(`${node.type} ${at(node)} ${node.name}`);
        return;
      case "AttributeSelector": {
        const value = node.value === null ? null : source.slice(node.value.loc!.start.offset, node.value.loc!.end.offset);
        lines.push(`Attribute ${at(node)} ${node.name.name} ${node.matcher} ${value} ${node.flags}`);
        return;
      }
      case "PseudoClassSelector":
      case "PseudoElementSelector": {
        lines.push(`${node.type} ${at(node)} ${node.name}`);
        if (node.children === null) return;
        const [first, ...rest] = children(node as { children: csstree.List<csstree.CssNode> });
        if (first === undefined) return;
        if (node.type === "PseudoClassSelector" && first.type === "SelectorList") visit(first);
        else if (node.type === "PseudoClassSelector" && first.type === "Nth") visit(first);
        else if (node.type === "PseudoClassSelector" && first.type === "Selector") {
          lines.push(`SelectorList ${at(first)}`);
          visit(first);
        } else {
          const last = rest.at(-1) ?? first;
          lines.push(`Argument ${first.loc!.start.offset}-${last.loc!.end.offset}`);
        }
        return;
      }
      case "Nth":
        lines.push(`Nth ${at(node)}`);
        if (node.selector) visit(node.selector);
        return;
      case "NestingSelector":
        lines.push(`Nesting ${at(node)}`);
        return;
      case "Raw":
        lines.push(`Raw ${at(node)} ${node.value}`);
        return;
      default:
        lines.push(`Unexpected ${node.type} ${at(node)}`);
    }
  };
  visit(root);
  return lines;
}

function trimEnd(source: string, end: number): number {
  while (end > 0 && /\s/.test(source[end - 1]!)) end--;
  return end;
}
