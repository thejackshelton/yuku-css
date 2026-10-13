// ported from css-tree 3.2.1, lib/__tests/convert.js
import { afterEach, beforeEach, describe, it } from "bun:test";
import assert from "node:assert";
import { parse, generate } from 'css-tree';
import { fromPlainObject, toPlainObject } from 'yuku-css/ast';

const css = '.test{a:123}';

describe('convert', () => {
    it('fromPlainObject', () => {
        const ast = parse(css);
        const plainObject = JSON.parse(JSON.stringify(ast));
        const actual = generate(fromPlainObject(plainObject));

        assert.strictEqual(actual, css);
    });

    it('toPlainObject', () => {
        const ast = parse(css);
        const expected = JSON.parse(JSON.stringify(ast));
        const actual = toPlainObject(ast);

        assert.deepStrictEqual(actual, expected);
    });
});
