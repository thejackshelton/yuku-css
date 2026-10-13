// The in-depth suite's style sheets: test/corpus, real CSS from npm pinned by version and checked
// by hash, and generated stress files. `node bench/corpus.ts` downloads and generates what is missing.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

export { BUCKETS, bucket } from "./sample.ts";

export interface File {
  group: "markless" | "npm" | "synthetic" | "overhead";
  name: string;
  source: string;
  bytes: number;
}

const MARKLESS = new URL("../test/corpus/", import.meta.url);
const NPM = new URL("corpus/npm/", import.meta.url);
const SYNTHETIC = new URL("corpus/synthetic/", import.meta.url);
const OVERHEAD = new URL("corpus/overhead/", import.meta.url);

// jsDelivr serves each file as published to npm
export const PACKAGES: Record<string, { path: string; sha256: string }> = {
  "normalize.css": { path: "normalize.css@8.0.1/normalize.css", sha256: "580818700724d42d7fcc4979b0197971fca1c6d2e0286769237a0ac897df5512" },
  "preflight.css": { path: "tailwindcss@3.4.17/src/css/preflight.css", sha256: "1d85e5cc0262f68a4f1313c4754a61c7ff56da4cc24866e76bcde9d4e467feac" },
  "pure.css": { path: "purecss@3.0.0/build/pure.css", sha256: "61642839d5e0d04641fceb5a4dcfc479a6ea17510c57c489314c3a662dcc7c9b" },
  "github-markdown.css": { path: "github-markdown-css@5.6.1/github-markdown.css", sha256: "2387fb3ad1e38b35630322140862a4c6530392df72cecde43e1ea2ea0a70b9e4" },
  "animate.css": { path: "animate.css@4.1.1/animate.css", sha256: "c1b6f9ed1effff87233740ce612ed3cd3fbd3cb34c0863373d820fde1b2c8d8f" },
  "font-awesome.css": { path: "@fortawesome/fontawesome-free@6.6.0/css/all.css", sha256: "92597940bbf017fa3805f3761ad9e8faee5f537d48fb50d97ff96bef70586f64" },
  "foundation.css": { path: "foundation-sites@6.8.1/dist/css/foundation.css", sha256: "3ce1a81994ad9af9d6672993120851f3699a249217c747ce83de8da41426d77c" },
  "bootstrap.css": { path: "bootstrap@5.3.3/dist/css/bootstrap.css", sha256: "18a105d7cb38e01e5ed0ca255c092992a2e211b39594a7fa57262bfc6fc4ea9c" },
  "bootstrap.min.css": { path: "bootstrap@5.3.3/dist/css/bootstrap.min.css", sha256: "3c8f27e6009ccfd710a905e6dcf12d0ee3c6f2ac7da05b0572d3e0d12e736fc8" },
  "primer.css": { path: "@primer/css@21.5.1/dist/primer.css", sha256: "5ebf0fe11b7a06f5b6b0cb654fe864047f504c9753d34d7df682430455a4e360" },
  "bulma.css": { path: "bulma@1.0.2/css/bulma.css", sha256: "113149035b8b7543113ca93d6f8c75a7ff4a73a1c0877d5e50c710aa1fe5f404" },
  "tailwind.min.css": { path: "tailwindcss@2.2.19/dist/tailwind.min.css", sha256: "b6ad97402eddb903e7a5d7a73ee47a679204efbdda4521a391cbad9df509b932" },
  "tailwind.css": { path: "tailwindcss@2.2.19/dist/tailwind.css", sha256: "de305d923dde1f8559e7734bb1f01970af3a76efc844b94ca3c8488fea8da3f7" },
};

export const SYNTHETICS: Record<string, () => string> = {
  // 400 chains of 32 nested rules
  "deep-nesting.css": () => {
    const chain = (depth: number): string =>
      depth === 0 ? "color: red;" : `color: red; & > .n${depth}:hover { ${chain(depth - 1)} }`;
    return Array.from({ length: 400 }, (_, i) => `.root${i} { ${chain(32)} }\n`).join("");
  },
  // one rule with 20,000 complex selectors
  "long-selector-list.css": () =>
    Array.from({ length: 20_000 }, (_, i) => `.c${i} > a[href^="#s${i}"]:not(.x${i % 7}) ~ span::before`).join(",\n") +
    " { color: red }\n",
  // 20 custom properties of 50 KB each
  "huge-custom-properties.css": () => {
    const value = (i: number) => Array.from({ length: 2_500 }, (_, j) => `${(i * j) % 97}px`).join(" ").padEnd(50_000, " x");
    return `:root {\n${Array.from({ length: 20 }, (_, i) => `  --p${i}: ${value(i)};\n`).join("")}}\n`;
  },
  // 10,000 at-rules of five kinds
  "many-at-rules.css": () =>
    Array.from({ length: 2_000 }, (_, i) =>
      [
        `@media (min-width: ${i}px) and (prefers-color-scheme: dark) { .m${i} { color: red } }`,
        `@supports (display: grid) and (not (display: inline-grid)) { .s${i} { display: grid } }`,
        `@container card (min-width: ${i}px) { .c${i} { padding: ${i}px } }`,
        `@layer l${i % 50} { .l${i} { margin: 0 } }`,
        `@font-face { font-family: f${i}; src: url(f${i}.woff2) format("woff2") }`,
      ].join("\n"),
    ).join("\n") + "\n",
};

/** The files of `groups`, every group by default. */
// files so small that a parse costs what a call costs, timed apart from the rest
export const OVERHEADS: Record<string, string> = {
  "empty.css": "",
  "tiny.css": ".a { color: red }\n",
};

export function load(groups: ReadonlySet<File["group"]> = new Set(["markless", "npm", "synthetic", "overhead"])): File[] {
  const read = (group: File["group"], directory: URL, names: string[]): File[] =>
    names.map((name) => {
      const source = readFileSync(new URL(name, directory), "utf8");
      return { group, name, source, bytes: Buffer.byteLength(source) };
    });
  return [
    ...(groups.has("markless") ? read("markless", MARKLESS, readdirSync(MARKLESS).sort()) : []),
    ...(groups.has("npm") ? read("npm", NPM, Object.keys(PACKAGES)) : []),
    ...(groups.has("synthetic") ? read("synthetic", SYNTHETIC, Object.keys(SYNTHETICS)) : []),
    ...(groups.has("overhead") ? read("overhead", OVERHEAD, Object.keys(OVERHEADS)) : []),
  ];
}

export async function prepare(): Promise<void> {
  mkdirSync(NPM, { recursive: true });
  mkdirSync(SYNTHETIC, { recursive: true });
  mkdirSync(OVERHEAD, { recursive: true });
  for (const [name, { path, sha256 }] of Object.entries(PACKAGES)) {
    const file = new URL(name, NPM);
    if (!existsSync(file)) {
      const response = await fetch(`https://cdn.jsdelivr.net/npm/${path}`);
      if (!response.ok) throw new Error(`${path}: ${response.status}`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (hash !== sha256) throw new Error(`${name}: sha256 ${hash}, expected ${sha256}`);
  }
  for (const [name, generate] of Object.entries(SYNTHETICS)) writeFileSync(new URL(name, SYNTHETIC), generate());
  for (const [name, source] of Object.entries(OVERHEADS)) writeFileSync(new URL(name, OVERHEAD), source);
}

if (import.meta.main) await prepare();
