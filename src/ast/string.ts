import { CHAR_BACKSLASH, CHAR_DOUBLE_QUOTE, CHAR_SINGLE_QUOTE, isHexDigit, isWhiteSpace } from "../chars";
import { unescape } from "./escape";

/** A string token's value: its quotes removed and its escapes decoded. */
export function decode(str: string): string {
  const length = str.length;
  const quote = str.charCodeAt(0);
  const start = quote === CHAR_DOUBLE_QUOTE || quote === CHAR_SINGLE_QUOTE ? 1 : 0;
  const end = start === 1 && length > 1 && str.charCodeAt(length - 1) === quote ? length - 2 : length - 1;
  return unescape(str, start, end);
}

/** Serializes a string, in double quotes or with `apostrophe` in single, as CSSOM's "serialize a string" does. */
export function encode(str: string, apostrophe?: boolean): string {
  const quote = apostrophe ? "'" : '"';
  const quoteCode = apostrophe ? CHAR_SINGLE_QUOTE : CHAR_DOUBLE_QUOTE;
  let encoded = "";
  let from = 0;
  let hexEscaped = false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0) {
      encoded += str.slice(from, i) + "�";
    } else if (code <= 0x1f || code === 0x7f) {
      encoded += str.slice(from, i) + "\\" + code.toString(16);
      from = i + 1;
      hexEscaped = true;
      continue;
    } else if (code === quoteCode || code === CHAR_BACKSLASH) {
      encoded += str.slice(from, i) + "\\";
      from = i;
      hexEscaped = false;
      continue;
    } else {
      // a hex digit or space after a hex escape would read as part of it
      if (hexEscaped && (isHexDigit(code) || isWhiteSpace(code))) {
        encoded += str.slice(from, i) + " ";
        from = i;
      }
      hexEscaped = false;
      continue;
    }
    from = i + 1;
  }
  return quote + (encoded === "" ? str : encoded + str.slice(from)) + quote;
}
