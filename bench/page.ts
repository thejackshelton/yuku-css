// The browser's side of bench/browser.ts, bundled into the page.
import { COMPETITORS, LIBRARIES, type Mode } from "./adapters.ts";
import { measure, measureAsync } from "./sample.ts";

const encoder = new TextEncoder();

(globalThis as { bench?: unknown }).bench = async (library: string, mode: Mode, sources: string[], budget: number) => {
  const parse = await LIBRARIES.find(({ name }) => name === library)!.load(mode);
  // Chromium's clock ticks every 5 µs once the page is cross-origin isolated
  return measure(sources.map((source) => ({ bytes: encoder.encode(source).length, run: () => parse(source) })), budget, 0.5);
};

(globalThis as { compete?: unknown }).compete = async (name: string, sources: string[], budget: number) => {
  const tool = COMPETITORS.find((tool) => tool.name === name)!;
  const run = await tool.load("chromium");
  const runs = sources.map((source) => ({ bytes: encoder.encode(source).length, run: () => run(source) }));
  return tool.async?.includes("chromium") ? measureAsync(runs, budget, 0.5) : measure(runs, budget, 0.5);
};
