declare module "#module" {
  export const css: WebAssembly.Module;
}

declare module "#wasm" {
  const module: WebAssembly.Module;
  export default module;
}

declare module "*.wasm" {
  const bytes: Uint8Array<ArrayBuffer>;
  export default bytes;
}
