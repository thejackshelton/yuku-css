// oxc-css-parser built for the host, parse only, timed per file as tools/native_bench.zig times yuku-css
// usage: oxc-css-parser-bench-native <rounds> <file.css>... (one JSON line per file)
use oxc_css_parser::{Allocator, Parser, Syntax, ast::Stylesheet};
use serde_json::Value;
use std::{
    env, fs,
    hint::black_box,
    time::{Duration, Instant},
};

fn main() {
    let args: Vec<String> = env::args().collect();
    assert!(args.len() >= 3, "usage: oxc-css-parser-bench-native <rounds> <file.css>...");
    let rounds: usize = args[1].parse().expect("rounds");
    for path in &args[2..] {
        let source = fs::read_to_string(path).expect("read");
        let nodes = node_count(&source);
        let mut samples = vec![0u128; rounds];
        let warm_until = Instant::now() + Duration::from_secs(1);
        while Instant::now() < warm_until {
            parse(&source);
        }
        for sample in &mut samples {
            let start = Instant::now();
            parse(&source);
            *sample = start.elapsed().as_nanos();
        }
        samples.sort_unstable();
        let name = path.rsplit('/').next().unwrap_or(path);
        #[allow(clippy::cast_precision_loss)]
        let parse_ms = samples[samples.len() / 2] as f64 / 1e6;
        println!("{{\"file\":{name:?},\"bytes\":{},\"nodes\":{nodes},\"parse_ms\":{parse_ms:.6}}}", source.len());
    }
}

// a fresh allocator per parse, as the crate's own benches/self.rs does
fn parse(source: &str) {
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, source, Syntax::Css);
    black_box(parser.parse::<Stylesheet>().ok());
}

// objects with a string `type`, counted as bench/adapters.ts counts every tree
fn node_count(source: &str) -> usize {
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, source, Syntax::Css);
    let Ok(ast) = parser.parse::<Stylesheet>() else { return 0 };
    let value = serde_json::to_value(&ast).expect("serialize");
    let mut count = 0;
    let mut stack = vec![&value];
    while let Some(value) = stack.pop() {
        match value {
            Value::Array(items) => stack.extend(items),
            Value::Object(map) if map.get("type").is_some_and(Value::is_string) => {
                count += 1;
                stack.extend(map.values());
            }
            _ => {}
        }
    }
    count
}
