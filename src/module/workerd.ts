// workerd can't compile WebAssembly from bytes, so it imports the `.wasm` file as a module
import css from "#wasm";

export { css };
