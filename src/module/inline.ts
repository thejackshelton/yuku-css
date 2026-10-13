import bytes from "../../zig-out/bin/yuku-css.wasm";

export const css: WebAssembly.Module = new WebAssembly.Module(bytes);
