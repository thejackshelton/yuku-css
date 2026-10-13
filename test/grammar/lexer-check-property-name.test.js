// ported from css-tree 3.2.1, lib/__tests/lexer-check-property-name.js
import { beforeEach, describe, it } from "bun:test";
import assert from "node:assert";
import { lexer } from "yuku-css/lexer";

describe('Lexer#checkPropertyName()', () => {
    it('should pass correct property', () => {
        assert.strictEqual(lexer.checkPropertyName('color'), undefined);
    });

    it('should pass correct vendor property', () => {
        assert.strictEqual(lexer.checkPropertyName('-webkit-color'), undefined); // FIXME: should fail because never exists
        assert.strictEqual(lexer.checkPropertyName('-webkit-border-radius'), undefined);
    });

    it('should fail on invalid property', () => {
        const error = lexer.checkPropertyName('foo');
        assert.strictEqual(error.name, 'SyntaxReferenceError');
        assert.strictEqual(error.message, 'Unknown property `foo`');
    });
});
