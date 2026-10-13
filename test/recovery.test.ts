// yuku-css against css-tree on broken and unusual CSS: edge cases and values, then the corpus mutated at random,
// where every recovery path to `Raw` must land where css-tree's does.
import { describe, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { expectParity, expectTokens } from "./compare";

const CASES = [
  "",
  " ",
  "\uFEFFa{}",
  "\uFEFF",
  "a",
  "a;",
  "a }",
  "}",
  "{",
  "a{",
  "a{b",
  "a{b:",
  "a{b:c",
  "a{b:c!",
  "a{b:c ! important }",
  "a{b:c!IMPORTANT}",
  "a{b:c !ie}",
  "a{*zoom:1;_x:2;$y:3;+z:4;#w:5;&v:6;/u:7;//t:8}",
  "a{#hash:1}",
  "a{;;b:c;;}",
  "a{ b : c ; }",
  "a{--x:{y};--y: ;--z:}",
  "a{--x: a } b{}",
  "a{b:c d{e:f}}",
  "a{b{c:d} e:f;}",
  "a{html:is(.b) & {c:d}}",
  "a{> b{} + c{} ~ d{} :hover{} [x]{} #i{} *{} |y{}}",
  "a{& b{} &:hover{}}",
  "a{@media x{b:c; d{e:f}}}",
  "a{@layer x{b:c; d{}}}",
  "@layer x{a{}} @layer y; @layer;",
  "@media print{a{b:c}} @supports (x:y){a{}}",
  "@font-face{a:b} @page :first{a:b} @nest &{} @starting-style{a{}}",
  "@keyframes k{from{a:b}50%{c:d}to{}}",
  "@font-feature-values F{@swash{a:1}}",
  "@property --x{syntax:'<length>';inherits:false}",
  "@unknown x{a:b;c{}}",
  "@unknown{}@unknown;@unknown x;",
  "@import url(a.css) screen;@charset \"x\";",
  "@ {} @-x{} @1{}",
  "/*! keep */ a{} /* drop */ /*!*/ /*/",
  "<!-- a{} --> b{}",
  "a/**/b{} a /**/ b{} a/**/ b{}",
  ".a:hover/**/.b{}",
  "a,b , c,{}",
  ",a{}",
  "a,,b{}",
  "a>>b{} a> >b{} a+{}",
  "a /deep/ b{} a /x/ b{} a/{}",
  "a||b{}",
  "*|a{} |a{} ns|*{} *{} a|{} *|{}",
  "[a]{}[ a ]{}[a=b]{}[a = 'b' i]{}[a~=b]{}[a|=b]{}[a^=b]{}[a$=b]{}[a*=b]{}[ns|a]{}[*|a]{}[|a]{}",
  "[a i]{}[a=b c d]{}[a==b]{}[a~b]{}[*a]{}[*|=a]{}[=a]{}[]{}[a=]{}[a=1]{}[{}",
  "#a{}#1{}# {}#{}",
  ".a{}.1{}. a{}.{}.a.b.c{}",
  "a:b{}a::b{}a:::b{}a: b{}a:1{}a:{}",
  ":is(a,b){}:where(){}:not( a ){}:has(> a){}:is(){}:is( ){}:is(,){}:matches(a){}:-moz-any(a){}:-webkit-any(a){}",
  ":host{}:host(a){}:host(a b){}:host-context(a){}::slotted(a){}::slotted(a,b){}::part(a b){}",
  ":dir(ltr){}:dir(1){}:lang(en, 'fr', de-CH){}:lang(1){}:lang(){}",
  ":unknown(a { b ) c){}:unknown(  ){}::x(y){}",
  ":nth-child(2n+1){}:nth-child(odd){}:nth-child(EVEN){}:nth-child(-n+3){}:nth-child(n){}:nth-child(+n){}",
  ":nth-child(3){}:nth-child(+3){}:nth-child(-3){}:nth-child(2n){}:nth-child(-2n-1){}:nth-child(2n- 1){}",
  ":nth-child(n-1){}:nth-child(n- 1){}:nth-child(-n-1){}:nth-child(-n- 1){}:nth-child(n-1a){}:nth-child(2n-1a){}",
  ":nth-child(2n + 1){}:nth-child(2n + -1){}:nth-child(2n+ +1){}:nth-child(2n 1){}:nth-child(2N+1){}",
  ":nth-child(+ n){}:nth-child(a){}:nth-child(2a){}:nth-child(1.5n){}:nth-child(n of a, b){}:nth-of-type(2n of a){}",
  ":nth-child(2n+1 of){}:nth-child(of a){}:nth-child(){}:nth-child(-){}:nth-child(+){}:nth-child(2n+){}",
  "50%{}1{}from{}.5px{}1px{}",
  "a{b:\"x\\\"y\"}[a=\"\\41 b\"]{}[a='\\\n']{}[a=\"\\\"]{}[a=\"x\\\"]{}[a=\"\\0\"]{}[a=\"\\D800\"]{}[a=\"é\\é\"]{}",
  "a{b:url(x) url( 'y' ) url(a b) url(a\"b) url(\\)) url(\\\n)}",
  "a{b:\"x\ny\"}",
  "a{b:'x",
  "a{b:c}\r\nd{e:f}\re{}\fg{}",
  "é{ü:ö}🎉{a:b}.日本{}",
  "a{b:c} \u{1F600} d{}",
  "a{b:c;}}}}d{}",
  "a{b:(c;d)}",
  "a{b:[c;d]}",
  "a{b:c(d;e)}",
  "a{(b:c){}}",
  "a{b:c)d}",
  "a{b:c]d}",
  "a{b:c}}d{e:f}",
  "a[{b:c}",
  "a(b{c:d}",
  "a{b:-->}<!--{}",
  "\\61{}a\\:b{}\\{}",
  "a{b:c \\",
  "@media{a{b:c}",
  "@x y z",
  "a{@x y z}",
  "a{1:2}",
  "a{b c:d}",
  "a{b:c;d}",
  "a{b:c!;}",
  "a{b:c!x y}",
];

describe("parity on edge cases", () => {
  for (const source of CASES) {
    test(JSON.stringify(source), () => {
      expectTokens(source);
      expectParity(source);
    });
  }
});

// declaration values, each read as css-tree reads it, with custom properties raw and then parsed
const VALUES = [
  "a{b:1px 2em -3.5e2% +.5 1e3 0}",
  "a{b:#fff #1 # a #-x}",
  "a{b:'x' \"y\" url(z) url( 'w' ) URL(\"v\") url(\"u\" t) url() url(\\))}",
  "a{b:f(g, h(i)) (j k) [l m] ( ) [] f()}",
  "a{b:1 + 2 - 3 * 4 / 5 , 6+7 -8 +-9 1 +2}",
  "a{b:calc(1px + 2px) calc( (1 - 2)*3 ) calc(1px+2px) calc(1px -2px)}",
  "a{b:u+0025-00ff U+4?? u+1 u+? u+?????? u+1-2 u+12345678 u+1??????? u+1-? u+-1 u+ u+x u+1e3 u+5%}",
  "a{b:var(--x) var( --x , ) var(--x,) var(--x, a b) var(--x, (a) !important) var(x) var(1) var()}",
  "a{b:VAR(--x, a) var(--x, a{b}) var(--x, ;) var(--x, !)}",
  "a{b:expression(a ? b : c) expression() EXPRESSION({)}",
  "a{b:c !important; d:e!ie; f: g ! important}",
  "a{b:c d{e:f}}",
  "a{b:c; d: e{}; f: (g{}) }",
  "a{b:c &d}",
  "a{b:c >d; e: f ~ g; h: i | j; k: l = m; n: o < p}",
  "a{b:c:d; e:f;g}",
  "a{b:'x\ny'; c: url(a\"b); d: \\}",
  "a{b:/* x */c/* y */ d /* z */}",
  "a{--x:; --y: ; --z:/**/; --w: /**/ ; --v: a b ; --u:{a}; --t: 1 + 2}",
  "a{--x:var(--y, ); --z: var(--y,/**/ ) !important}",
  "a{b:@c; d: {e}; f: ]}",
  "a{b:(((((((((a)))))))))}",
  "a{b:c}d{e:(}",
  "a{b:f(}",
  "a{b:[}",
  "a{b:u+1",
  "a{b:var(--x,",
  "a{b:1 # !important {} c:d}",
  "a{b:c # !x{} d:e #;f:g}",
];

describe("parity on values", () => {
  for (const source of VALUES) {
    test(JSON.stringify(source), () => {
      expectTokens(source);
      expectParity(source);
      expectParity(source, { parseCustomProperty: true });
    });
  }
});

// at-rule preludes, each read as css-tree reads it, then kept raw
const PRELUDES = [
  "@media screen{} @media not screen{} @media ONLY screen and (color){} @media all and (a:1), print{}",
  "@media (a){} @media (a:1){} @media (a:b){} @media (a:2px){} @media (a:1/2){} @media (a: 1 / 2){} @media (a:calc(1/2)){}",
  "@media (a:calc(1) / 2){} @media (a:1 !){} @media (a: 'b'){} @media (a b){} @media (a: b c){} @media (--a: 1){}",
  "@media (1 < a){} @media (1px <= a < 2px){} @media (a >= 1){} @media (a = 1){} @media (1/2 < a){} @media (a > 1 2){}",
  "@media (calc(1) < a < max(1, 2)){} @media (a < b < c < d){} @media (<){} @media (a <){} @media (a < = 1){}",
  "@media ((a) and (b)){} @media (a) and (b) or (c){} @media not (a) and (b){} @media not not (a){} @media not{}",
  "@media screen (a){} @media screen and (a) or (b){} @media screen and{} @media screen and not (a){} @media and{}",
  "@media layer{} @media only{} @media only and{} @media a b{} @media a,{} @media ,a{} @media !{} @media (a) ~{}",
  "@media foo(a){} @media f(){} @media (){} @media ( ){} @media (1 2){} @media (a) (b){} @media (a) b (c){}",
  "@media/**/screen/**/and/**/(/**/a/**/:/**/1/**/){} @media (a:1",
  "@media (a",
  "@media ((a)",
  "@media (a < 1",
  "@supports (a:b){} @supports not (a:b){} @supports (a:b) and (c:d) or (e:f){} @supports ((a:b)){} @supports (a){}",
  "@supports selector(a > b){} @supports SELECTOR(> b){} @supports selector(a{}){} @supports f(a){} @supports (a:b !important){}",
  "@supports (--a: { b }){} @supports (a:){} @supports (){} @supports a{} @supports 'a'{} @supports (a:b",
  "@container (a > 1px){} @container name (a){} @container NONE (a){} @container style(--a: b){} @container style(a){}",
  "@container name{} @container not (a) and (b){} @container a b (c){} @container (a) or style(b: c){} @container",
  "@supports (display: grid) and (not (display: inline-grid)){} @supports not (not (a: b)){} @supports ((a: b) or (c: d)) and (e: f){}",
  "@container (not (width > 1px)){} @container card (not (a)){} @media (not (hover)){} @media ((a) or (b)) and (not (c: 1)){}",
  "@supports (not (a b)){} @supports ((a) x){} @media ((a) x){} @media (not (a: 'b')){} @container ((a) ~){} @media (not (a: f(1) / 2))",
  "@supports (not (a: b) ~){} @supports SELECTOR(a){} @supports SeLeCtor1(a){} @supports (not (a: b){} @media ((a) or (b",
  "@import 'a'; @import url(a); @import url( 'a' ); @import url('a' b); @import a; @import 'a' 'b'; @import;",
  "@import 'a' layer; @import 'a' layer(b.c); @import 'a' layer(); @import 'a' layer( 1 ); @import 'a' LAYER(b) x;",
  "@import 'a' supports(a:b); @import 'a' supports(not (a:b)); @import 'a' supports(); @import 'a' supports( 1 );",
  "@import 'a' layer(b) supports(c:d) screen and (e), print; @import 'a' screen, ; @import 'a' f(x) screen;",
  "@import 'a' layer(b",
  "@import 'a' supports(a:b",
  "@layer a; @layer a.b, c; @layer a . b; @layer a,; @layer ,a; @layer 1; @layer a{} @layer a, b{} @layer{}",
  "@scope (a) to (b){} @scope (a){} @scope to (b){} @scope ( .a. ) to ( .b. ){} @scope x{} @scope to{} @scope (a) to b{}",
  "@scope (> a){} @scope (a",
  "@page{} @page :first{} @page a:left{} @page !{} @nest &.a{} @nest > a{} @font-face a{} @starting-style a{}",
  "@keyframes a{} @-webkit-keyframes a{} @counter-style a{} @property --a{} @x a b, c(d){} @x #{} @x 'a' url(b) 1px 50%;",
  "a{@media (a){b:c} @supports (a:b){d{}} @container (a){} @layer a{b:c} @scope (a){b:c}}",
  "@media (a) { @media (b) { @supports (c:d) { a {} } } }",
];

describe("parity on preludes", () => {
  for (const source of PRELUDES) {
    test(JSON.stringify(source), () => {
      expectTokens(source);
      expectParity(source);
      expectParity(source, { parseAtrulePrelude: false });
    });
  }
});

// the <urange> and <an-plus-b> strings css-tree's own parse tests read, valid and invalid
const GENERIC = JSON.parse(readFileSync(new URL("suite/definition-syntax-match/generic.json", import.meta.url), "utf8"));
const GRAMMAR: [string, (text: string) => string][] = [
  ["<urange>", (text) => `a{b:${text}}`],
  ["<urange>#", (text) => `a{b:${text}}`],
  ["<an-plus-b>", (text) => `:nth-child(${text}){}`],
];

describe("parity on css-tree's generic grammar strings", () => {
  for (const [name, wrap] of GRAMMAR) {
    const { valid = [], invalid = [] } = GENERIC[name] as { valid?: string[]; invalid?: string[] };
    for (const text of [...valid, ...invalid]) {
      const source = wrap(text);
      test(`${name} ${JSON.stringify(text)}`, () => {
        expectTokens(source);
        expectParity(source);
      });
    }
  }
});

// xorshift, so every run mutates the same way
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

const CORPUS = new URL("corpus/", import.meta.url);
const FILES = readdirSync(CORPUS)
  .sort()
  .map((name) => readFileSync(new URL(name, CORPUS), "utf8"));
const JUNK = ["{", "}", "(", ")", "[", "]", ";", ":", ",", ".", "#", "&", ">", "+", "~", "*", "|", "=", "'", '"', "\\", "/", "/*", "*/", "!", " ", "\n", "@", "-", "%", "1", "n", "é", "url(", "--"];

describe("parity on mutated sources", () => {
  const next = random(0x9e3779b9);
  for (let i = 0; i < 400; i++) {
    const file = FILES[Math.floor(next() * FILES.length)]!;
    const at = Math.floor(next() * file.length);
    const removed = next() < 0.5 ? Math.floor(next() * 12) : 0;
    let inserted = "";
    for (let j = Math.floor(next() * 3); j >= 0; j--) inserted += JUNK[Math.floor(next() * JUNK.length)];
    const source = file.slice(0, at) + inserted + file.slice(at + removed);
    test(`mutation ${i}`, () => {
      expectTokens(source);
      expectParity(source);
    });
  }
});

// prelude tokens dropped after an at-keyword of the corpus, or of the preludes above
const PRELUDE_JUNK = ["(", ")", "(a", "a)", " and ", " or ", " not ", "only ", ",", ":", "<", ">", "=", "/", "1", "2px", "'", "url(", "layer(", "supports(", "selector(", "style(", " to ", ".", "!", " "];
const PRELUDE_FILES = [...FILES.filter((file) => file.includes("@")), ...PRELUDES];

describe("parity on mutated preludes", () => {
  const next = random(0x6c8e9cf5);
  for (let i = 0; i < 400; i++) {
    const file = PRELUDE_FILES[Math.floor(next() * PRELUDE_FILES.length)]!;
    let at = Math.floor(next() * file.length);
    const keyword = file.indexOf("@", at) === -1 ? file.indexOf("@") : file.indexOf("@", at);
    at = keyword + 1 + Math.floor(next() * 24);
    const removed = next() < 0.5 ? Math.floor(next() * 6) : 0;
    let inserted = "";
    for (let j = Math.floor(next() * 3); j >= 0; j--) inserted += PRELUDE_JUNK[Math.floor(next() * PRELUDE_JUNK.length)];
    const source = file.slice(0, at) + inserted + file.slice(at + removed);
    test(`prelude mutation ${i}`, () => {
      expectParity(source);
    });
  }
});

// value tokens dropped into the corpus, custom properties parsed in every other source
const VALUE_JUNK = ["u+", "?", "var(", "expression(", "url(", "calc(", "!", "#", "+", "-", "*", "/", ",", "(", ")", "[", "]", "1e", "%", "--x:", "'", " "];

describe("parity on mutated values", () => {
  const next = random(0x2545f491);
  for (let i = 0; i < 400; i++) {
    const file = FILES[Math.floor(next() * FILES.length)]!;
    let at = Math.floor(next() * file.length);
    const colon = file.indexOf(":", at);
    if (colon !== -1) at = colon + 1 + Math.floor(next() * 8);
    const removed = next() < 0.5 ? Math.floor(next() * 6) : 0;
    let inserted = "";
    for (let j = Math.floor(next() * 3); j >= 0; j--) inserted += VALUE_JUNK[Math.floor(next() * VALUE_JUNK.length)];
    const source = file.slice(0, at) + inserted + file.slice(at + removed);
    const options = { parseCustomProperty: i % 2 === 1 };
    test(`value mutation ${i}`, () => {
      expectParity(source, options);
    });
  }
});
