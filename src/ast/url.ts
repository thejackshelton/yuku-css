import {
  CHAR_BACKSLASH,
  CHAR_CLOSE_PAREN,
  CHAR_DOUBLE_QUOTE,
  CHAR_OPEN_PAREN,
  CHAR_SINGLE_QUOTE,
  CHAR_SPACE,
  isHexDigit,
  isWhiteSpace,
} from "../chars";
import { unescape } from "./escape";

/** A `url()` token's value: `url(`, `)`, and the spaces inside them removed, its escapes decoded. */
export function decode(str: string): string {
  let start = 4;
  let end = str.charCodeAt(str.length - 1) === CHAR_CLOSE_PAREN ? str.length - 2 : str.length - 1;
  while (start < end && isWhiteSpace(str.charCodeAt(start))) start++;
  while (start < end && isWhiteSpace(str.charCodeAt(end))) end--;
  return unescape(str, start, end);
}

/** Serializes a URL as an unquoted `url()`. */
export function encode(str: string): string {
  let encoded = "";
  let from = 0;
  let hexEscaped = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      encoded += str.slice(from, i) + "�";
      from = i + 1;
      continue;
    }
    if (code <= 0x1f || code === 0x7f) {
      encoded += str.slice(from, i) + "\\" + code.toString(16);
      from = i + 1;
      hexEscaped = true;
      continue;
    }
    if (
      code === CHAR_SPACE ||
      code === CHAR_BACKSLASH ||
      code === CHAR_DOUBLE_QUOTE ||
      code === CHAR_SINGLE_QUOTE ||
      code === CHAR_OPEN_PAREN ||
      code === CHAR_CLOSE_PAREN
    ) {
      encoded += str.slice(from, i) + "\\";
      from = i;
    } else if (hexEscaped && isHexDigit(code)) {
      encoded += str.slice(from, i) + " ";
      from = i;
    }
    hexEscaped = false;
  }
  return "url(" + (encoded === "" ? str : encoded + str.slice(from)) + ")";
}
