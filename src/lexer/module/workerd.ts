// workerd can't compile WebAssembly from bytes, so it imports the `.wasm` file as a module
import lexer from "#lexer-wasm";

export { lexer };
