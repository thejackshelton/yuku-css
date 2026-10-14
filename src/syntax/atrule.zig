// css-tree's AtrulePrelude, the prelude parser of each at-rule of lib/syntax/atrule, and the
// lookahead and fallback helpers the prelude grammars share

const std = @import("std");
const ast = @import("../ast.zig");
const token = @import("../token.zig");
const parser = @import("../parser.zig");
const lexer = @import("../lexer.zig");
const values = @import("value.zig");
const media_query = @import("media_query.zig");
const conditions = @import("condition.zig");
const container = @import("atrule/container.zig");
const custom_media = @import("atrule/custom_media.zig");
const import_rule = @import("atrule/import.zig");
const layer = @import("atrule/layer.zig");
const scope = @import("atrule/scope.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const Error = parser.Error;
const NodeIndex = ast.NodeIndex;
const Tag = token.Tag;

/// The at-rules whose prelude css-tree reads with a grammar of its own. Any other at-rule's
/// prelude is a sequence of component values.
pub const Atrule = enum(u4) {
    unknown,
    container,
    @"custom-media",
    import,
    layer,
    media,
    nest,
    page,
    scope,
    supports,

    /// The name, as written after `@` in lower case.
    pub fn text(name: Atrule) []const u8 {
        return @tagName(name);
    }

    pub fn fromName(name: []const u8) Atrule {
        return names.get(name) orelse .unknown;
    }
};

const names: std.StaticStringMapWithEql(Atrule, std.static_string_map.eqlAsciiIgnoreCase) = blk: {
    const all = std.enums.values(Atrule);
    var entries: [all.len - 1]struct { []const u8, Atrule } = undefined;
    for (all[1..], &entries) |name, *entry| entry.* = .{ @tagName(name), name };
    break :blk .initComptime(entries);
};

/// css-tree's `AtrulePrelude`, from the token after the at-keyword up to `{`, `;` or the end.
pub fn prelude(p: *Parser, name: Atrule) ParseError!NodeIndex {
    std.debug.assert(p.start <= p.src.len);
    p.skipSC();
    const first = p.tokenStart();
    const children = switch (name) {
        .unknown => try values.sequence(p, .atrule_prelude),
        .container => try container.prelude(p),
        .@"custom-media" => try custom_media.prelude(p),
        .import => try import_rule.prelude(p),
        .layer => try single(p, try layer.list(p)),
        .media => try single(p, try media_query.list(p)),
        .nest, .page => try single(p, try p.selectorList(false)),
        .scope => try single(p, try scope.scope(p)),
        .supports => try single(p, try conditions.condition(p, .supports, .full)),
    };
    p.skipSC();
    if (!p.eof and p.tag != .left_curly_bracket and p.tag != .semicolon) {
        return p.fail(.semicolon_or_block_expected, null);
    }
    std.debug.assert(p.tokenStart() >= first or p.tag == .eof);
    const span = p.spanOfList(children);
    return p.add(.{ .atrule_prelude = .{ .children = children } }, span.start, span.end);
}

pub fn single(p: *Parser, node: NodeIndex) Error!ast.IndexRange {
    std.debug.assert(node != .null);
    const range = try p.tree.addExtra(&.{node});
    std.debug.assert(range.len == 1);
    return range;
}

/// css-tree's `parseWithFallback`: when `consumer` fails, the input is rewound and read by
/// `alternative`, whose own error is not caught, and only then is the first error reported.
pub fn fallback(
    p: *Parser,
    comptime consumer: anytype,
    args: anytype,
    comptime alternative: anytype,
    alternative_args: anytype,
) ParseError!NodeIndex {
    const start = p.checkpoint();
    return @call(.auto, consumer, .{p} ++ args) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => {
            const failure = p.failure;
            p.rewind(start);
            const node = try @call(.auto, alternative, .{p} ++ alternative_args);
            std.debug.assert(node != .null);
            try p.report(failure);
            return node;
        },
    };
}

/// css-tree's `Raw(null, exclude_whitespace)`, up to the end of the enclosing block.
pub fn rawBalanced(p: *Parser, exclude_whitespace: bool) ParseError!NodeIndex {
    std.debug.assert(p.start <= p.src.len);
    const node = try p.raw(.balance_end, exclude_whitespace);
    std.debug.assert(p.tree.data(node) == .raw);
    return node;
}

/// css-tree's `lookupTypeNonSC`: the tag of the `nth` token from the current one that is not
/// whitespace or a comment, counting from 0.
pub fn lookupTypeNonSC(p: *const Parser, nth: u32) Tag {
    std.debug.assert(nth <= 2);
    var left = nth;
    if (p.tag == .eof) return .eof;
    if (p.tag != .whitespace and p.tag != .comment) {
        if (left == 0) return p.tag;
        left -= 1;
    }
    var l: lexer.Lexer = .{ .src = p.src, .pos = p.end };
    while (l.pos < p.src.len) {
        const tag = l.next();
        if (tag == .whitespace or tag == .comment) continue;
        if (left == 0) return tag;
        left -= 1;
    }
    return .eof;
}

/// css-tree's `lookupNonWSType`: the tag of the first token from `offset` past the current one
/// that is not whitespace or a comment.
pub fn lookupNonWSType(p: *const Parser, offset: u32) Tag {
    std.debug.assert(offset <= 1);
    if (p.tag == .eof) return .eof;
    if (offset == 0 and p.tag != .whitespace and p.tag != .comment) return p.tag;
    return nextNonSC(p).tag;
}

/// The first token after the current one that is not whitespace or a comment, and where it starts.
pub fn nextNonSC(p: *const Parser) struct { tag: Tag, start: u32 } {
    std.debug.assert(p.end <= p.src.len);
    var l: lexer.Lexer = .{ .src = p.src, .pos = p.end };
    while (l.pos < p.src.len) {
        const start = l.pos;
        const tag = l.next();
        std.debug.assert(l.pos > start);
        if (tag != .whitespace and tag != .comment) return .{ .tag = tag, .start = start };
    }
    return .{ .tag = .eof, .start = @intCast(p.src.len) };
}

/// Whether the current token is `text`, ignoring ASCII case, as css-tree's `cmpStr` compares.
pub fn isWord(p: *const Parser, comptime text: []const u8) bool {
    std.debug.assert(text.len > 0);
    std.debug.assert(p.start <= p.end);
    return std.ascii.eqlIgnoreCase(p.src[p.start..p.end], text);
}

/// css-tree's `eatIdent`.
pub fn eatIdent(
    p: *Parser,
    comptime name: []const u8,
    comptime message: ast.Message,
) ParseError!void {
    if (p.tag != .ident or !isWord(p, name)) return p.fail(message, null);
    std.debug.assert(p.end - p.start == name.len);
    p.next();
}

test "reads the prelude of each at-rule" {
    const cases = .{
        .{ "@media screen and (min-width: 1px), print {}", ast.Tag.media_query_list },
        .{ "@supports (display: grid) {}", ast.Tag.condition },
        .{ "@container card (width > 1px) {}", ast.Tag.identifier },
        .{ "@import url(a.css) layer(b);", ast.Tag.url },
        .{ "@layer a, b.c;", ast.Tag.layer_list },
        .{ "@scope (.a) to (.b) {}", ast.Tag.scope },
        .{ "@page :first {}", ast.Tag.selector_list },
        .{ "@keyframes k {}", ast.Tag.identifier },
        .{ "@custom-media --a (b);", ast.Tag.identifier },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        const children = tree.extra(tree.data(at.prelude).atrule_prelude.children);
        try std.testing.expectEqual(case[1], std.meta.activeTag(tree.data(children[0])));
    }
}

test "keeps a prelude that does not parse as raw" {
    const cases = .{
        .{ "@media ! {}", ast.Message.identifier_or_parenthesis_expected },
        .{ "@layer a . b;", ast.Message.semicolon_or_block_expected },
        .{ "@import 1;", ast.Message.string_or_url_expected },
        .{ "@supports 1 {}", ast.Message.condition_expected },
        .{ "@custom-media a (b);", ast.Message.extension_name_expected },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(case[1], tree.diagnostics.items[0].message);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        try std.testing.expectEqual(ast.Tag.raw, std.meta.activeTag(tree.data(at.prelude)));
    }
}

test "keeps every prelude raw when asked" {
    const options: parser.Options = .{ .parse_atrule_prelude = false };
    var tree = try parser.parse(std.testing.allocator, "@media x {}", options);
    defer tree.deinit();
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    try std.testing.expectEqual(ast.Tag.raw, std.meta.activeTag(tree.data(at.prelude)));
}
