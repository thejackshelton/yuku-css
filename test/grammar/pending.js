// a listed test must fail, so it leaves the list once yuku-css matches it
import { afterAll, beforeEach as beforeEachTest, describe as describeTest, expect, it as itTest } from "bun:test";
import { listed, reasonOf } from "../divergences";

export function check(id, run) {
    if (reasonOf(id) === undefined) run();
    else expect(run).toThrow();
}

/**
 * `describe`, `it` and `beforeEach` that give each test an id, `file > describe > ... > it`, and
 * check it; a listed id of the file that no test has fails the file.
 */
export function tracked(file) {
    const seen = new Set();
    let current = [file];
    afterAll(() => {
        expect(listed.filter((id) => id.startsWith(`${file} > `) && !seen.has(id))).toEqual([]);
    });
    return {
        describe(name, fn) {
            const path = [...current, name];
            describeTest(name, () => {
                const saved = current;
                current = path;
                try {
                    fn();
                } finally {
                    current = saved;
                }
            });
        },
        it(name, fn) {
            const id = [...current, name].join(" > ");
            seen.add(id);
            itTest(name, () => check(id, fn));
        },
        // a hook that fails leaves its values unset, which the listed tests then fail on
        beforeEach(fn) {
            beforeEachTest(() => {
                try {
                    fn();
                } catch {}
            });
        },
    };
}
