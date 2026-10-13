// css-tree's `@container` prelude: an optional container name, then a container query

const std = @import("std");
const ast = @import("../../ast.zig");
const parser = @import("../../parser.zig");
const conditions = @import("../condition.zig");

const Parser = parser.Parser;

// css-contain-3 excludes these from <container-name>
const reserved = [_][]const u8{ "none", "and", "not", "or" };

pub fn prelude(p: *Parser) parser.ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    if (p.tag == .ident and !isReserved(p.src[p.start..p.end])) try p.push(try p.identifier());
    try p.push(try conditions.condition(p, .container, .full));
    std.debug.assert(p.scratch.items.len > base);
    return p.flush(base);
}

fn isReserved(name: []const u8) bool {
    std.debug.assert(name.len > 0);
    for (reserved) |word| {
        if (std.ascii.eqlIgnoreCase(name, word)) return true;
    }
    return false;
}

test "reads a container name unless it is a keyword" {
    const cases = .{ .{ "@container card (width > 1px) {}", 2 }, .{ "@container not (a) {}", 1 } };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        const prelude_node = tree.data(at.prelude).atrule_prelude;
        try std.testing.expectEqual(case[1], prelude_node.children.len);
    }
}
