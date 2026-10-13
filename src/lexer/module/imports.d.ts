declare module "#lexer-module" {
  export const lexer: WebAssembly.Module;
}

declare module "#lexer-wasm" {
  const module: WebAssembly.Module;
  export default module;
}
