// css-tree's lib/__tests/helpers/index.js and fixture/ast.js, as the ported tests use them
import { astFiles } from "../csstree.ts";

export const tests = Object.create(null);
for (const file of astFiles) {
  tests[file.path] = { scope: file.scope, tests: Object.fromEntries(file.tests.map((test) => [test.name, test])), errors: {} };
}

export function forEachTest(factory) {
  for (const filename in tests) {
    const file = tests[filename];
    for (const key of Object.keys(file.tests)) factory(file.tests[key].name, file.tests[key], file.scope);
  }
}

export function lazyValues(dict) {
  const result = Object.create(null);
  for (const [key, compute] of Object.entries(dict)) {
    Object.defineProperty(result, key, {
      configurable: true,
      get() {
        const value = compute.call(result);
        Object.defineProperty(result, key, { value });
        return value;
      },
    });
  }
  return result;
}
