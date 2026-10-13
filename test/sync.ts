import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SUITE = new URL("suite/", import.meta.url);
const FIXTURES = [
  "ast",
  "tokenize",
  "definition-syntax",
  "definition-syntax-match",
  "sourceMaps",
  "stringify.css",
  "stringify.ast",
];
const { version } = JSON.parse(
  readFileSync(new URL("../node_modules/css-tree/package.json", import.meta.url), "utf8"),
);

const repo = mkdtempSync(join(tmpdir(), "css-tree-"));
try {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git(
    ...["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth=1", "--filter=blob:none"],
    ...["--sparse", `--branch=v${version}`, "https://github.com/csstree/csstree.git", "."],
  );
  git("sparse-checkout", "set", "--no-cone", "/LICENSE", ...FIXTURES.map((name) => `/fixtures/${name}`));

  rmSync(SUITE, { recursive: true, force: true });
  for (const name of FIXTURES) cpSync(join(repo, "fixtures", name), new URL(name, SUITE).pathname, { recursive: true });
  cpSync(join(repo, "LICENSE"), new URL("LICENSE", SUITE).pathname);

  const files = readdirSync(SUITE, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  console.log(`css-tree@${version}: ${files.length - 1} fixture files`);
} finally {
  rmSync(repo, { recursive: true, force: true });
}
