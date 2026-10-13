import { CHAR_MINUS, isName } from "../chars";
import { unescape } from "./escape";

/** An identifier's value, its escapes decoded. */
export function decode(str: string): string {
  return unescape(str, 0, str.length - 1);
}

/** Serializes an identifier, as CSSOM's "serialize an identifier" does. */
export function encode(str: string): string {
  if (str.length === 1 && str.charCodeAt(0) === CHAR_MINUS) return "\\-";
  let encoded = "";
  let from = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const leadingDigit = code >= 0x30 && code <= 0x39 && (i === 0 || (i === 1 && str.charCodeAt(0) === CHAR_MINUS));
    if (!leadingDigit && isName(code)) continue;
    encoded += str.slice(from, i);
    from = i + 1;
    if (code === 0) encoded += "�";
    else if (code <= 0x1f || code === 0x7f || leadingDigit) encoded += "\\" + code.toString(16) + " ";
    else encoded += "\\" + str.charAt(i);
  }
  return encoded === "" ? str : encoded + str.slice(from);
}
