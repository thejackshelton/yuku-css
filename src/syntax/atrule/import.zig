// css-tree's `@import` prelude: a string or url, then `layer` or `layer()`, `supports()`, and
// media queries, each optional

const std = @import("std");
const ast = @import("../../ast.zig");
const parser = @import("../../parser.zig");
const values = @import("../value.zig");
const atrule = @import("../atrule.zig");
const conditions = @import("../condition.zig");
const media_query = @import("../media_query.zig");
const layers = @import("layer.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const NodeIndex = ast.NodeIndex;

pub fn prelude(p: *Parser) ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    switch (p.tag) {
        .string => try p.push(try p.string()),
        .url => try p.push(try values.url(p)),
        .function => {
            if (!atrule.isWord(p, "url(")) return p.fail(.url_function_expected, null);
            try p.push(try values.url(p));
        },
        else => return p.fail(.string_or_url_expected, null),
    }
    p.skipSC();
    if (p.tag == .ident and atrule.isWord(p, "layer")) {
        try p.push(try p.identifier());
    } else if (p.tag == .function and atrule.isWord(p, "layer(")) {
        try p.push(try function(p, .layer));
    }
    p.skipSC();
    if (p.tag == .function and atrule.isWord(p, "supports(")) {
        try p.push(try function(p, .supports));
    }
    const next = atrule.lookupNonWSType(p, 0);
    if (next == .ident or next == .left_parenthesis) try p.push(try media_query.list(p));
    std.debug.assert(p.scratch.items.len > base);
    return p.flush(base);
}

const Reads = enum { layer, supports };

// a `Function` holding a layer name, or a declaration or supports condition, as css-tree's
// `Function(null, parseFunctions)` reads it
fn function(p: *Parser, comptime reads: Reads) ParseError!NodeIndex {
    std.debug.assert(p.tag == .function);
    const start = p.start;
    const name: ast.String = .{ .start = start, .end = p.end - 1 };
    p.next();
    p.skipSC();
    const node = switch (reads) {
        .layer => try atrule.fallback(p, closed, .{layers.layer}, atrule.rawBalanced, .{true}),
        .supports => try atrule.fallback(p, closed, .{declaration}, supportsCondition, .{}),
    };
    const base = p.scratch.items.len;
    if (!isEmptyRaw(p, node)) try p.push(node);
    const children = try p.flush(base);
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(start < p.start);
    return p.add(.{ .function = .{ .name = name, .children = children } }, start, p.start);
}

fn supportsCondition(p: *Parser) ParseError!NodeIndex {
    return atrule.fallback(p, closed, .{supports}, atrule.rawBalanced, .{true});
}

fn declaration(p: *Parser) ParseError!NodeIndex {
    return p.declaration(false);
}

fn supports(p: *Parser) ParseError!NodeIndex {
    return conditions.condition(p, .supports, .full);
}

// css-tree checks for `)` in a `finally`, so its error replaces the one `parse` throws
fn closed(p: *Parser, comptime parse: anytype) ParseError!NodeIndex {
    const node = parse(p) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => {
            if (!atClose(p)) return p.fail(.unexpected_input, null);
            return error.Syntax;
        },
    };
    if (!atClose(p)) return p.fail(.unexpected_input, null);
    std.debug.assert(node != .null);
    return node;
}

// the end of input closes the function (css-syntax-3 §5.4.9)
fn atClose(p: *Parser) bool {
    p.skipSC();
    const next = atrule.lookupNonWSType(p, 0);
    std.debug.assert(next != .whitespace and next != .comment);
    return next == .right_parenthesis or next == .eof;
}

fn isEmptyRaw(p: *const Parser, node: NodeIndex) bool {
    const data = p.tree.data(node);
    return data == .raw and data.raw.value.start == data.raw.value.end;
}

test "reads each part of an import" {
    const source = "@import url(a) layer(b) supports(c: d) screen and (e);";
    var tree = try parser.parse(std.testing.allocator, source, .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const children = tree.extra(tree.data(at.prelude).atrule_prelude.children);
    var tags: [4]ast.Tag = undefined;
    for (children, &tags) |child, *tag| tag.* = std.meta.activeTag(tree.data(child));
    const want = [_]ast.Tag{ .url, .function, .function, .media_query_list };
    try std.testing.expectEqualSlices(ast.Tag, &want, &tags);
}

test "drops an empty layer()" {
    var tree = try parser.parse(std.testing.allocator, "@import url(a) layer();", .{});
    defer tree.deinit();
    try std.testing.expectEqual(ast.Message.identifier_expected, tree.diagnostics.items[0].message);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const children = tree.extra(tree.data(at.prelude).atrule_prelude.children);
    try std.testing.expectEqual(0, tree.data(children[1]).function.children.len);
}
