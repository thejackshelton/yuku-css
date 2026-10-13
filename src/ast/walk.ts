import type { AnyNode, Node } from "./node";
import type { List, ListItem } from "./list";
import { STRUCTURE } from "./structure";

const BREAK: unique symbol = Symbol("break-walk");
const SKIP: unique symbol = Symbol("skip-node");

/** `this` in a walk's handlers: the nearest enclosing node of each kind, and the walk's controls. */
export interface WalkContext {
  /** Return it to stop the walk. */
  break: typeof BREAK;
  /** Return it from `enter` to leave the node's children unvisited, and its `leave` uncalled. */
  skip: typeof SKIP;
  root: AnyNode;
  stylesheet: AnyNode | null;
  atrule: AnyNode | null;
  atrulePrelude: AnyNode | null;
  rule: AnyNode | null;
  selector: AnyNode | null;
  block: AnyNode | null;
  declaration: AnyNode | null;
  function: AnyNode | null;
}

/**
 * Called with each node, and where the node is in its parent's children: its `List` item and the
 * `List`, or its index and the array. Both are undefined for a node held in a field of its own.
 */
export type WalkHandler = (
  this: WalkContext,
  node: AnyNode,
  item: ListItem<AnyNode> | number | undefined,
  list: List<AnyNode> | AnyNode[] | undefined,
) => unknown;

export interface WalkOptions {
  enter?: WalkHandler;
  leave?: WalkHandler;
  /** Call the handlers only for nodes of this type, and for `Atrule`, `Rule`, and `Declaration` walk only where they can be. */
  visit?: string;
  /** Visit children last to first. */
  reverse?: boolean;
}

export interface Walk {
  (root: Node, options: WalkHandler | WalkOptions): void;
  readonly break: typeof BREAK;
  readonly skip: typeof SKIP;
}

interface Field {
  name: string;
  list: boolean;
}

interface Children {
  context: keyof WalkContext | null;
  fields: Field[];
}

type Iterators = Record<string, Children | undefined>;

const NATURAL: Iterators = Object.create(null);
const REVERSE: Iterators = Object.create(null);
for (const [type, [context, fields]] of Object.entries(STRUCTURE)) {
  if (fields.length === 0) continue;
  const natural = fields.map((field) => (field.startsWith("[]") ? { name: field.slice(2), list: true } : { name: field, list: false }));
  NATURAL[type] = { context: context as keyof WalkContext | null, fields: natural };
  REVERSE[type] = { context: context as keyof WalkContext | null, fields: natural.slice().reverse() };
}

// `visit` for these walks only the nodes that can hold them
function only(iterators: Iterators, types: string[]): Iterators {
  const subset: Iterators = Object.create(null);
  for (const type of types) subset[type] = iterators[type];
  return subset;
}

const RULE_HOLDERS = ["StyleSheet", "Atrule", "Rule", "Block"];
const FAST: Record<string, [Iterators, Iterators]> = {
  Atrule: [only(NATURAL, RULE_HOLDERS), only(REVERSE, RULE_HOLDERS)],
  Rule: [only(NATURAL, RULE_HOLDERS), only(REVERSE, RULE_HOLDERS)],
  Declaration: [only(NATURAL, [...RULE_HOLDERS, "DeclarationList"]), only(REVERSE, [...RULE_HOLDERS, "DeclarationList"])],
};

const noop = (): void => {};

function ofType(fn: WalkHandler, type: string): WalkHandler {
  return function (node, item, list) {
    if (node.type === type) return fn.call(this, node, item, list);
  };
}

/**
 * Walks a tree depth first, calling `enter` before a node's children and `leave` after them. A
 * handler stops the walk by returning `walk.break`, and `enter` skips a node's children by
 * returning `walk.skip`. Children may be arrays or css-tree `List`s.
 */
export const walk: Walk = Object.assign(
  function walk(root: Node, options: WalkHandler | WalkOptions): void {
    let enter: WalkHandler = noop;
    let leave: WalkHandler = noop;
    let iterators = NATURAL;
    let reverse = false;
    if (typeof options === "function") {
      enter = options;
    } else if (options) {
      if (typeof options.enter === "function") enter = options.enter;
      if (typeof options.leave === "function") leave = options.leave;
      reverse = options.reverse === true;
      if (reverse) iterators = REVERSE;
      const visit = options.visit;
      if (visit) {
        const fast = FAST[visit];
        if (fast !== undefined) iterators = fast[reverse ? 1 : 0];
        else if (!Object.hasOwn(STRUCTURE, visit)) {
          throw new Error("Bad value `" + visit + "` for `visit` option (should be: " + Object.keys(STRUCTURE).sort().join(", ") + ")");
        }
        enter = ofType(enter, visit);
        leave = ofType(leave, visit);
      }
    }
    if (enter === noop && leave === noop) {
      throw new Error("Neither `enter` nor `leave` walker handler is set or both aren't a function");
    }

    const context: WalkContext = {
      break: BREAK,
      skip: SKIP,
      root: root as AnyNode,
      stylesheet: null,
      atrule: null,
      atrulePrelude: null,
      rule: null,
      selector: null,
      block: null,
      declaration: null,
      function: null,
    };
    const reducer = (stopped: boolean, node: AnyNode, item: ListItem<AnyNode>, list: List<AnyNode>): boolean =>
      stopped || walkNode(node, item, list);

    function walkNode(node: AnyNode, item?: ListItem<AnyNode> | number, list?: List<AnyNode> | AnyNode[]): boolean {
      const entered = enter.call(context, node, item, list);
      if (entered === BREAK) return true;
      if (entered === SKIP) return false;
      const children = iterators[node.type];
      if (children !== undefined) {
        const key = children.context;
        const outer = key === null ? null : context[key];
        if (key !== null) (context as any)[key] = node;
        for (const field of children.fields) {
          const ref = node[field.name];
          if (!ref) continue;
          if (!field.list) {
            if (walkNode(ref)) return true;
          } else if (Array.isArray(ref)) {
            if (reverse) {
              for (let i = ref.length - 1; i >= 0; i--) if (walkNode(ref[i], i, ref)) return true;
            } else {
              for (let i = 0; i < ref.length; i++) if (walkNode(ref[i], i, ref)) return true;
            }
          } else if (reverse ? ref.reduceRight(reducer, false) : ref.reduce(reducer, false)) {
            return true;
          }
        }
        if (key !== null) (context as any)[key] = outer;
      }
      return leave.call(context, node, item, list) === BREAK;
    }

    walkNode(root as AnyNode);
  },
  { break: BREAK, skip: SKIP } as const,
);

type Predicate = WalkHandler;

/** The first node, in walk order, for which `fn` is truthy. */
export function find(ast: Node, fn: Predicate): AnyNode | null {
  let found: AnyNode | null = null;
  walk(ast, function (node, item, list) {
    if (fn.call(this, node, item, list)) {
      found = node;
      return BREAK;
    }
  });
  return found;
}

/** The first node for which `fn` is truthy, walking children last to first. */
export function findLast(ast: Node, fn: Predicate): AnyNode | null {
  let found: AnyNode | null = null;
  walk(ast, {
    reverse: true,
    enter(node, item, list) {
      if (fn.call(this, node, item, list)) {
        found = node;
        return BREAK;
      }
    },
  });
  return found;
}

/** Every node, in walk order, for which `fn` is truthy. */
export function findAll(ast: Node, fn: Predicate): AnyNode[] {
  const found: AnyNode[] = [];
  walk(ast, function (node, item, list) {
    if (fn.call(this, node, item, list)) found.push(node);
  });
  return found;
}
