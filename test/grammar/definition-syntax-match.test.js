// ported from css-tree 3.2.1, lib/__tests/definition-syntax-match.js: css-tree feeds the match graph
// a dictionary of generic types plus the fixture's own, which a lexer of the fixture's grammar is
import { describe, it } from "bun:test";
import assert from "node:assert";
import { tokenize } from "yuku-css";
import { createLexer, fork } from "yuku-css/lexer";
import { forEachMatchTest } from "./fixtures.js";
import { check } from "./pending.js";

function processMatchResult(mr) {
    if (Array.isArray(mr)) {
        const array = mr.map(processMatchResult);
        return array.length === 1 ? array[0] : array;
    }

    if (mr.token) {
        return mr.token;
    }

    if (mr.syntax && mr.match) {
        return {
            syntax: mr.syntax.type === 'Type'
                ? '<' + mr.syntax.name + '>'
                : mr.syntax.type === 'Property'
                    ? '<\'' + mr.syntax.name + '\'>'
                    : mr.syntax.name,
            match: processMatchResult(mr.match)
        };
    }
}

function tokensOf(match) {
    return 'match' in match ? match.match.flatMap(tokensOf) : [match.token];
}

function visible(input) {
    let start = 0;
    return Array.from(tokenize(input), (packed) => {
        const chunk = input.slice(start, packed & 0xffffff);
        start = packed & 0xffffff;
        return chunk;
    }).filter((s) => /\S/.test(s));
}

// css-tree's harness lets a fixture's type replace a generic one, where a lexer keeps the generic
// type, so such a type is renamed here
function overridingGenerics(syntax, types = {}) {
    const lexer = createLexer({ generic: true });
    const renamed = Object.keys(types).filter((name) => lexer.getType(name) !== null);
    const rename = (text) => renamed.reduce((out, name) => out.replaceAll(`<${name}>`, `<${name}-fixture>`), text);
    const entries = Object.entries(types).map(([name, value]) => [renamed.includes(name) ? `${name}-fixture` : name, rename(value)]);
    return { syntax: rename(syntax), types: Object.fromEntries(entries) };
}

function createSyntaxTest(testName, test) {
    describe(test.name, () => {
        const { syntax, types } = overridingGenerics(test.syntax || testName, test.types);
        let lexer;
        const lexerOf = () => lexer ??= test.defaultSyntaxes
            ? fork({ types, properties: test.properties }).lexer
            : createLexer({ generic: true, types, properties: test.properties });

        (test.valid ?? []).forEach((input, i) => {
            it(`should MATCH to "${input}"`, () => check(`${test.name} valid#${i}`, () => {
                const m = lexerOf().match(syntax, input);
                assert.notStrictEqual(m.matched, null, m.error?.message);
                assert.deepStrictEqual(tokensOf(m.matched), visible(input));
            }));
        });

        (test.invalid ?? []).forEach((input, i) => {
            it(`should NOT MATCH to "${input}"`, () => check(`${test.name} invalid#${i}`, () => {
                assert.strictEqual(lexerOf().match(syntax, input).matched, null);
            }));
        });

        for (const [input, matchResult] of Object.entries(test.matchResult ?? {})) {
            it(`match result for "${input}"`, () => check(`${test.name} matchResult ${input}`, () => {
                const m = lexerOf().match(syntax, input);
                assert.deepStrictEqual(processMatchResult(m.matched.match), matchResult);
            }));
        }
    });
}

describe('syntax matching', () => {
    forEachMatchTest(createSyntaxTest);

    it('should raise an error on broken type reference', () => {
        assert.throws(
            () => createLexer({}).match('<foo>', 'foo'),
            /Bad syntax reference: <foo>/
        );
    });

    it('should raise an error on broken property reference', () => {
        assert.throws(
            () => createLexer({}).match('<\'foo\'>', 'foo'),
            /Bad syntax reference: <\'foo\'>/
        );
    });
});
