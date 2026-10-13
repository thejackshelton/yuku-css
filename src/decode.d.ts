import type { Contexts, Position, ParseResult } from "./ast";
import type { ParseOptions } from "./index";

export declare const tokenTypes: Readonly<Record<
  | "EOF" | "Ident" | "Function" | "AtKeyword" | "Hash" | "String" | "BadString" | "Url" | "BadUrl"
  | "Delim" | "Number" | "Percentage" | "Dimension" | "WhiteSpace" | "CDO" | "CDC" | "Colon"
  | "Semicolon" | "Comma" | "LeftSquareBracket" | "RightSquareBracket" | "LeftParenthesis"
  | "RightParenthesis" | "LeftCurlyBracket" | "RightCurlyBracket" | "Comment",
  number
>>;
export declare const tokenNames: readonly string[];
/** The at-rules whose prelude has a grammar of its own, by lowercased name. */
export declare const atrules: Readonly<Record<string, number>>;
/** `open` calls `build` with the buffer the tree is in, when `ast` is first read. */
export declare function decode(
  buffer: ArrayBuffer,
  at: number,
  source: string,
  options: ParseOptions,
  withTokens: boolean,
  open: <R>(build: (buffer: ArrayBuffer, at: number) => R) => R,
): ParseResult<Position, keyof Contexts>;
export declare function decodeTokens(buffer: ArrayBuffer, at: number, source: string): Uint32Array;
