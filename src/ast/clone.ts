import type { AnyNode, Node } from "./node";
import { List } from "./list";
import { walk } from "./walk";

// a css-tree `List`, this package's or css-tree's own
export function isList(value: any): value is List {
  return value instanceof List || (typeof value === "object" && value !== null && "head" in value && typeof value.toArray === "function");
}

/** A deep copy of a node: its child nodes, lists, arrays, and plain objects such as `loc` copied too. */
export function clone<T extends Node>(node: T): T {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(node)) {
    let value = (node as AnyNode)[key];
    if (value) {
      if (Array.isArray(value) || isList(value)) value = value.map((child: AnyNode) => clone(child));
      else if (value.constructor === Object) value = clone(value);
    }
    result[key] = value;
  }
  return result as T;
}

/** Turns each `children` array into a `List`, in place, as css-tree's tree has them. */
export function fromPlainObject<T extends Node>(ast: T): T {
  walk(ast, {
    enter(node) {
      if (node.children && !isList(node.children)) node.children = new List().fromArray(node.children);
    },
  });
  return ast;
}

/** Turns each `children` `List` into an array, in place, as `JSON.stringify` would write it. */
export function toPlainObject<T extends Node>(ast: T): T {
  walk(ast, {
    leave(node) {
      if (isList(node.children)) node.children = node.children.toArray();
    },
  });
  return ast;
}
