export const CHAR_TAB = 0x09;
export const CHAR_LF = 0x0a;
export const CHAR_FF = 0x0c;
export const CHAR_CR = 0x0d;
export const CHAR_SPACE = 0x20;
export const CHAR_BANG = 0x21;
export const CHAR_DOUBLE_QUOTE = 0x22;
export const CHAR_HASH = 0x23;
export const CHAR_PERCENT = 0x25;
export const CHAR_SINGLE_QUOTE = 0x27;
export const CHAR_OPEN_PAREN = 0x28;
export const CHAR_CLOSE_PAREN = 0x29;
export const CHAR_STAR = 0x2a;
export const CHAR_PLUS = 0x2b;
export const CHAR_COMMA = 0x2c;
export const CHAR_MINUS = 0x2d;
export const CHAR_DOT = 0x2e;
export const CHAR_SLASH = 0x2f;
export const CHAR_COLON = 0x3a;
export const CHAR_SEMICOLON = 0x3b;
export const CHAR_LT = 0x3c;
export const CHAR_GT = 0x3e;
export const CHAR_AT = 0x40;
export const CHAR_OPEN_BRACKET = 0x5b;
export const CHAR_BACKSLASH = 0x5c;
export const CHAR_CLOSE_BRACKET = 0x5d;
export const CHAR_OPEN_BRACE = 0x7b;
export const CHAR_CLOSE_BRACE = 0x7d;

// css-tree's char categories: an ASCII code is its own category unless one of these
export const CAT_EOF = 0x80;
export const CAT_WHITESPACE = 0x82;
export const CAT_DIGIT = 0x83;
export const CAT_NAME_START = 0x84;
export const CAT_NON_PRINTABLE = 0x85;

const NAME = 1;
const NAME_START = 2;
const HEX = 4;
const WHITESPACE = 8;

const FLAGS = new Uint8Array(128);
const CATEGORY = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  const letter = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
  const digit = c >= 0x30 && c <= 0x39;
  const nameStart = letter || c === 0x5f;
  const whitespace = c === CHAR_LF || c === CHAR_CR || c === CHAR_FF || c === CHAR_SPACE || c === CHAR_TAB;
  const hex = digit || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66);
  FLAGS[c] = (nameStart || digit || c === CHAR_MINUS ? NAME : 0) | (nameStart ? NAME_START : 0) | (hex ? HEX : 0) | (whitespace ? WHITESPACE : 0);
  const nonPrintable = c <= 0x08 || c === 0x0b || (c >= 0x0e && c <= 0x1f) || c === 0x7f;
  CATEGORY[c] = whitespace ? CAT_WHITESPACE : digit ? CAT_DIGIT : nameStart ? CAT_NAME_START : nonPrintable ? CAT_NON_PRINTABLE : c || CAT_EOF;
}

export function category(code: number): number {
  return code < 0x80 ? CATEGORY[code]! : CAT_NAME_START;
}

export function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

export function isHexDigit(code: number): boolean {
  return code < 0x80 && (FLAGS[code]! & HEX) !== 0;
}

export function isNameStart(code: number): boolean {
  return code >= 0x80 ? true : (FLAGS[code]! & NAME_START) !== 0;
}

export function isName(code: number): boolean {
  return code >= 0x80 ? true : (FLAGS[code]! & NAME) !== 0;
}

export function isNewline(code: number): boolean {
  return code === CHAR_LF || code === CHAR_CR || code === CHAR_FF;
}

export function isWhiteSpace(code: number): boolean {
  return code < 0x80 && (FLAGS[code]! & WHITESPACE) !== 0;
}

// `second` is 0 at the end of the source
export function isValidEscape(first: number, second: number): boolean {
  return first === CHAR_BACKSLASH && second !== 0 && !isNewline(second);
}

export function isIdentifierStart(first: number, second: number, third: number): boolean {
  if (first === CHAR_MINUS) return isNameStart(second) || second === CHAR_MINUS || isValidEscape(second, third);
  if (isNameStart(first)) return true;
  return first === CHAR_BACKSLASH && isValidEscape(first, second);
}

export function isNumberStart(first: number, second: number, third: number): boolean {
  if (first === CHAR_PLUS || first === CHAR_MINUS) return isDigit(second) || (second === CHAR_DOT && isDigit(third));
  if (first === CHAR_DOT) return isDigit(second);
  return isDigit(first);
}

export function charAt(source: string, offset: number): number {
  return offset < source.length ? source.charCodeAt(offset) : 0;
}

export function newlineLength(source: string, offset: number, code: number): number {
  return code === CHAR_CR && charAt(source, offset + 1) === CHAR_LF ? 2 : 1;
}

export function whiteSpaceEnd(source: string, offset: number): number {
  while (offset < source.length && isWhiteSpace(source.charCodeAt(offset))) offset++;
  return offset;
}

export function consumeEscaped(source: string, offset: number): number {
  offset += 2;
  if (isHexDigit(charAt(source, offset - 1))) {
    for (const max = Math.min(source.length, offset + 5); offset < max; offset++) {
      if (!isHexDigit(charAt(source, offset))) break;
    }
    const code = charAt(source, offset);
    if (isWhiteSpace(code)) offset += newlineLength(source, offset, code);
  }
  return offset;
}

export function consumeName(source: string, offset: number): number {
  for (; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    if (isName(code)) continue;
    if (isValidEscape(code, charAt(source, offset + 1))) {
      offset = consumeEscaped(source, offset) - 1;
      continue;
    }
    break;
  }
  return offset;
}

export function decodeEscaped(escaped: string): string {
  if (escaped.length === 1 && !isHexDigit(escaped.charCodeAt(0))) return escaped[0]!;
  let code = parseInt(escaped, 16);
  if (code === 0 || (code >= 0xd800 && code <= 0xdfff) || code > 0x10ffff) code = 0xfffd;
  return String.fromCodePoint(code);
}
