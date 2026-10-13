import type { AnyNode } from "../ast/node";

const FIELDS = 5;
const NO_SOURCE = -1;
const CHAR_COMMA = 0x2c;
const CHAR_SEMICOLON = 0x3b;

const VLQ_DIGITS = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/");

/** A source map, version 3, as css-tree's `SourceMapGenerator` serializes it. */
export interface SourceMapJSON {
  version: 3;
  sources: string[];
  names: string[];
  mappings: string;
  sourcesContent?: (string | null)[];
}

/** The map of `generate(ast, { sourceMap: true })`. */
export class SourceMap {
  /** @internal */
  _mappings: Mappings;
  /** @internal */
  _contents: Map<string, string> | null = null;

  constructor(mappings: Mappings) {
    this._mappings = mappings;
  }

  /** Embeds `content` as the text of `source` in `sourcesContent`. */
  setSourceContent(source: string, content: string | null): void {
    if (content === null) this._contents?.delete(source);
    else (this._contents ??= new Map()).set(source, content);
  }

  toJSON(): SourceMapJSON {
    const sources = this._mappings.sources.slice();
    const map: SourceMapJSON = { version: 3, sources, names: [], mappings: this._mappings.encode() };
    const contents = this._contents;
    if (contents !== null && contents.size > 0) map.sourcesContent = sources.map((source) => contents.get(source) ?? null);
    return map;
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}

// each mapping: generated line and column, source index or NO_SOURCE, original line and column
export class Mappings {
  data: Int32Array = new Int32Array(256 * FIELDS);
  length = 0;
  sources: string[] = [];
  sourceIndex: Map<string, number> = new Map();
  sorted = true;
  last = -1;

  add(line: number, column: number, source: string | null, originalLine: number, originalColumn: number): void {
    let index = NO_SOURCE;
    if (source !== null) {
      const known = this.sourceIndex.get(source);
      if (known === undefined) {
        index = this.sources.length;
        this.sources.push(source);
        this.sourceIndex.set(source, index);
      } else {
        index = known;
      }
    }
    if (this.length + FIELDS > this.data.length) {
      const data = new Int32Array(this.data.length * 2);
      data.set(this.data);
      this.data = data;
    }
    const at = this.length;
    const data = this.data;
    data[at] = line;
    data[at + 1] = column;
    data[at + 2] = index;
    data[at + 3] = originalLine;
    data[at + 4] = originalColumn;
    this.length = at + FIELDS;
    const last = this.last;
    if (last === -1 || line > data[last]! || (line === data[last]! && column >= data[last + 1]!) || this.compare(last, at) <= 0) this.last = at;
    else this.sorted = false;
  }

  // source-map-js's compareByGeneratedPositionsInflated
  compare(a: number, b: number): number {
    const data = this.data;
    let cmp = data[a]! - data[b]!;
    if (cmp !== 0) return cmp;
    cmp = data[a + 1]! - data[b + 1]!;
    if (cmp !== 0) return cmp;
    const sourceA = data[a + 2]!;
    const sourceB = data[b + 2]!;
    if (sourceA !== sourceB) {
      if (sourceA === NO_SOURCE) return 1;
      if (sourceB === NO_SOURCE) return -1;
      return this.sources[sourceA]! > this.sources[sourceB]! ? 1 : -1;
    }
    cmp = data[a + 3]! - data[b + 3]!;
    if (cmp !== 0) return cmp;
    return data[a + 4]! - data[b + 4]!;
  }

  encode(): string {
    const order = new Int32Array(this.length / FIELDS);
    for (let i = 0; i < order.length; i++) order[i] = i * FIELDS;
    if (!this.sorted) order.sort((a, b) => this.compare(a, b));
    const data = this.data;
    const writer = new VlqWriter(order.length);
    let line = 1;
    let column = 0;
    let source = 0;
    let originalLine = 0;
    let originalColumn = 0;
    for (let i = 0; i < order.length; i++) {
      const at = order[i]!;
      const mappingLine = data[at]!;
      if (mappingLine !== line) {
        writer.repeat(CHAR_SEMICOLON, mappingLine - line);
        line = mappingLine;
        column = 0;
      } else if (i > 0) {
        if (this.compare(at, order[i - 1]!) === 0) continue;
        writer.byte(CHAR_COMMA);
      }
      writer.vlq(data[at + 1]! - column);
      column = data[at + 1]!;
      const index = data[at + 2]!;
      if (index === NO_SOURCE) continue;
      writer.vlq(index - source);
      source = index;
      writer.vlq(data[at + 3]! - 1 - originalLine);
      originalLine = data[at + 3]! - 1;
      writer.vlq(data[at + 4]! - originalColumn);
      originalColumn = data[at + 4]!;
    }
    return writer.finish();
  }
}

class VlqWriter {
  bytes: Uint8Array;
  length = 0;

  constructor(segments: number) {
    this.bytes = new Uint8Array(Math.max(segments * 8, 256));
  }

  reserve(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.bytes.length) return;
    const bytes = new Uint8Array(Math.max(needed, this.bytes.length * 2));
    bytes.set(this.bytes.subarray(0, this.length));
    this.bytes = bytes;
  }

  byte(code: number): void {
    this.reserve(1);
    this.bytes[this.length++] = code;
  }

  repeat(code: number, count: number): void {
    this.reserve(count);
    this.bytes.fill(code, this.length, this.length + count);
    this.length += count;
  }

  vlq(value: number): void {
    this.reserve(7);
    const bytes = this.bytes;
    let bits = value < 0 ? (-value << 1) | 1 : value << 1;
    let at = this.length;
    do {
      const digit = bits & 0x1f;
      bits >>>= 5;
      bytes[at++] = VLQ_DIGITS[bits === 0 ? digit : digit | 0x20]!;
    } while (bits !== 0);
    this.length = at;
  }

  finish(): string {
    return new TextDecoder("latin1").decode(this.bytes.subarray(0, this.length));
  }
}

// css-tree's generator/sourceMap.js: maps where each Atrule, Selector, and Declaration starts, and,
// sourceless, where the last of them ended
export class Tracker {
  readonly mappings: Mappings = new Mappings();
  length = 0;
  line = 1;
  lineStart = 0;
  originalLine = 0;
  originalColumn = 0;
  active = false;
  activeLine = 1;
  activeColumn = 0;

  emitted(s: string): void {
    let i = s.indexOf("\n");
    while (i !== -1) {
      this.line++;
      this.lineStart = this.length + i + 1;
      i = s.indexOf("\n", i + 1);
    }
    this.length += s.length;
  }

  enter(node: AnyNode): boolean {
    const type = node.type;
    if (type !== "Atrule" && type !== "Selector" && type !== "Declaration") return false;
    const start = node.loc?.start;
    if (!start) return true;
    const originalLine = start.line;
    const originalColumn = start.column - 1;
    if (this.originalLine === originalLine && this.originalColumn === originalColumn) return true;
    this.originalLine = originalLine;
    this.originalColumn = originalColumn;
    const line = this.line;
    const column = this.length - this.lineStart;
    if (this.active && (line !== this.activeLine || column !== this.activeColumn)) {
      this.mappings.add(this.activeLine, this.activeColumn, null, 0, 0);
    }
    this.active = true;
    const source = node.loc.source;
    if (!(originalLine > 0 && originalColumn >= 0 && source)) {
      throw new Error("Invalid mapping: " + JSON.stringify({ generated: { line, column }, source, original: { line: originalLine, column: originalColumn }, name: null }));
    }
    this.mappings.add(line, column, String(source), originalLine, originalColumn);
    return true;
  }

  leave(tracked: boolean): void {
    if (!tracked || !this.active) return;
    this.activeLine = this.line;
    this.activeColumn = this.length - this.lineStart;
  }

  finish(): SourceMap {
    if (this.active) this.mappings.add(this.activeLine, this.activeColumn, null, 0, 0);
    return new SourceMap(this.mappings);
  }
}
