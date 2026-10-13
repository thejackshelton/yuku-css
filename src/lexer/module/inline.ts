import bytes from "../../../zig-out/bin/yuku-css-lexer.wasm";

export const lexer: WebAssembly.Module = new WebAssembly.Module(bytes);
