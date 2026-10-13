// css-tree's lib/__tests/helpers/index.js, and its `parse`, as the ported lexer tests use them
import { parse as parseCss } from "yuku-css";
import { fromPlainObject } from "yuku-css/ast";
export { lazyValues } from "../ast/helpers.js";

export const cssWideKeywords = [
    'unset',
    'initial',
    'inherit',
    'revert',
    'revert-layer'
];

/** css-tree's `parse`, which returns the tree, its children in `List`s. */
export function parse(source, options) {
    return fromPlainObject(parseCss(source, options).ast);
}
