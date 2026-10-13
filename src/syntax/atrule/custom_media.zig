// mediaqueries-5's `@custom-media` prelude: an extension name, then a MediaQueryList, or the
// Identifier `true` or `false`, as `@container` holds its name beside its condition

const std = @import("std");
const ast = @import("../../ast.zig");
const parser = @import("../../parser.zig");
const token = @import("../../token.zig");
const atrule = @import("../atrule.zig");
const media_query = @import("../media_query.zig");

const Parser = parser.Parser;

pub fn prelude(p: *Parser) parser.ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    const dashed = p.tag == .ident and std.mem.startsWith(u8, p.src[p.start..p.end], "--");
    if (!dashed) return p.fail(.extension_name_expected, null);
    try p.push(try p.identifier());
    p.skipSC();
    if (p.tag == .ident and isBoolean(p) and endsPrelude(atrule.lookupTypeNonSC(p, 1))) {
        try p.push(try p.identifier());
    } else {
        try p.push(try media_query.list(p));
    }
    std.debug.assert(p.scratch.items.len == base + 2);
    return p.flush(base);
}

fn isBoolean(p: *const Parser) bool {
    std.debug.assert(p.tag == .ident);
    return atrule.isWord(p, "true") or atrule.isWord(p, "false");
}

fn endsPrelude(tag: token.Tag) bool {
    return tag == .semicolon or tag == .left_curly_bracket or tag == .eof;
}

test "reads a custom media query" {
    const cases = .{
        .{ "@custom-media --narrow (min-width: 40em);", ast.Tag.media_query_list },
        .{ "@custom-media --a screen and (max-width: calc(1px));", ast.Tag.media_query_list },
        .{ "@custom-media --on true;", ast.Tag.identifier },
        .{ "@custom-media --off FALSE;", ast.Tag.identifier },
        .{ "@custom-media --wide (not (hover)), print;", ast.Tag.media_query_list },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        const children = tree.extra(tree.data(at.prelude).atrule_prelude.children);
        try std.testing.expectEqual(2, children.len);
        try std.testing.expectEqual(ast.Tag.identifier, std.meta.activeTag(tree.data(children[0])));
        try std.testing.expectEqual(case[1], std.meta.activeTag(tree.data(children[1])));
    }
}

test "keeps a custom media prelude without an extension name raw" {
    var tree = try parser.parse(std.testing.allocator, "@custom-media narrow (a);", .{});
    defer tree.deinit();
    try std.testing.expectEqual(1, tree.diagnostics.items.len);
    const message = tree.diagnostics.items[0].message;
    try std.testing.expectEqual(ast.Message.extension_name_expected, message);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    try std.testing.expectEqual(ast.Tag.raw, std.meta.activeTag(tree.data(at.prelude)));
}
