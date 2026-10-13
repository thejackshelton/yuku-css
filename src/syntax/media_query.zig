// css-tree's MediaQueryList and MediaQuery, with the media types Media Queries 4 reserves reported

const std = @import("std");
const ast = @import("../ast.zig");
const parser = @import("../parser.zig");
const atrule = @import("atrule.zig");
const conditions = @import("condition.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const NodeIndex = ast.NodeIndex;
const String = ast.String;

/// css-tree's `MediaQueryList`: media queries between commas.
pub fn list(p: *Parser) ParseError!NodeIndex {
    const base = p.scratch.items.len;
    p.skipSC();
    // each round reads a comma or ends the list
    var rounds: u32 = 0;
    while (!p.eof) : (rounds += 1) {
        std.debug.assert(rounds <= p.src.len);
        try p.push(try query(p));
        if (p.tag != .comma) break;
        p.next();
    }
    const children = try p.flush(base);
    std.debug.assert(p.scratch.items.len == base);
    const span = p.spanOfList(children);
    return p.add(.{ .media_query_list = .{ .children = children } }, span.start, span.end);
}

/// css-tree's `MediaQuery`: a media type with an optional modifier and condition, or a condition.
pub fn query(p: *Parser) ParseError!NodeIndex {
    const start = p.start;
    p.skipSC();
    var modifier: ast.MediaModifier = .none;
    var media_type: String = .none;
    var condition: NodeIndex = .null;
    if (p.tag == .ident and atrule.lookupTypeNonSC(p, 1) != .left_parenthesis) {
        const ident: String = .{ .start = p.start, .end = p.end };
        p.next();
        const text = p.src[ident.start..ident.end];
        if (std.ascii.eqlIgnoreCase(text, "not") or std.ascii.eqlIgnoreCase(text, "only")) {
            p.skipSC();
            modifier = if ((text[0] | 0x20) == 'n') .not else .only;
            media_type = try p.consume(.ident);
        } else {
            media_type = ident;
        }
        try reserved(p, media_type);
        switch (atrule.lookupTypeNonSC(p, 0)) {
            .ident => {
                p.skipSC();
                try atrule.eatIdent(p, "and", .and_expected);
                condition = try conditions.condition(p, .media, .without_or);
            },
            .left_curly_bracket, .semicolon, .comma, .eof => {},
            else => return p.fail(.identifier_or_parenthesis_expected, null),
        }
    } else switch (p.tag) {
        .ident, .left_parenthesis, .function => {
            condition = try conditions.condition(p, .media, .full);
        },
        .left_curly_bracket, .semicolon, .eof => {},
        else => return p.fail(.identifier_or_parenthesis_expected, null),
    }
    std.debug.assert(start <= p.start);
    const data: ast.NodeData = .{ .media_query = .{
        .modifier = modifier,
        .media_type = media_type,
        .condition = condition,
    } };
    return p.add(data, start, p.start);
}

// <media-type> excludes `only`, `not`, `and`, `or` and `layer` (mediaqueries-4 §3)
fn reserved(p: *Parser, media_type: String) parser.Error!void {
    std.debug.assert(media_type.start < media_type.end);
    const text = p.src[media_type.start..media_type.end];
    const words = [_][]const u8{ "only", "not", "and", "or", "layer" };
    for (words) |word| {
        if (!std.ascii.eqlIgnoreCase(text, word)) continue;
        try p.specError(.media_type_expected, media_type.start, media_type.end);
        return;
    }
    std.debug.assert(text.len > 0);
}

test "reads media queries" {
    const source = "@media only screen and (color), (min-width: 1px) and (max-width: 2px) {}";
    var tree = try parser.parse(std.testing.allocator, source, .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const prelude = tree.data(at.prelude).atrule_prelude;
    const list_node = tree.data(tree.extra(prelude.children)[0]).media_query_list;
    const queries = tree.extra(list_node.children);
    try std.testing.expectEqual(2, queries.len);
    const first = tree.data(queries[0]).media_query;
    try std.testing.expectEqual(ast.MediaModifier.only, first.modifier);
    try std.testing.expectEqualStrings("screen", tree.string(first.media_type));
    const second = tree.data(queries[1]).media_query;
    try std.testing.expectEqual(String.none.start, second.media_type.start);
}

test "reports what the media query grammar rejects" {
    const cases = .{
        .{ "@media screen (color) {}", ast.Message.parenthesized_condition_expected },
        .{ "@media screen and (a) or (b) {}", ast.Message.or_after_media_type },
        .{ "@media not and {}", ast.Message.media_type_expected },
        .{ "@media (a) and (b) or (c) {}", ast.Message.and_or_mixed },
        .{ "@media foo screen {}", ast.Message.and_expected },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(1, tree.diagnostics.items.len);
        try std.testing.expectEqual(case[1], tree.diagnostics.items[0].message);
    }
}
