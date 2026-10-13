// The browser's side of bench/browser.ts, bundled into the page.
import { LIBRARIES, type Mode } from "./adapters.ts";
import { measure } from "./sample.ts";

(globalThis as { bench?: unknown }).bench = async (library: string, mode: Mode, sources: string[], budget: number) => {
  const parse = await LIBRARIES.find(({ name }) => name === library)!.load(mode);
  const encoder = new TextEncoder();
  // Chromium's clock ticks every 5 µs once the page is cross-origin isolated
  return measure(sources.map((source) => ({ bytes: encoder.encode(source).length, run: () => parse(source) })), budget, 0.5);
};
