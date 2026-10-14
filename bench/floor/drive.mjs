// Ways of building the tree, each file in a fresh process per way, the processes interleaved,
// then per way the median over PROCS processes of each one's median, mean and GC share.
//   node bench/floor/drive.mjs <node|bun> <way,way,...> [files...]
// The files default to the large npm files of bench/corpus (NPM_CORPUS) and test/corpus joined.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [runtime, list, ...rest] = process.argv.slice(2);
const ways = list.split(",");
const PROCS = Number(process.env.PROCS ?? 3);
const NPM = process.env.NPM_CORPUS ?? new URL("../corpus/npm", import.meta.url).pathname;
const CORPUS = new URL("../../test/corpus/", import.meta.url).pathname;

function defaults() {
  const joined = join(tmpdir(), "test-corpus-joined.css");
  const names = readdirSync(CORPUS).filter((f) => f.endsWith(".css")).sort();
  writeFileSync(joined, names.map((f) => readFileSync(join(CORPUS, f), "utf8")).join("\n"));
  const npm = ["tailwind.css", "bootstrap.css", "bulma.css", "foundation.css", "primer.css"];
  return [...npm.map((f) => join(NPM, f)), joined];
}

const files = rest.length > 0 ? rest : defaults();
const run = new URL("run.mjs", import.meta.url).pathname;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const header = ["file", ...ways.flatMap((way) => [`${way} median`, "mean", "gc"])];
console.log(`| ${header.join(" | ")} |`);
console.log(`|${header.map((_, i) => (i === 0 ? "---" : "---:")).join("|")}|`);
for (const file of files) {
  const got = Object.fromEntries(ways.map((way) => [way, []]));
  for (let k = 0; k < PROCS; k++) {
    for (const way of ways) {
      const args = [run, way, file, ...(k === 0 ? ["--check"] : [])];
      const out = execFileSync(runtime, args, { encoding: "utf8" });
      got[way].push(JSON.parse(out.trim().split("\n").pop()));
    }
  }
  const cells = ways.flatMap((way) => {
    const r = got[way];
    const gc = r[0].gc === null ? "" : `${Math.round(median(r.map((x) => x.gc)) * 100)}%`;
    return [median(r.map((x) => x.ns)).toFixed(1), median(r.map((x) => x.mean)).toFixed(1), gc];
  });
  console.log(`| ${file.split("/").pop()} | ${cells.join(" | ")} |`);
}
