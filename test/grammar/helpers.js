// css-tree's lib/__tests/helpers/index.js, and its `parse`, as the ported lexer tests use them
import { parse as parseCss } from "yuku-css";
export { lazyValues } from "../ast/helpers.js";

export const cssWideKeywords = [
    'unset',
    'initial',
    'inherit',
    'revert',
    'revert-layer'
];

/** css-tree's `parse`, which returns the tree. */
export function parse(source, options) {
    return parseCss(source, options).ast;
}
