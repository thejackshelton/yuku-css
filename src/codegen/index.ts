import { CHAR_BACKSLASH } from "../chars";
import { Output, SAFE, SPEC, codeToKind, kindOf, kindToCode, lookupKind } from "./output";
import type { Node } from "../ast/node";
import { print, type Printer } from "./printer";
import { DELIM, WHITESPACE, bomLength, scan, tokenType } from "./scan";
import { type SourceMap, Tracker } from "./sourcemap";

export type { Node, Printer };
export type { AnyNode } from "../ast/node";
export type { SourceMap, SourceMapJSON } from "./sourcemap";

/** css-tree's generator handlers, which a `decorator` wraps or replaces. */
export interface Handlers {
  node(node: Node): void;
  /** Packs the token as css-tree's token-before.js does, its lowest bit set when it needs a space before it. */
  tokenBefore(prevCode: number, type: number, value: string): number;
  token(type: number, value: string, suppressAutoWhiteSpace?: boolean): void;
  emit(value: string, type: number, auto: boolean): void;
  result(): any;
}

export interface GenerateOptions {
  /** Return `{ css, map }`, mapping where each `Atrule`, `Selector`, and `Declaration` with a `loc` starts. */
  sourceMap?: boolean;
  /** Wraps or replaces css-tree's generator handlers. */
  decorator?: (handlers: Handlers) => Handlers;
  /**
   * Where spaces go between tokens. `"spec"` adds only those the CSS Syntax needs for the text to
   * read back the same; `"safe"` adds a few more, where old browsers misread the pair.
   * @default "safe"
   */
  mode?: "safe" | "spec";
}

export interface GenerateResult {
  css: string;
  map: SourceMap;
}

/** Prints css-tree's tree, or any node of it, back to CSS, byte for byte as css-tree's `generate`. */
export function generate(node: Node, options: GenerateOptions & { sourceMap: true }): GenerateResult;
export function generate(node: Node, options?: GenerateOptions): string;
export function generate(node: Node, options?: GenerateOptions): string | GenerateResult {
  const spaced = options?.mode === "spec" ? SPEC : SAFE;
  if (typeof options?.decorator === "function") return decorated(node, options, spaced) as string;
  const map = options?.sourceMap ? new Tracker() : null;
  const output = new Output(spaced, map);
  output.node(node);
  return map === null ? output.css : { css: output.css, map: map.finish() };
}

function tokenBefore(spaced: Uint8Array): Handlers["tokenBefore"] {
  return (prevCode, type, value) => {
    const kind = kindOf(type, value);
    return kindToCode(kind) | spaced[codeToKind(prevCode) * 161 + lookupKind(type, value, kind)]!;
  };
}

// css-tree's generator, handler for handler, for a decorator to wrap
function decorated(root: Node, options: GenerateOptions, spaced: Uint8Array): unknown {
  let buffer = "";
  let prevCode = 0;
  const api: Printer = {
    node: (node) => handlers.node(node),
    token: (type, value) => handlers.token(type, value),
    tokenize(raw) {
      if (typeof raw !== "string") raw = String(raw || "");
      for (let start = bomLength(raw); start < raw.length; ) {
        const end = scan(raw, start);
        handlers.token(tokenType, raw.slice(start, end), start !== 0);
        start = end;
      }
    },
  };
  let handlers: Handlers = {
    node(node) {
      print(api, node);
    },
    tokenBefore: tokenBefore(SAFE),
    token(type, value, suppressAutoWhiteSpace) {
      prevCode = this.tokenBefore(prevCode, type, value);
      if (!suppressAutoWhiteSpace && prevCode & 1) this.emit(" ", WHITESPACE, true);
      this.emit(value, type, false);
      if (type === DELIM && value.charCodeAt(0) === CHAR_BACKSLASH) this.emit("\n", WHITESPACE, true);
    },
    emit(value) {
      buffer += value;
    },
    result() {
      return buffer;
    },
  };
  handlers = options.decorator!(handlers);
  if (options.sourceMap) handlers = mapped(handlers);
  if (options.mode === "spec" || options.mode === "safe") handlers.tokenBefore = tokenBefore(spaced);
  handlers.node(root);
  return handlers.result();
}

function mapped(handlers: Handlers): Handlers {
  const tracker = new Tracker();
  const { node, emit, result } = handlers;
  handlers.node = function (this: Handlers, child) {
    const tracked = tracker.enter(child);
    node.call(this, child);
    tracker.leave(tracked);
  };
  handlers.emit = (value, type, auto) => {
    tracker.emitted(value);
    emit(value, type, auto);
  };
  handlers.result = () => ({ css: result(), map: tracker.finish() });
  return handlers;
}
