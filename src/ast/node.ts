/** A node of css-tree's tree, any of its 49 types, its `children` an array or a css-tree `List`. */
export interface Node {
  type: string;
}

/** A node with its fields untyped, as handlers receive it. */
export type AnyNode = Node & Record<string, any>;
