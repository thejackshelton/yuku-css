// Copies real CSS from the Markless repository into test/corpus: every `<style>` block of its
// `.tsrx` files, each opening on its own line, and every `.css` file, as committed at HEAD.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const repository = process.argv[2] ?? new URL("../../markless", import.meta.url).pathname;
const corpus = new URL("corpus/", import.meta.url);

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

rmSync(corpus, { recursive: true, force: true });
mkdirSync(corpus);

const name = (path: string) => path.replaceAll("/", "__");
let count = 0;
for (const path of git("ls-tree", "-r", "--name-only", "HEAD").split("\n")) {
  if (path.includes("node_modules/")) continue;
  if (path.endsWith(".css")) {
    writeFileSync(new URL(name(path), corpus), git("show", `HEAD:${path}`));
    count++;
  } else if (path.endsWith(".tsrx")) {
    const source = git("show", `HEAD:${path}`);
    let index = 0;
    for (const match of source.matchAll(/^[ \t]*<style\b[^>]*>([\s\S]*?)<\/style>/gm)) {
      writeFileSync(new URL(`${name(path)}.${index++}.css`, corpus), match[1]!);
      count++;
    }
  }
}
console.log(`${count} files in test/corpus`);
