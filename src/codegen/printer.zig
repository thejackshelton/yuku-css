// css-tree's generate over the Zig tree: the same text, byte for byte, as src/codegen/printer.ts
// and output.ts write from the decoded one

const std = @import("std");
const ast = @import("../ast.zig");
const token = @import("../token.zig");
const lexer = @import("../lexer.zig");
const parser = @import("../parser.zig");
const sourcemap = @import("sourcemap.zig");

const Allocator = std.mem.Allocator;
const Tag = token.Tag;
const Tree = ast.Tree;
const NodeIndex = ast.NodeIndex;
const NodeData = ast.NodeData;
const IndexRange = ast.IndexRange;

/// Where spaces go between tokens.
pub const Mode = enum {
    /// Also where old browsers misread the pair, as css-tree does by default.
    safe,
    /// Only where the CSS Syntax needs one for the text to read back the same.
    spec,
};

pub const Options = struct {
    mode: Mode = .safe,
    /// Map where each at-rule, selector and declaration starts, as css-tree's generate does.
    source_map: bool = false,
};

pub const Error = Allocator.Error;

/// Prints `tree` to the end of `code`, and with `options.source_map` the map's `mappings` to the
/// end of `mappings`. Returns whether the map names the source.
pub fn generate(
    gpa: Allocator,
    tree: *const Tree,
    options: Options,
    code: *std.ArrayList(u8),
    mappings: *std.ArrayList(u8),
) Error!bool {
    std.debug.assert(tree.root != .null);
    var p: Printer = .{
        .gpa = gpa,
        .tree = tree,
        .data = tree.nodes.items(.data),
        .spans = tree.nodes.items(.span),
        .extras = tree.extras.items,
        .code = code,
        .base = @intCast(code.items.len),
        .spaced = switch (options.mode) {
            .safe => &safe,
            .spec => &spec,
        },
    };
    if (options.source_map) p.map = sourcemap.Tracker.init(tree.source);
    defer if (p.map) |*map| map.mappings.deinit(gpa);
    defer p.scratch.deinit(gpa);
    try code.ensureUnusedCapacity(gpa, tree.source.len + slack);
    try p.node(tree.root, 0);
    std.debug.assert(p.code.items.len >= p.base);
    const map = if (p.map) |*map| map else return false;
    try map.finish(gpa, mappings);
    return map.sourced();
}

// spare bytes a token may write past what was reserved for it
const slack = 64;

// css-tree's trees nest a few nodes per level the parser counts
const depth_max = 8 * parser.max_depth;

// a token's kind: its tag, or for a delim 32 plus its character, 160 for a byte past ASCII
const Kind = u8;
const non_ascii: Kind = 160;

inline fn tagKind(tag: Tag) Kind {
    return @backingInt(tag);
}

inline fn delimKind(c: u8) Kind {
    return if (c < 0x80) 32 + c else non_ascii;
}

// css-tree's token-before.js, as bits: what may follow a kind unspaced is a mask of the kinds after
const next_kinds = [_]Kind{
    tagKind(.ident), tagKind(.function),         tagKind(.url),        tagKind(.bad_url),
    delimKind('-'),  tagKind(.number),           tagKind(.percentage), tagKind(.dimension),
    tagKind(.cdc),   tagKind(.left_parenthesis), delimKind('%'),       delimKind('*'),
    tagKind(.hash),  tagKind(.string),           tagKind(.colon),
};

const next_bit: [256]u16 = blk: {
    var t: [256]u16 = @splat(0);
    for (next_kinds, 0..) |kind, i| t[kind] = 1 << i;
    break :blk t;
};

fn mask(comptime kinds: []const Kind) u16 {
    comptime {
        var bits: u16 = 0;
        for (kinds) |kind| {
            std.debug.assert(next_bit[kind] != 0);
            bits |= next_bit[kind];
        }
        return bits;
    }
}

const spec: [256]u16 = blk: {
    var t: [256]u16 = @splat(0);
    const words = mask(&.{
        tagKind(.ident), tagKind(.function), tagKind(.url),        tagKind(.bad_url),
        delimKind('-'),  tagKind(.number),   tagKind(.percentage), tagKind(.dimension),
        tagKind(.cdc),
    });
    for ([_]Kind{
        tagKind(.ident), tagKind(.at_keyword), tagKind(.hash), tagKind(.dimension),
        delimKind('#'),  delimKind('-'),
    }) |prev| t[prev] |= words;
    t[tagKind(.ident)] |= mask(&.{tagKind(.left_parenthesis)});
    t[tagKind(.number)] |= mask(&.{
        tagKind(.ident),     tagKind(.function), tagKind(.url),
        tagKind(.bad_url),   tagKind(.number),   tagKind(.percentage),
        tagKind(.dimension), delimKind('%'),     tagKind(.cdc),
    });
    t[delimKind('@')] |= mask(&.{
        tagKind(.ident), tagKind(.function), tagKind(.url), tagKind(.bad_url), delimKind('-'),
        tagKind(.cdc),
    });
    const numbers = mask(&.{ tagKind(.number), tagKind(.percentage), tagKind(.dimension) });
    t[delimKind('.')] |= numbers;
    t[delimKind('+')] |= numbers;
    t[delimKind('/')] |= mask(&.{delimKind('*')});
    break :blk t;
};

const safe: [256]u16 = blk: {
    var t = spec;
    t[tagKind(.ident)] |= mask(&.{tagKind(.hash)});
    t[tagKind(.dimension)] |= mask(&.{tagKind(.hash)});
    t[tagKind(.hash)] |= mask(&.{tagKind(.hash)});
    t[tagKind(.at_keyword)] |= mask(&.{
        tagKind(.left_parenthesis), tagKind(.string), tagKind(.colon),
    });
    t[tagKind(.percentage)] |= mask(&.{
        tagKind(.percentage), tagKind(.dimension), tagKind(.function), delimKind('-'),
    });
    t[tagKind(.right_parenthesis)] |= mask(&.{
        tagKind(.ident),     tagKind(.function), tagKind(.percentage),
        tagKind(.dimension), tagKind(.hash),     delimKind('-'),
    });
    break :blk t;
};

// the bytes a string or a url writes otherwise than as they are
const string_special: [256]bool = blk: {
    var t: [256]bool = @splat(false);
    for (0..0x20) |c| t[c] = true;
    t[0x7F] = true;
    t['"'] = true;
    t['\\'] = true;
    break :blk t;
};

const url_special: [256]bool = blk: {
    var t: [256]bool = @splat(false);
    for (0..0x20) |c| t[c] = true;
    t[0x7F] = true;
    for (" \\\"'()") |c| t[c] = true;
    break :blk t;
};

const replacement = "\u{FFFD}";

// the token a byte alone lexes as, eof for a backslash, which a line break follows
const lone_tag: [256]Tag = blk: {
    @setEvalBranchQuota(100_000);
    var t: [256]Tag = undefined;
    for (0..256) |c| {
        const text = [_]u8{c};
        var l: lexer.Lexer = .init(&text);
        t[c] = l.next();
        std.debug.assert(l.pos == 1);
        if (c == '\\') t[c] = .eof;
    }
    break :blk t;
};

const Separator = enum { none, commas, semicolons };

const Printer = struct {
    gpa: Allocator,
    tree: *const Tree,
    data: []const NodeData,
    spans: []const ast.Span,
    extras: []const NodeIndex,
    code: *std.ArrayList(u8),
    // where this text starts in `code`, which the map counts from
    base: u32,
    spaced: *const [256]u16,
    prev: Kind = 0,
    map: ?sourcemap.Tracker = null,
    scratch: std.ArrayList(u8) = .empty,

    fn node(p: *Printer, index: NodeIndex, depth: u32) Error!void {
        std.debug.assert(depth < depth_max);
        const i = @backingInt(index);
        std.debug.assert(i < p.data.len);
        const next = depth + 1;
        switch (p.data[i]) {
            .style_sheet => |n| try p.children(n.children, .none, next),
            .comment => |n| {
                try p.begin(.comment, '/');
                try p.write("/*");
                try p.write(p.string(n.value));
                try p.write("*/");
            },
            .cdo => try p.token(.cdo, "<!--"),
            .cdc => try p.token(.cdc, "-->"),
            .atrule => |n| {
                try p.enter(i);
                try p.begin(.at_keyword, '@');
                try p.write("@");
                try p.write(p.string(n.name));
                if (n.prelude != .null) try p.node(n.prelude, next);
                if (n.block != .null) try p.node(n.block, next) else try p.token(.semicolon, ";");
                p.leave();
            },
            .rule => |n| {
                try p.node(n.prelude, next);
                try p.node(n.block, next);
            },
            .block => |n| {
                try p.token(.left_curly_bracket, "{");
                try p.children(n.children, .semicolons, next);
                try p.token(.right_curly_bracket, "}");
            },
            .declaration_list => |n| try p.children(n.children, .semicolons, next),
            .declaration => |n| {
                try p.enter(i);
                try p.token(.ident, p.string(n.property));
                try p.token(.colon, ":");
                try p.node(n.value, next);
                // css-tree prints `important` when it is true or a word, not an empty one
                const important = p.optional(n.important);
                if (important.len > 0) {
                    try p.token(.delim, "!");
                    try p.token(.ident, important);
                }
                p.leave();
            },
            .raw => |n| try p.tokenize(p.string(n.value)),
            .selector_list => |n| try p.children(n.children, .commas, next),
            .selector => |n| {
                try p.enter(i);
                try p.children(n.children, .none, next);
                p.leave();
            },
            .type_selector => |n| try p.tokenize(p.string(n.name)),
            .id_selector => |n| {
                // a delim, not a hash, so that `a#id` stays unspaced in safe mode
                try p.begin(.delim, '#');
                try p.write("#");
                try p.write(p.string(n.name));
            },
            .class_selector => |n| {
                try p.token(.delim, ".");
                try p.token(.ident, p.string(n.name));
            },
            .attribute_selector => |n| {
                try p.token(.delim, "[");
                try p.node(n.name, next);
                if (ast.Matcher.strings[@backingInt(n.matcher)]) |matcher| {
                    try p.delims(matcher);
                    try p.node(n.value, next);
                }
                if (n.flags.start != ast.String.none.start) try p.token(.ident, p.string(n.flags));
                try p.token(.delim, "]");
            },
            .pseudo_class_selector => |n| {
                try p.token(.colon, ":");
                try p.pseudo(n.name, n.children, next);
            },
            .pseudo_element_selector => |n| {
                try p.token(.colon, ":");
                try p.token(.colon, ":");
                try p.pseudo(n.name, n.children, next);
            },
            .nesting_selector => try p.token(.delim, "&"),
            .combinator => |n| try p.tokenize(p.string(n.name)),
            .nth => |n| {
                try p.node(n.nth, next);
                if (n.selector != .null) {
                    try p.token(.ident, "of");
                    try p.node(n.selector, next);
                }
            },
            .an_plus_b => |n| try p.anPlusB(n.a, n.b),
            .identifier => |n| try p.token(.ident, p.string(n.name)),
            .string => |n| try p.quoted(p.string(n.value)),
            .percentage => |n| {
                const value = p.string(n.value);
                try p.begin(.percentage, if (value.len > 0) value[0] else '%');
                try p.write(value);
                try p.write("%");
            },
            .operator => |n| try p.tokenize(p.string(n.value)),
            .value => |n| try p.children(n.children, .none, next),
            .number => |n| try p.token(.number, p.string(n.value)),
            .dimension => |n| {
                const value = p.string(n.value);
                const unit = p.string(n.unit);
                try p.begin(.dimension, first(if (value.len > 0) value else unit));
                try p.write(value);
                try p.write(unit);
            },
            .hash => |n| {
                try p.begin(.hash, '#');
                try p.write("#");
                try p.write(p.string(n.value));
            },
            .url => |n| try p.url(p.string(n.value)),
            .function => |n| try p.call(p.string(n.name), n.children, next),
            .parentheses => |n| {
                try p.token(.left_parenthesis, "(");
                try p.children(n.children, .none, next);
                try p.token(.right_parenthesis, ")");
            },
            .brackets => |n| {
                try p.token(.delim, "[");
                try p.children(n.children, .none, next);
                try p.token(.delim, "]");
            },
            .unicode_range => |n| try p.tokenize(p.string(n.value)),
            .ratio => |n| {
                try p.node(n.left, next);
                try p.token(.delim, "/");
                // css-tree throws here, calling `this.node(NumberToken, 1)` where it means a token
                if (n.right != .null) try p.node(n.right, next) else try p.token(.number, "1");
            },
            .white_space => |n| try p.token(.whitespace, p.string(n.value)),
            .atrule_prelude => |n| try p.children(n.children, .none, next),
            .media_query_list => |n| try p.children(n.children, .commas, next),
            .media_query => |n| {
                const media_type = p.optional(n.media_type);
                if (media_type.len > 0) {
                    if (ast.MediaModifier.strings[@backingInt(n.modifier)]) |modifier| {
                        try p.token(.ident, modifier);
                    }
                    try p.token(.ident, media_type);
                    if (n.condition != .null) {
                        try p.token(.ident, "and");
                        try p.node(n.condition, next);
                    }
                } else if (n.condition != .null) {
                    try p.node(n.condition, next);
                }
            },
            .condition => |n| for (p.tree.extra(n.children)) |child| {
                if (p.data[@backingInt(child)] == .condition) {
                    try p.parenthesized(child, next);
                } else {
                    try p.node(child, next);
                }
            },
            .feature => |n| {
                try p.token(.left_parenthesis, "(");
                try p.token(.ident, p.string(n.name));
                if (n.value != .null) {
                    try p.token(.colon, ":");
                    try p.node(n.value, next);
                }
                try p.token(.right_parenthesis, ")");
            },
            .feature_function => |n| {
                const feature = p.string(n.feature);
                try p.begin(.function, if (feature.len > 0) feature[0] else '(');
                try p.write(feature);
                try p.write("(");
                try p.node(n.value, next);
                try p.token(.right_parenthesis, ")");
            },
            .feature_range => |n| {
                try p.token(.left_parenthesis, "(");
                try p.node(n.left, next);
                try p.comparison(n.left_comparison);
                try p.node(n.middle, next);
                if (n.right != .null) {
                    try p.comparison(n.right_comparison);
                    try p.node(n.right, next);
                }
                try p.token(.right_parenthesis, ")");
            },
            .general_enclosed => |n| {
                const function = p.optional(n.function);
                if (function.len > 0) return p.call(function, n.children, next);
                try p.token(.left_parenthesis, "(");
                try p.children(n.children, .none, next);
                try p.token(.right_parenthesis, ")");
            },
            .supports_declaration => |n| try p.parenthesized(n.declaration, next),
            .layer => |n| try p.tokenize(p.string(n.name)),
            .layer_list => |n| try p.children(n.children, .commas, next),
            .scope => |n| {
                if (n.root != .null) try p.parenthesized(n.root, next);
                if (n.limit != .null) {
                    try p.token(.ident, "to");
                    try p.parenthesized(n.limit, next);
                }
            },
        }
    }

    fn children(
        p: *Printer,
        range: IndexRange,
        comptime separator: Separator,
        depth: u32,
    ) Error!void {
        std.debug.assert(range.start != IndexRange.none.start);
        const items = p.tree.extra(range);
        std.debug.assert(items.len == range.len);
        for (items, 0..) |child, i| {
            if (i > 0) switch (separator) {
                .none => {},
                .commas => try p.token(.comma, ","),
                .semicolons => if (p.data[@backingInt(items[i - 1])] == .declaration) {
                    try p.token(.semicolon, ";");
                },
            };
            try p.node(child, depth);
        }
    }

    fn parenthesized(p: *Printer, index: NodeIndex, depth: u32) Error!void {
        std.debug.assert(index != .null);
        std.debug.assert(depth < depth_max);
        try p.token(.left_parenthesis, "(");
        try p.node(index, depth);
        try p.token(.right_parenthesis, ")");
    }

    fn comparison(p: *Printer, value: ast.Comparison) Error!void {
        const text = ast.Comparison.strings[@backingInt(value)] orelse return;
        try p.delims(text);
    }

    // what `tokenize` writes for an operator of delims, as each matcher and comparison is
    fn delims(p: *Printer, text: []const u8) Error!void {
        std.debug.assert(text.len > 0 and text.len <= 2);
        std.debug.assert(text[0] != '\\' and text[text.len - 1] != '\\');
        try p.begin(.delim, text[0]);
        try p.write(text);
        p.prev = delimKind(text[text.len - 1]);
    }

    fn pseudo(p: *Printer, name: ast.String, list: IndexRange, depth: u32) Error!void {
        std.debug.assert(name.start != ast.String.none.start);
        std.debug.assert(depth < depth_max);
        if (list.start == IndexRange.none.start) return p.token(.ident, p.string(name));
        try p.call(p.string(name), list, depth);
    }

    fn call(p: *Printer, name: []const u8, list: IndexRange, depth: u32) Error!void {
        std.debug.assert(list.start != IndexRange.none.start);
        std.debug.assert(depth < depth_max);
        try p.begin(.function, if (name.len > 0) name[0] else '(');
        try p.write(name);
        try p.write("(");
        try p.children(list, .none, depth);
        try p.token(.right_parenthesis, ")");
    }

    fn anPlusB(p: *Printer, a_id: ast.String, b_id: ast.String) Error!void {
        const a = p.optional(a_id);
        const b = p.optional(b_id);
        if (a.len == 0) return p.tokenize(b);
        const n = if (std.mem.eql(u8, a, "+1") or std.mem.eql(u8, a, "1"))
            "n"
        else if (std.mem.eql(u8, a, "-1"))
            "-n"
        else
            a;
        const scratch = &p.scratch;
        scratch.clearRetainingCapacity();
        try scratch.appendSlice(p.gpa, n);
        if (n.ptr == a.ptr) try scratch.append(p.gpa, 'n');
        if (b.len > 0) {
            if (b[0] != '-' and b[0] != '+') try scratch.append(p.gpa, '+');
            try scratch.appendSlice(p.gpa, b);
        }
        std.debug.assert(scratch.items.len > a.len);
        std.debug.assert(scratch.items.len <= a.len + 2 + b.len);
        try p.tokenize(scratch.items);
    }

    inline fn string(p: *const Printer, id: ast.String) []const u8 {
        return p.tree.string(id);
    }

    inline fn optional(p: *const Printer, id: ast.String) []const u8 {
        return if (id.start == ast.String.none.start) "" else p.tree.string(id);
    }

    inline fn enter(p: *Printer, index: u32) Error!void {
        const map = if (p.map) |*map| map else return;
        try map.enter(p.gpa, p.code.items[p.base..], p.spans[index].start);
    }

    inline fn leave(p: *Printer) void {
        const map = if (p.map) |*map| map else return;
        map.leave(p.code.items[p.base..]);
    }

    /// Spaces a token of `tag` whose text starts with `c` from the one before, as css-tree does.
    inline fn begin(p: *Printer, tag: Tag, c: u8) Error!void {
        std.debug.assert(tag != .delim or c != '\\');
        const kind = if (tag == .delim) delimKind(c) else tagKind(tag);
        const before = p.prev;
        p.prev = kind;
        if (p.spaced[before] & next_bit[lookupKind(tag, c, kind)] != 0) try p.write(" ");
    }

    inline fn token(p: *Printer, tag: Tag, text: []const u8) Error!void {
        std.debug.assert(tag != .delim or text.len > 0);
        try p.begin(tag, first(text));
        try p.write(text);
    }

    // css-tree's `tokenize`: writes `raw` as it is, spaced only from what comes before it, with a
    // line break after a lone backslash
    fn tokenize(p: *Printer, raw: []const u8) Error!void {
        // a combinator is one byte, and so one token
        if (raw.len == 1 and lone_tag[raw[0]] != .eof) return p.token(lone_tag[raw[0]], raw);
        if (isIdent(raw)) return p.token(.ident, raw);
        var l: lexer.Lexer = .init(raw);
        var start = l.pos;
        if (start >= raw.len) return;
        var tag = l.next();
        if (start == 0) {
            const kind = if (tag == .delim) delimKind(raw[0]) else tagKind(tag);
            if (p.spaced[p.prev] & next_bit[lookupKind(tag, raw[0], kind)] != 0) try p.write(" ");
        }
        std.debug.assert(start < raw.len);
        std.debug.assert(l.pos > start);
        var from = start;
        var tokens: u32 = 0;
        while (true) : (tokens += 1) {
            std.debug.assert(tokens <= raw.len);
            if (tag == .delim and raw[start] == '\\') {
                try p.write(raw[from..l.pos]);
                try p.write("\n");
                from = l.pos;
            }
            if (l.pos >= raw.len) break;
            start = l.pos;
            tag = l.next();
        }
        if (from < raw.len) try p.write(raw[from..]);
        p.prev = if (tag == .delim) delimKind(raw[start]) else tagKind(tag);
    }

    // CSSOM's "serialize a string", in double quotes
    fn quoted(p: *Printer, value: []const u8) Error!void {
        try p.begin(.string, '"');
        try p.write("\"");
        var from: u32 = 0;
        var hex_escaped = false;
        for (value, 0..) |c, at| {
            const i: u32 = @intCast(at);
            if (!string_special[c]) {
                // a hex digit or space after a hex escape would read as part of it
                if (hex_escaped and (std.ascii.isHex(c) or c == ' ')) {
                    try p.write(value[from..i]);
                    try p.write(" ");
                    from = i;
                }
                hex_escaped = false;
                continue;
            }
            try p.write(value[from..i]);
            from = i + 1;
            if (c == 0) {
                try p.write(replacement);
            } else if (c == '"' or c == '\\') {
                try p.write("\\");
                from = i;
                hex_escaped = false;
            } else {
                try p.hexEscape(c);
                hex_escaped = true;
            }
        }
        std.debug.assert(from <= value.len);
        std.debug.assert(p.prev == tagKind(.string));
        try p.write(value[from..]);
        try p.write("\"");
    }

    // an unquoted `url()`
    fn url(p: *Printer, value: []const u8) Error!void {
        try p.begin(.url, 'u');
        try p.write("url(");
        var from: u32 = 0;
        var hex_escaped = false;
        for (value, 0..) |c, at| {
            const i: u32 = @intCast(at);
            if (!url_special[c]) {
                if (hex_escaped and std.ascii.isHex(c)) {
                    try p.write(value[from..i]);
                    try p.write(" ");
                    from = i;
                }
                hex_escaped = false;
                continue;
            }
            try p.write(value[from..i]);
            from = i + 1;
            if (c == 0) {
                try p.write(replacement);
            } else if (c >= 0x20 and c != 0x7F) {
                try p.write("\\");
                from = i;
                hex_escaped = false;
            } else {
                try p.hexEscape(c);
                hex_escaped = true;
            }
        }
        std.debug.assert(from <= value.len);
        std.debug.assert(p.prev == tagKind(.url));
        try p.write(value[from..]);
        try p.write(")");
    }

    fn hexEscape(p: *Printer, c: u8) Error!void {
        std.debug.assert(c < 0x20 or c == 0x7F);
        const digits = "0123456789abcdef";
        if (c < 0x10) {
            try p.write(&.{ '\\', digits[c] });
        } else {
            try p.write(&.{ '\\', digits[c >> 4], digits[c & 0xF] });
        }
    }

    inline fn write(p: *Printer, text: []const u8) Error!void {
        const code = p.code;
        if (code.capacity - code.items.len < text.len) try p.grow(text.len);
        const at = code.items.len;
        std.debug.assert(code.capacity - at >= text.len);
        code.items.len = at + text.len;
        copy(code.items.ptr + at, text);
    }

    noinline fn grow(p: *Printer, additional: usize) Error!void {
        @branchHint(.cold);
        std.debug.assert(p.code.capacity - p.code.items.len < additional);
        try p.code.ensureUnusedCapacity(p.gpa, @max(additional, p.code.capacity / 2));
        std.debug.assert(p.code.capacity - p.code.items.len >= additional);
    }
};

// a name that lexes as one ident token, as a type selector's mostly does
inline fn isIdent(raw: []const u8) bool {
    if (raw.len == 0 or raw[0] == '-' or !lexer.identStart(raw[0], 0, 0)) return false;
    for (raw[1..]) |c| {
        if (!lexer.isName(c)) return false;
    }
    return true;
}

// the kind the pair table is read with: a `-` or `+` that starts a number reads as the delim
inline fn lookupKind(tag: Tag, c: u8, kind: Kind) Kind {
    const signed = c == '+' or (c == '-' and tag != .ident and tag != .function and tag != .cdc);
    return if (signed) delimKind(c) else kind;
}

// most tokens are short, and baseline wasm calls out of line for a `@memcpy` of unknown length
inline fn copy(target: [*]u8, text: []const u8) void {
    const n = text.len;
    if (n > 16) {
        @memcpy(target[0..n], text);
    } else if (n >= 8) {
        copyOverlapping(u64, target, text);
    } else if (n >= 4) {
        copyOverlapping(u32, target, text);
    } else if (n > 0) {
        target[0] = text[0];
        target[n >> 1] = text[n >> 1];
        target[n - 1] = text[n - 1];
    }
}

// two words that overlap in the middle cover any length from one word to two
inline fn copyOverlapping(comptime Word: type, target: [*]u8, text: []const u8) void {
    const width = @sizeOf(Word);
    std.debug.assert(text.len >= width);
    std.debug.assert(text.len <= 2 * width);
    const head: Word = @bitCast(text[0..width].*);
    const tail: Word = @bitCast(text[text.len - width ..][0..width].*);
    target[0..width].* = @bitCast(head);
    target[text.len - width ..][0..width].* = @bitCast(tail);
}

inline fn first(text: []const u8) u8 {
    return if (text.len > 0) text[0] else 0;
}

fn expectGenerate(source: []const u8, options: Options, expected: []const u8) !void {
    const gpa = std.testing.allocator;
    var tree = try parser.parse(gpa, source, .{});
    defer tree.deinit();
    var code: std.ArrayList(u8) = .empty;
    defer code.deinit(gpa);
    var mappings: std.ArrayList(u8) = .empty;
    defer mappings.deinit(gpa);
    _ = try generate(gpa, &tree, options, &code, &mappings);
    try std.testing.expectEqualStrings(expected, code.items);
}

test "prints css-tree's compact text" {
    try expectGenerate(".a { color: red; }", .{}, ".a{color:red}");
    try expectGenerate(
        "a  >  b , c d { x: 1px  2% #fff !important }",
        .{},
        "a>b,c d{x:1px 2%#fff!important}",
    );
    try expectGenerate("@media (x) { a { b: url( x.png ) } }", .{}, "@media (x){a{b:url(x.png)}}");
    try expectGenerate("a { content: \"\\\"\\a b\" }", .{}, "a{content:\"\\\"\\a b\"}");
    try expectGenerate("li:nth-child( 2n + 1 of .x ) {}", .{}, "li:nth-child(2n+1 of.x){}");
}

test "spaces as the mode asks" {
    try expectGenerate("@media (x) {}", .{ .mode = .safe }, "@media (x){}");
    try expectGenerate("@media (x) {}", .{ .mode = .spec }, "@media(x){}");
}

test "maps where each selector and declaration starts" {
    const gpa = std.testing.allocator;
    var tree = try parser.parse(gpa, ".a {\n  color: red;\n}\n", .{});
    defer tree.deinit();
    var code: std.ArrayList(u8) = .empty;
    defer code.deinit(gpa);
    var mappings: std.ArrayList(u8) = .empty;
    defer mappings.deinit(gpa);
    try std.testing.expect(try generate(gpa, &tree, .{ .source_map = true }, &code, &mappings));
    try std.testing.expectEqualStrings(".a{color:red}", code.items);
    try std.testing.expectEqualStrings("AAAA,E,CACE,S", mappings.items);
}
