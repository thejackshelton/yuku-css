// css-tree's `@scope` prelude: `(root)`, `to (limit)`, or both, each a selector list or `Raw`

const std = @import("std");
const ast = @import("../../ast.zig");
const parser = @import("../../parser.zig");
const atrule = @import("../atrule.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const NodeIndex = ast.NodeIndex;

/// css-tree's `Scope`.
pub fn scope(p: *Parser) ParseError!NodeIndex {
    p.skipSC();
    const start = p.start;
    var root: NodeIndex = .null;
    var limit: NodeIndex = .null;
    if (p.tag == .left_parenthesis) {
        p.next();
        root = try selectors(p);
    }
    if (atrule.lookupNonWSType(p, 0) == .ident) {
        p.skipSC();
        try atrule.eatIdent(p, "to", .to_expected);
        p.skipSC();
        try p.eat(.left_parenthesis);
        limit = try selectors(p);
    }
    std.debug.assert(start <= p.start);
    return p.add(.{ .scope = .{ .root = root, .limit = limit } }, start, p.start);
}

// <scope-start> and <scope-end> are each a <selector-list> (css-cascade-6 §2.5)
fn selectors(p: *Parser) ParseError!NodeIndex {
    p.skipSC();
    const node = try atrule.fallback(p, Parser.selectorList, .{false}, atrule.rawBalanced, .{true});
    p.skipSC();
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(node != .null);
    return node;
}

test "reads a scope's root and limit" {
    var tree = try parser.parse(std.testing.allocator, "@scope to ( .a. ) {}", .{});
    defer tree.deinit();
    try std.testing.expectEqual(ast.Message.identifier_expected, tree.diagnostics.items[0].message);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const prelude = tree.data(at.prelude).atrule_prelude;
    const node = tree.data(tree.extra(prelude.children)[0]).scope;
    try std.testing.expectEqual(NodeIndex.null, node.root);
    try std.testing.expectEqualStrings(".a.", tree.string(tree.data(node.limit).raw.value));
}
