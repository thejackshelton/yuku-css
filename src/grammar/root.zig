pub const syntax = @import("syntax.zig");
pub const generic = @import("generic.zig");
pub const defs = @import("defs.zig");
pub const graph = @import("graph.zig");
pub const lexer = @import("lexer.zig");
pub const match = @import("match.zig");

test {
    _ = syntax;
    _ = generic;
    _ = defs;
    _ = graph;
    _ = lexer;
    _ = match;
}
