// css-tree's own test material, from test/csstree (`bun run sync`): its lib/__tests/fixture/ast.js
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

export const FIXTURES: string = new URL("csstree/fixtures/", import.meta.url).pathname;
if (!existsSync(FIXTURES)) throw new Error("css-tree's fixtures are missing; run `bun run sync`");

export interface AstTest {
  name: string;
  source: string;
  generate?: string;
  ast: any;
  options: Record<string, any>;
  skip?: boolean;
}

export interface AstFile {
  path: string;
  scope: string;
  dir: string;
  tests: AstTest[];
}

const wrapper: Record<string, (ast: any) => any> = {
  stylesheet: (ast) => ({ type: "StyleSheet", children: [ast] }),
  mediaQuery: (ast) => ({ type: "MediaQuery", modifier: null, mediaType: null, condition: ast }),
  rule: (ast) => ({ type: "Rule", prelude: { type: "SelectorList", children: [] }, block: ast }),
  selector: (ast) => ({ type: "Selector", children: [ast] }),
  value: (ast) => ({ type: "Value", children: [ast] }),
};

export const astFiles: AstFile[] = [];
const root = join(FIXTURES, "ast");
for (const scope of readdirSync(root).sort()) read(join(root, scope), scope);

function read(path: string, scope: string): void {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) read(join(path, name), scope);
    return;
  }
  if (extname(path) !== ".json") return;
  const tests: AstTest[] = [];
  const file = JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
  const name = path.slice(root.length + 1);
  for (const [key, value] of Object.entries(file)) {
    const entries: any[] = Array.isArray(value) ? value : [value];
    entries.forEach((test, index) => {
      if (test.error) return;
      test.name = Array.isArray(value) ? `${name} ${key}#${index + 1}` : `${name} ${key}`;
      test.options = { ...test.options, context: scope };
      if (test.ast.type.toLowerCase() !== scope.toLowerCase() && Object.hasOwn(wrapper, scope)) test.ast = wrapper[scope]!(test.ast);
      tests.push(test);
    });
  }
  astFiles.push({ path, scope, dir: basename(dirname(path)), tests });
}

export const astTests: AstTest[] = astFiles.flatMap((file) => file.tests);
