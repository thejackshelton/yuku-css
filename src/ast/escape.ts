import { CHAR_BACKSLASH, CHAR_CR, CHAR_LF, consumeEscaped, decodeEscaped, isValidEscape } from "../chars";

// the text of `str` from `start` through `end` with its escapes decoded; a `\` at `end` escapes
// what follows `end`, a closing quote or parenthesis, or at the very end of `str` nothing
export function unescape(str: string, start: number, end: number): string {
  let decoded = "";
  let from = start;
  for (let i = start; i <= end; i++) {
    if (str.charCodeAt(i) !== CHAR_BACKSLASH) continue;
    decoded += str.slice(from, i);
    if (i === end) return i === str.length - 1 ? decoded : decoded + str.slice(i + 1);
    const code = str.charCodeAt(++i);
    if (isValidEscape(CHAR_BACKSLASH, code)) {
      const escapeEnd = consumeEscaped(str, i - 1);
      decoded += decodeEscaped(str.slice(i, escapeEnd));
      i = escapeEnd - 1;
    } else if (code === CHAR_CR && str.charCodeAt(i + 1) === CHAR_LF) {
      i++;
    }
    from = i + 1;
  }
  return decoded + str.slice(from, end + 1);
}
