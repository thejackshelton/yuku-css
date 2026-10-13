// the grammar tools/gen_grammar.zig compiles, assembled again in JavaScript for css-tree's own lexer,
// so css-tree's matcher on the same data is the oracle for yuku-css's
import { readFileSync } from "node:fs";
import { createLexer, definitionSyntax, type DSNode, type Lexer } from "css-tree";

interface Feature {
  name: string;
  syntax?: string;
  descriptors?: Feature[];
}
interface Patch {
  syntax?: string | null;
  prelude?: string | null;
  descriptors?: Record<string, Patch>;
  reason?: string;
}
export interface Data {
  types: Record<string, string>;
  properties: Record<string, string>;
  atrules: Record<string, { prelude: string | null; descriptors: Record<string, string> | null }>;
}

const root = new URL("../../", import.meta.url);
const webref = JSON.parse(readFileSync(new URL("node_modules/@webref/css/css.json", root), "utf8")) as Record<
  "types" | "functions" | "properties" | "atrules",
  Feature[]
>;
export const patch = JSON.parse(readFileSync(new URL("src/grammar/patch.json", root), "utf8")) as Record<
  "types" | "properties" | "atrules",
  Record<string, Patch>
>;

/** The names css-tree's generic types take over, so the data does not carry them. */
export const GENERIC: Set<string> = new Set(
  (
    "ident-token function-token at-keyword-token hash-token string-token bad-string-token url-token " +
    "bad-url-token delim-token number-token percentage-token dimension-token whitespace-token CDO-token " +
    "CDC-token colon-token semicolon-token comma-token [-token ]-token (-token )-token {-token }-token " +
    "string ident percentage zero number integer custom-ident dashed-ident custom-property-name hex-color " +
    "id-selector an-plus-b urange declaration-value any-value dimension angle decibel frequency flex " +
    "length resolution semitones time attr-unit"
  ).split(" "),
);

function apply(dict: Record<string, string>, patches: Record<string, Patch> = {}): void {
  for (const [name, { syntax }] of Object.entries(patches)) {
    if (syntax === undefined) continue;
    if (syntax === null) delete dict[name];
    else if (/^\s*\|/.test(syntax) && name in dict) dict[name] = dict[name] + " " + syntax.trim();
    else dict[name] = syntax.replace(/^\s*\|\s*/, "");
  }
}

// the terms after the at-keyword, up to the block or the semicolon, of each `@name ...` alternative
export function preludeOf(syntax: string): string | null {
  const tree = definitionSyntax.parse(syntax);
  const startsWithAt = (node: DSNode) => sequence(node)[0]?.type === "AtKeyword";
  const alternatives =
    !tree.explicit && tree.combinator === "|" && tree.terms.every(startsWithAt) ? tree.terms : [tree];
  const preludes: (string | null)[] = alternatives.map((alternative) => {
    const terms = sequence(alternative);
    if (terms[0]?.type !== "AtKeyword") return null;
    const prelude: DSNode[] = [];
    for (const term of terms.slice(1)) {
      if (isBlockOrEnd(term)) break;
      prelude.push(term);
    }
    if (prelude.length === 0) return null;
    return definitionSyntax.generate({
      type: "Group",
      terms: prelude,
      combinator: " ",
      disallowEmpty: false,
      explicit: false,
    });
  });
  const present = preludes.filter((prelude) => prelude !== null);
  if (present.length === 0) return null;
  const joined = present.join(" | ");
  return present.length === preludes.length ? joined : `[ ${joined} ]?`;
}

function sequence(node: DSNode): DSNode[] {
  return node.type === "Group" && !node.explicit && node.combinator === " " ? node.terms : [node];
}

function isBlockOrEnd(node: DSNode): boolean {
  let found = false;
  definitionSyntax.walk(node, (inner) => {
    if (inner.type === "Token" && (inner.value === "{" || inner.value === ";")) found = true;
  });
  return found;
}

export function assemble(): Data {
  const types: Record<string, string> = {};
  for (const feature of [...webref.types, ...webref.functions]) {
    if (feature.syntax === undefined || GENERIC.has(feature.name)) continue;
    const known = types[feature.name];
    types[feature.name] = known !== undefined && known !== feature.syntax ? `${known} | ${feature.syntax}` : feature.syntax;
  }
  apply(types, patch.types);
  const properties: Record<string, string> = {};
  for (const feature of webref.properties) if (feature.syntax !== undefined) properties[feature.name] = feature.syntax;
  apply(properties, patch.properties);
  const atrules: Data["atrules"] = {};
  for (const feature of webref.atrules) {
    const descriptors: Record<string, string> = {};
    for (const descriptor of feature.descriptors ?? []) {
      if (descriptor.syntax !== undefined) descriptors[descriptor.name] = descriptor.syntax;
    }
    const name = feature.name.slice(1);
    const atrulePatch = patch.atrules[name];
    apply(descriptors, atrulePatch?.descriptors);
    const prelude = atrulePatch && "prelude" in atrulePatch
      ? atrulePatch.prelude!
      : feature.syntax === undefined ? null : preludeOf(feature.syntax);
    atrules[name] = { prelude, descriptors: Object.keys(descriptors).length > 0 ? descriptors : null };
  }
  for (const [name, atrulePatch] of Object.entries(patch.atrules)) {
    if (name in atrules) continue;
    const descriptors: Record<string, string> = {};
    apply(descriptors, atrulePatch.descriptors);
    atrules[name] = {
      prelude: atrulePatch.prelude ?? null,
      descriptors: Object.keys(descriptors).length > 0 ? descriptors : null,
    };
  }
  return { types, properties, atrules };
}

export const data: Data = assemble();

/** css-tree's lexer over the same grammar as yuku-css's. */
export const oracle: Lexer = createLexer({ generic: true, ...data } as never);
