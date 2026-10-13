// Runs the parse timings in headless Chromium, a fresh browser for each run and a fresh page for
// each configuration.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { rolldown } from "rolldown";
import type { Mode } from "./adapters.ts";
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

export async function browser(
  configs: Config[],
  files: (config: string) => { key: string; source: string }[],
  runs: number,
  budget: number,
): Promise<{ version: string; results: Record<string, Record<string, Timing[]>> }> {
  const build = await rolldown({
    input: new URL("page.ts", import.meta.url).pathname,
    platform: "browser",
    // Node.js only, and never loaded in the page
    external: ["lightningcss"],
    logLevel: "silent",
  });
  const script = (await build.generate({ format: "esm", codeSplitting: false })).output[0].code;
  const wasm = readFileSync(createRequire(import.meta.url).resolve("lightningcss-wasm/lightningcss_node.wasm"));
  const results: Record<string, Record<string, Timing[]>> = {};
  let version = "";
  for (let run = 0; run < runs; run++) {
    const instance = await chromium.launch();
    version = instance.version();
    // a page per configuration, so no library starts with state another configuration left
    for (const config of configs) {
      const page = await instance.newPage();
      await page.route(`${ORIGIN}**`, (route) =>
        route.fulfill(
          route.request().url() === ORIGIN
            ? { contentType: "text/html", headers: HEADERS, body: '<!doctype html><script type="module" src="page.js"></script>' }
            : route.request().url().endsWith(".wasm")
              ? { contentType: "application/wasm", headers: HEADERS, body: wasm }
              : { contentType: "text/javascript", headers: HEADERS, body: script },
        ),
      );
      await page.goto(ORIGIN);
      await page.waitForFunction(() => "bench" in globalThis);
      if (!(await page.evaluate(() => crossOriginIsolated))) throw new Error("the page is not cross-origin isolated");
      const keyed = files(config.id);
      const timings: Timing[] = await page.evaluate(
        ([library, mode, sources, budget]) => (globalThis as any).bench(library, mode, sources, budget),
        [config.library, config.mode, keyed.map((file) => file.source), budget] as const,
      );
      keyed.forEach(({ key }, i) => ((results[config.id] ??= {})[key] ??= []).push(timings[i]!));
      await page.close();
    }
    await instance.close();
  }
  return { version, results };
}
