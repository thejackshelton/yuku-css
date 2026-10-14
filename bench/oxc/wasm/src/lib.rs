// oxc-css-parser's own wasm/src/lib.rs at the pinned revision, plus `check` for the benchmark's gate
use oxc_css_parser::{Allocator, Parser, Syntax, ast::Stylesheet};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(js_name = parseStylesheet)]
pub fn parse_stylesheet(source: String, syntax: JsValue) -> Result<JsValue, JsValue> {
    let syntax = serde_wasm_bindgen::from_value(syntax)?;
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, &source, syntax);
    match parser.parse::<Stylesheet>() {
        Ok(ast) => {
            let serializer = serde_wasm_bindgen::Serializer::new().serialize_missing_as_null(true);
            ast.serialize(&serializer).map_err(JsValue::from)
        }
        Err(error) => Err(serde_wasm_bindgen::to_value(&(&error, error.kind.to_string()))?),
    }
}

/// The error count and first error, fatal or recoverable, or an empty string when there is none.
#[wasm_bindgen]
pub fn check(source: String) -> String {
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, &source, Syntax::Css);
    match parser.parse::<Stylesheet>() {
        Err(error) => format!("1 error, first: {} at {}", error.kind, error.span.start),
        Ok(_) => match parser.recoverable_errors() {
            [] => String::new(),
            errors => format!(
                "{} error{}, first: {} at {}",
                errors.len(),
                if errors.len() > 1 { "s" } else { "" },
                errors[0].kind,
                errors[0].span.start
            ),
        },
    }
}
