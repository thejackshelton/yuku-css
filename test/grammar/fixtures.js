// css-tree's lib/__tests/fixture/definition-syntax.js and definition-syntax-match.js, over
// test/suite (`bun run sync`); a test's name is its file and key, where css-tree adds a position
import { readdirSync, readFileSync } from "node:fs";
import { createLexer, lexer as defaultLexer } from "yuku-css/lexer";

const SUITE = new URL("../suite/", import.meta.url);
const read = (dir) =>
  readdirSync(new URL(dir, SUITE))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => [`${dir}${name}`, JSON.parse(readFileSync(new URL(`${dir}${name}`, SUITE), "utf8"))]);

export const tests = Object.create(null);
let atrules = null;
for (const [file, content] of read("definition-syntax/")) {
  for (const [key, test] of Object.entries(content)) test.name = `${file} ${key}`;
  if (file.endsWith("/atrules.json")) {
    atrules = content;
    continue;
  }
  for (const [key, test] of Object.entries(content)) {
    if (!test.syntax && !test.property && !test.type) test.syntax = key;
  }
  tests[file] = content;
}
export const atruleTests = atrules;

export function forEachTest(factory) {
  for (const file of Object.values(tests)) {
    for (const test of Object.values(file)) {
      const syntax = test.syntax;
      const lexer = test.lexer ? createLexer(test.lexer) : defaultLexer;
      for (const field of ["valid", "invalid"]) {
        (test[field] ?? []).forEach((value, idx) => {
          factory(field, test.test, `${test.name} ${field}#${idx}`, lexer, test.property, value,
            typeof syntax === "string" ? syntax : undefined);
        });
      }
    }
  }
}

export function forEachAtrulePreludeTest(factory) {
  for (const [atruleName, testset] of Object.entries(atruleTests)) {
    if (!testset.prelude) continue;
    for (const field of ["valid", "invalid"]) {
      (testset.prelude[field] ?? []).forEach((value, idx) => {
        factory(field, testset.test, `${testset.name} @${atruleName} prelude ${field}#${idx}`, defaultLexer,
          atruleName, value);
      });
    }
  }
}

export function forEachAtruleDescriptorTest(factory) {
  for (const [atruleName, testset] of Object.entries(atruleTests)) {
    for (const [descriptorName, test] of Object.entries(testset.descriptors ?? {})) {
      for (const field of ["valid", "invalid"]) {
        (test[field] ?? []).forEach((value, idx) => {
          factory(field, testset.test,
            `${testset.name} @${atruleName} descriptor ${descriptorName} ${field}#${idx}`, defaultLexer,
            atruleName, descriptorName, value);
        });
      }
    }
  }
}

export const matchTests = Object.fromEntries(
  read("definition-syntax-match/").map(([file, content]) => {
    for (const [key, test] of Object.entries(content)) test.name = `${file} ${key}`;
    return [file, content];
  }),
);

export function forEachMatchTest(factory) {
  for (const file of Object.values(matchTests)) {
    for (const [key, test] of Object.entries(file)) factory(key, test);
  }
}
