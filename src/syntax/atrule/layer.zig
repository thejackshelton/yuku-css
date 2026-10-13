// css-tree's `@layer` prelude, a LayerList, and the Layer it holds

const std = @import("std");
const ast = @import("../../ast.zig");
const parser = @import("../../parser.zig");
const atrule = @import("../atrule.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const NodeIndex = ast.NodeIndex;

/// css-tree's `LayerList`: layer names between commas.
pub fn list(p: *Parser) ParseError!NodeIndex {
    const base = p.scratch.items.len;
    p.skipSC();
    while (!p.eof) {
        const before = p.tokenStart();
        try p.push(try layer(p));
        std.debug.assert(p.tokenStart() > before or p.tag == .eof);
        if (atrule.lookupTypeNonSC(p, 0) != .comma) break;
        p.skipSC();
        p.next();
        p.skipSC();
    }
    const children = try p.flush(base);
    std.debug.assert(p.scratch.items.len == base);
    const span = p.spanOfList(children);
    return p.add(.{ .layer_list = .{ .children = children } }, span.start, span.end);
}

/// css-tree's `Layer`: identifiers joined by `.`, with nothing between them.
pub fn layer(p: *Parser) ParseError!NodeIndex {
    const start = p.start;
    try p.eat(.ident);
    while (p.isDelim('.')) {
        p.next();
        try p.eat(.ident);
    }
    std.debug.assert(start < p.start);
    const name: ast.String = .{ .start = start, .end = p.start };
    return p.add(.{ .layer = .{ .name = name } }, start, p.start);
}

test "reads layer names" {
    var tree = try parser.parse(std.testing.allocator, "@layer a , b.c.d;", .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const prelude = tree.data(at.prelude).atrule_prelude;
    const layers = tree.extra(tree.data(tree.extra(prelude.children)[0]).layer_list.children);
    try std.testing.expectEqualStrings("b.c.d", tree.string(tree.data(layers[1]).layer.name));
}
