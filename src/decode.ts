import type { Diagnostic, Node, ParseResult, StyleSheet } from "./ast";

export interface Field {
  name: string;
  kind: "node" | "nodes" | "string" | "bool" | "enum";
  values?: string[];
}

/** The node shapes and messages the WebAssembly describes, in wire order. */
export interface Description {
  nodes: { type: string; fields: Field[] }[];
  messages: string[];
}

interface Shape {
  type: string;
  names: string[];
  kinds: number[];
  values: (string[] | undefined)[];
}

/** A `Description` laid out for decoding. */
export interface Shapes {
  nodes: Shape[];
  messages: string[];
}

const NULL = 0xffffffff;
const KINDS = ["node", "nodes", "string", "bool", "enum"];

export function shapesOf(description: Description): Shapes {
  const nodes = description.nodes.map(({ type, fields }) => ({
    type,
    names: fields.map((field) => field.name),
    kinds: fields.map((field) => KINDS.indexOf(field.kind)),
    values: fields.map((field) => field.values),
  }));
  return { nodes, messages: description.messages };
}

/** Decodes the transfer stream in `words`, after its two-slot header. */
export function decode(words: Uint32Array, source: string, { nodes, messages }: Shapes): ParseResult {
  let at = 2;

  function node(): Node | null {
    const tag = words[at++]!;
    if (tag === NULL) return null;
    const { type, names, kinds, values } = nodes[tag]!;
    const result: Record<string, unknown> = { type, start: words[at++], end: words[at++] };
    for (let i = 0; i < kinds.length; i++) {
      switch (kinds[i]) {
        case 0:
          result[names[i]!] = node();
          break;
        case 1: {
          const list = new Array<Node | null>(words[at++]!);
          for (let j = 0; j < list.length; j++) list[j] = node();
          result[names[i]!] = list;
          break;
        }
        case 2: {
          const start = words[at++]!;
          const end = words[at++]!;
          result[names[i]!] = start === NULL ? null : source.slice(start, end);
          break;
        }
        case 3:
          result[names[i]!] = words[at++] === 1;
          break;
        default:
          result[names[i]!] = values[i]![words[at++]!];
      }
    }
    return result as unknown as Node;
  }

  const stylesheet = node() as StyleSheet;
  const diagnostics = new Array<Diagnostic>(words[at++]!);
  for (let i = 0; i < diagnostics.length; i++) {
    const message = messages[words[at++]!]!;
    diagnostics[i] = { message, start: words[at++]!, end: words[at++]! };
  }
  return { stylesheet, diagnostics };
}
