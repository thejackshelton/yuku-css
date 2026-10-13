// copies css-tree's test fixtures, at the version the tests compare against, into test/csstree
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VERSION = "v3.2.1";
const target = new URL("../test/csstree/", import.meta.url).pathname;

if (!existsSync(join(target, "fixtures")) || process.argv.includes("--force")) {
  const clone = mkdtempSync(join(tmpdir(), "csstree-"));
  const git = spawnSync("git", ["-c", "advice.detachedHead=false", "clone", "--quiet", "--depth", "1", "--branch", VERSION, "https://github.com/csstree/csstree", clone], { stdio: "inherit" });
  if (git.status !== 0) throw new Error("git clone of css-tree failed");
  rmSync(target, { recursive: true, force: true });
  cpSync(join(clone, "fixtures"), join(target, "fixtures"), { recursive: true });
  rmSync(clone, { recursive: true, force: true });
}
