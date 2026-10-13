import {
  CAT_DIGIT,
  CAT_NAME_START,
  CAT_NON_PRINTABLE,
  CAT_WHITESPACE,
  CHAR_AT,
  CHAR_BACKSLASH,
  CHAR_BANG,
  CHAR_CLOSE_BRACE,
  CHAR_CLOSE_BRACKET,
  CHAR_CLOSE_PAREN,
  CHAR_COLON,
  CHAR_COMMA,
  CHAR_DOT,
  CHAR_DOUBLE_QUOTE,
  CHAR_GT,
  CHAR_HASH,
  CHAR_LT,
  CHAR_MINUS,
  CHAR_OPEN_BRACE,
  CHAR_OPEN_BRACKET,
  CHAR_OPEN_PAREN,
  CHAR_PERCENT,
  CHAR_PLUS,
  CHAR_SEMICOLON,
  CHAR_SINGLE_QUOTE,
  CHAR_SLASH,
  CHAR_STAR,
  category,
  charAt,
  consumeEscaped,
  consumeName,
  isDigit,
  isIdentifierStart,
  isName,
  isNewline,
  isNumberStart,
  isValidEscape,
  newlineLength,
  whiteSpaceEnd,
} from "../chars";

export const IDENT = 1;
export const FUNCTION = 2;
export const AT_KEYWORD = 3;
export const HASH = 4;
export const STRING = 5;
export const BAD_STRING = 6;
export const URL = 7;
export const BAD_URL = 8;
export const DELIM = 9;
export const NUMBER = 10;
export const PERCENTAGE = 11;
export const DIMENSION = 12;
export const WHITESPACE = 13;
export const CDO = 14;
export const CDC = 15;
export const COLON = 16;
export const SEMICOLON = 17;
export const COMMA = 18;
export const LEFT_SQUARE_BRACKET = 19;
export const RIGHT_SQUARE_BRACKET = 20;
export const LEFT_PARENTHESIS = 21;
export const RIGHT_PARENTHESIS = 22;
export const LEFT_CURLY_BRACKET = 23;
export const RIGHT_CURLY_BRACKET = 24;
export const COMMENT = 25;

// the type of the token `scan` last read
export let tokenType = 0;

export function bomLength(source: string): number {
  const code = charAt(source, 0);
  return code === 0xfeff || code === 0xfffe ? 1 : 0;
}

// reads the token at `offset`, as css-tree's tokenizer does, and returns where it ends
export function scan(source: string, offset: number): number {
  const code = source.charCodeAt(offset);
  switch (category(code)) {
    case CAT_WHITESPACE:
      tokenType = WHITESPACE;
      return whiteSpaceEnd(source, offset + 1);
    case CHAR_DOUBLE_QUOTE:
    case CHAR_SINGLE_QUOTE:
      return scanString(source, offset + 1, code);
    case CHAR_HASH: {
      const next = charAt(source, offset + 1);
      if (isName(next) || isValidEscape(next, charAt(source, offset + 2))) {
        tokenType = HASH;
        return consumeName(source, offset + 1);
      }
      return delim(offset);
    }
    case CHAR_OPEN_PAREN:
      tokenType = LEFT_PARENTHESIS;
      return offset + 1;
    case CHAR_CLOSE_PAREN:
      tokenType = RIGHT_PARENTHESIS;
      return offset + 1;
    case CHAR_PLUS:
    case CHAR_DOT:
      if (isNumberStart(code, charAt(source, offset + 1), charAt(source, offset + 2))) return scanNumeric(source, offset);
      return delim(offset);
    case CHAR_COMMA:
      tokenType = COMMA;
      return offset + 1;
    case CHAR_MINUS: {
      const next = charAt(source, offset + 1);
      const after = charAt(source, offset + 2);
      if (isNumberStart(code, next, after)) return scanNumeric(source, offset);
      if (next === CHAR_MINUS && after === CHAR_GT) {
        tokenType = CDC;
        return offset + 3;
      }
      if (isIdentifierStart(code, next, after)) return scanIdentLike(source, offset);
      return delim(offset);
    }
    case CHAR_SLASH:
      if (charAt(source, offset + 1) === CHAR_STAR) {
        tokenType = COMMENT;
        const end = source.indexOf("*/", offset + 2);
        return end === -1 ? source.length : end + 2;
      }
      return delim(offset);
    case CHAR_COLON:
      tokenType = COLON;
      return offset + 1;
    case CHAR_SEMICOLON:
      tokenType = SEMICOLON;
      return offset + 1;
    case CHAR_LT:
      if (charAt(source, offset + 1) === CHAR_BANG && charAt(source, offset + 2) === CHAR_MINUS && charAt(source, offset + 3) === CHAR_MINUS) {
        tokenType = CDO;
        return offset + 4;
      }
      return delim(offset);
    case CHAR_AT:
      if (isIdentifierStart(charAt(source, offset + 1), charAt(source, offset + 2), charAt(source, offset + 3))) {
        tokenType = AT_KEYWORD;
        return consumeName(source, offset + 1);
      }
      return delim(offset);
    case CHAR_OPEN_BRACKET:
      tokenType = LEFT_SQUARE_BRACKET;
      return offset + 1;
    case CHAR_BACKSLASH:
      if (isValidEscape(code, charAt(source, offset + 1))) return scanIdentLike(source, offset);
      return delim(offset);
    case CHAR_CLOSE_BRACKET:
      tokenType = RIGHT_SQUARE_BRACKET;
      return offset + 1;
    case CHAR_OPEN_BRACE:
      tokenType = LEFT_CURLY_BRACKET;
      return offset + 1;
    case CHAR_CLOSE_BRACE:
      tokenType = RIGHT_CURLY_BRACKET;
      return offset + 1;
    case CAT_DIGIT:
      return scanNumeric(source, offset);
    case CAT_NAME_START:
      return scanIdentLike(source, offset);
    default:
      return delim(offset);
  }
}

function delim(offset: number): number {
  tokenType = DELIM;
  return offset + 1;
}

function scanNumeric(source: string, offset: number): number {
  offset = consumeNumber(source, offset);
  if (isIdentifierStart(charAt(source, offset), charAt(source, offset + 1), charAt(source, offset + 2))) {
    tokenType = DIMENSION;
    return consumeName(source, offset);
  }
  if (charAt(source, offset) === CHAR_PERCENT) {
    tokenType = PERCENTAGE;
    return offset + 1;
  }
  tokenType = NUMBER;
  return offset;
}

function consumeNumber(source: string, offset: number): number {
  let code = source.charCodeAt(offset);
  if (code === CHAR_PLUS || code === CHAR_MINUS) code = source.charCodeAt(++offset);
  if (isDigit(code)) {
    offset = digitsEnd(source, offset + 1);
    code = source.charCodeAt(offset);
  }
  if (code === CHAR_DOT && isDigit(source.charCodeAt(offset + 1))) offset = digitsEnd(source, offset + 2);
  if ((source.charCodeAt(offset) | 0x20) === 0x65) {
    let sign = 0;
    code = source.charCodeAt(offset + 1);
    if (code === CHAR_MINUS || code === CHAR_PLUS) {
      sign = 1;
      code = source.charCodeAt(offset + 2);
    }
    if (isDigit(code)) offset = digitsEnd(source, offset + 2 + sign);
  }
  return offset;
}

function digitsEnd(source: string, offset: number): number {
  while (offset < source.length && isDigit(source.charCodeAt(offset))) offset++;
  return offset;
}

function scanIdentLike(source: string, start: number): number {
  let offset = consumeName(source, start);
  if (offset - start === 3 && charAt(source, offset) === CHAR_OPEN_PAREN && isUrl(source, start)) {
    offset = whiteSpaceEnd(source, offset + 1);
    const code = charAt(source, offset);
    if (code === CHAR_DOUBLE_QUOTE || code === CHAR_SINGLE_QUOTE) {
      tokenType = FUNCTION;
      return start + 4;
    }
    return scanUrl(source, offset);
  }
  if (charAt(source, offset) === CHAR_OPEN_PAREN) {
    tokenType = FUNCTION;
    return offset + 1;
  }
  tokenType = IDENT;
  return offset;
}

function isUrl(source: string, start: number): boolean {
  return (
    (source.charCodeAt(start) | 0x20) === 0x75 &&
    (source.charCodeAt(start + 1) | 0x20) === 0x72 &&
    (source.charCodeAt(start + 2) | 0x20) === 0x6c
  );
}

function scanString(source: string, offset: number, quote: number): number {
  tokenType = STRING;
  for (; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    if (code === quote) return offset + 1;
    if (isNewline(code)) {
      tokenType = BAD_STRING;
      return offset + newlineLength(source, offset, code);
    }
    if (code === CHAR_BACKSLASH) {
      if (offset === source.length - 1) continue;
      const next = source.charCodeAt(offset + 1);
      if (isNewline(next)) offset += newlineLength(source, offset + 1, next);
      else if (next !== 0) offset = consumeEscaped(source, offset) - 1;
    }
  }
  return offset;
}

function scanUrl(source: string, offset: number): number {
  tokenType = URL;
  offset = whiteSpaceEnd(source, offset);
  for (; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    switch (category(code)) {
      case CHAR_CLOSE_PAREN:
        return offset + 1;
      case CAT_WHITESPACE:
        offset = whiteSpaceEnd(source, offset);
        if (offset >= source.length) return offset;
        if (source.charCodeAt(offset) === CHAR_CLOSE_PAREN) return offset + 1;
        tokenType = BAD_URL;
        return badUrlRemnants(source, offset);
      case CHAR_DOUBLE_QUOTE:
      case CHAR_SINGLE_QUOTE:
      case CHAR_OPEN_PAREN:
      case CAT_NON_PRINTABLE:
        tokenType = BAD_URL;
        return badUrlRemnants(source, offset);
      case CHAR_BACKSLASH:
        if (isValidEscape(code, charAt(source, offset + 1))) {
          offset = consumeEscaped(source, offset) - 1;
          break;
        }
        tokenType = BAD_URL;
        return badUrlRemnants(source, offset);
    }
  }
  return offset;
}

function badUrlRemnants(source: string, offset: number): number {
  for (; offset < source.length; offset++) {
    const code = source.charCodeAt(offset);
    if (code === CHAR_CLOSE_PAREN) return offset + 1;
    if (isValidEscape(code, charAt(source, offset + 1))) offset = consumeEscaped(source, offset);
  }
  return offset;
}
