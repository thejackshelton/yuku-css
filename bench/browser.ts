// Runs the parse timings and the other tools' timings in headless Chromium, a fresh browser for
// each run and a fresh page for each configuration or tool.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { rolldown } from "rolldown";
import type { Mode } from "./adapters.ts";
import { WASM } from "./oxc.ts";
import type { Timing } from "./sample.ts";

interface Config {
  id: string;
  library: string;
  mode: Mode;
}

// localhost counts as a secure context, which cross-origin isolation needs; the page never reaches the network
const ORIGIN = "http://localhost:9/";
// cross-origin isolation sharpens performance.now() from 100 µs to 5 µs
const HEADERS = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
// Node.js only, and never loaded in the page
const NODE_ONLY = [/^node:/, "lightningcss", "esbuild", "@swc/css", "oxfmt", "clean-css", "prettier", "@biomejs/js-api/nodejs", "@biomejs/wasm-nodejs"];

export async function browser(
  configs: Config[],
  files: (config: string) => { key: string; source: string }[],
  tools: { name: string; files: { key: string; source: string }[] }[],
  runs: number,
  budget: number,
): Promise<{ version: string; results: Record<string, Record<string, Timing[]>>; compete: Record<string, Record<string, Timing[]>> }> {
  const build = await rolldown({ input: new URL("page.ts", import.meta.url).pathname, platform: "browser", external: NODE_ONLY, logLevel: "silent" });
  const script = (await build.generate({ format: "esm", codeSplitting: false })).output[0].code;
  const resolve = createRequire(import.meta.url).resolve;
  const wasm: Record<string, Buffer> = Object.fromEntries(
    [
      resolve("lightningcss-wasm/lightningcss_node.wasm"),
      resolve("esbuild-wasm/esbuild.wasm"),
      resolve("@biomejs/wasm-web/biome_wasm_bg.wasm"),
      WASM,
    ].map((path) => [path.slice(path.lastIndexOf("/") + 1), readFileSync(path)]),
  );
  const results: Record<string, Record<string, Timing[]>> = {};
  const compete: Record<string, Record<string, Timing[]>> = {};
  let version = "";
  for (let run = 0; run < runs; run++) {
    const instance = await chromium.launch();
    version = instance.version();
    // a page per configuration, so no library starts with state another configuration left
    const page = async <T>(call: (page: import("playwright").Page) => Promise<T>): Promise<T> => {
      const page = await instance.newPage();
      await page.route(`${ORIGIN}**`, (route) => {
        const url = route.request().url();
        const asset = wasm[url.slice(url.lastIndexOf("/") + 1)];
        return route.fulfill(
          url === ORIGIN
            ? { contentType: "text/html", headers: HEADERS, body: '<!doctype html><script type="module" src="page.js"></script>' }
            : asset
              ? { contentType: "application/wasm", headers: HEADERS, body: asset }
              : { contentType: "text/javascript", headers: HEADERS, body: script },
        );
      });
      await page.goto(ORIGIN);
      await page.waitForFunction(() => "bench" in globalThis);
      if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("the page is not cross-origin isolated");
      const result = await call(page);
      await page.close();
      return result;
    };
    for (const config of configs) {
      const keyed = files(config.id);
      const timings: Timing[] = await page((page) =>
        page.evaluate(
          ([library, mode, sources, budget]) => (globalThis as any).bench(library, mode, sources, budget),
          [config.library, config.mode, keyed.map((file) => file.source), budget] as const,
        ),
      );
      keyed.forEach(({ key }, i) => ((results[config.id] ??= {})[key] ??= []).push(timings[i]!));
    }
    for (const tool of tools) {
      const timings: Timing[] = await page((page) =>
        page.evaluate(
          ([name, sources, budget]) => (globalThis as any).compete(name, sources, budget),
          [tool.name, tool.files.map((file) => file.source), budget] as const,
        ),
      );
      tool.files.forEach(({ key }, i) => ((compete[tool.name] ??= {})[key] ??= []).push(timings[i]!));
    }
    await instance.close();
  }
  return { version, results, compete };
}
