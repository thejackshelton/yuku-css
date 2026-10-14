// Builds oxc-css-parser, pinned in bench/oxc/Cargo.toml, as WebAssembly for the adapter and natively
// for the native comparison, and yuku-css's tools/native_bench.zig beside it. Needs cargo,
// wasm-pack, rustup's wasm32 target and zig. `node bench/oxc.ts` builds them.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const OXC = new URL("oxc/", import.meta.url).pathname;
const ROOT = new URL("../", import.meta.url).pathname;
export const BINARIES: { oxc: string; yuku: string } = {
  oxc: `${OXC}target/release/oxc-css-parser-bench-native`,
  yuku: `${ROOT}zig-out/bin/yuku-css-native-bench`,
};
export const OXC_REVISION: string = /rev = "([0-9a-f]+)"/.exec(readFileSync(`${OXC}Cargo.toml`, "utf8"))![1]!;
export const WASM: string = `${OXC}pkg/oxc_css_parser_bench_wasm_bg.wasm`;

export function build(): void {
  // rustup's cargo reads bench/oxc/rust-toolchain.toml, which a Homebrew cargo earlier in PATH would not
  const env = { ...process.env, PATH: `${homedir()}/.cargo/bin:${process.env.PATH}` };
  const run = (command: string, args: string[], cwd: string) => execFileSync(command, args, { cwd, env, stdio: ["ignore", "ignore", "inherit"] });
  run("wasm-pack", ["build", "--release", "--target", "web", "--out-dir", "../pkg", "--no-typescript", "--no-pack"], `${OXC}wasm`);
  run("cargo", ["build", "--release", "-p", "oxc-css-parser-bench-native"], OXC);
  run(
    "zig",
    ["build-exe", "-OReleaseFast", "--dep", "yuku-css", "-Mroot=tools/native_bench.zig", "-Myuku-css=src/root.zig", "--name", "yuku-css-native-bench", "-femit-bin=zig-out/bin/yuku-css-native-bench", "--cache-dir", ".zig-cache"],
    ROOT,
  );
  for (const file of [WASM, ...Object.values(BINARIES)]) if (!existsSync(file)) throw new Error(`${file} was not built`);
}

if (import.meta.main) build();
