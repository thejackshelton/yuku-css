const CHAR_MINUS = 0x2d;

export interface KeywordDescriptor {
  readonly basename: string;
  readonly name: string;
  readonly prefix: string;
  readonly vendor: string;
  readonly custom: boolean;
}

export interface PropertyDescriptor {
  readonly basename: string;
  readonly name: string;
  readonly hack: string;
  readonly vendor: string;
  readonly prefix: string;
  readonly custom: boolean;
}

const keywords = new Map<string, KeywordDescriptor>();
const properties = new Map<string, PropertyDescriptor>();

/** Whether `str` from `offset` starts with `--`. */
export function isCustomProperty(str: string, offset = 0): boolean {
  return str.length - offset >= 2 && str.charCodeAt(offset) === CHAR_MINUS && str.charCodeAt(offset + 1) === CHAR_MINUS;
}

/** The vendor prefix of `str` from `offset`, as `-webkit-`, or `""`. */
export function vendorPrefix(str: string, offset = 0): string {
  if (str.length - offset < 3) return "";
  if (str.charCodeAt(offset) !== CHAR_MINUS || str.charCodeAt(offset + 1) === CHAR_MINUS) return "";
  const dash = str.indexOf("-", offset + 2);
  return dash === -1 ? "" : str.substring(offset, dash + 1);
}

/** Splits a keyword into its vendor prefix and lowercase base name. */
export function keyword(word: string): KeywordDescriptor {
  let descriptor = keywords.get(word);
  if (descriptor !== undefined) return descriptor;
  const name = word.toLowerCase();
  descriptor = keywords.get(name);
  if (descriptor === undefined) {
    const custom = isCustomProperty(name, 0);
    const vendor = custom ? "" : vendorPrefix(name, 0);
    descriptor = Object.freeze({ basename: name.substr(vendor.length), name, prefix: vendor, vendor, custom });
  }
  keywords.set(word, descriptor);
  return descriptor;
}

/** Splits a property name into its hack (`*`, `_`, …), vendor prefix, and base name. */
export function property(name: string): PropertyDescriptor {
  let descriptor = properties.get(name);
  if (descriptor !== undefined) return descriptor;
  let hack = name.charAt(0);
  if (hack === "/") hack = name.charAt(1) === "/" ? "//" : "/";
  else if (hack !== "_" && hack !== "*" && hack !== "$" && hack !== "#" && hack !== "+" && hack !== "&") hack = "";
  const custom = isCustomProperty(name, hack.length);
  let lower = name;
  if (!custom) {
    lower = name.toLowerCase();
    descriptor = properties.get(lower);
    if (descriptor !== undefined) {
      properties.set(name, descriptor);
      return descriptor;
    }
  }
  const vendor = custom ? "" : vendorPrefix(lower, hack.length);
  const prefix = lower.substr(0, hack.length + vendor.length);
  descriptor = Object.freeze({ basename: lower.substr(prefix.length), name: lower.substr(hack.length), hack, vendor, prefix, custom });
  properties.set(name, descriptor);
  return descriptor;
}
