// CSS Syntax Level 3 tokenization, with css-tree's choices where the spec leaves room: comments are
// tokens, and a bad string keeps the newline that ends it

const std = @import("std");
const token = @import("token.zig");

const Tag = token.Tag;
const Allocator = std.mem.Allocator;

const name_start: u8 = 1 << 0;
const name: u8 = 1 << 1;
const digit: u8 = 1 << 2;
const hex: u8 = 1 << 3;
const space: u8 = 1 << 4;
const newline: u8 = 1 << 5;
const non_printable: u8 = 1 << 6;

// every byte of a multi-byte character is a name byte, as every non-ASCII code point is
const char: [256]u8 = blk: {
    @setEvalBranchQuota(10_000);
    var t: [256]u8 = @splat(0);
    for (0..256) |c| {
        if (std.ascii.isAlphabetic(c) or c == '_' or c >= 0x80) t[c] |= name_start | name;
        if (std.ascii.isDigit(c)) t[c] |= digit | hex | name;
        if (std.ascii.isHex(c)) t[c] |= hex;
        if (c <= 0x08 or c == 0x0B or (c >= 0x0E and c <= 0x1F) or c == 0x7F) t[c] |= non_printable;
    }
    t['-'] |= name;
    for (" \t\n\r\x0C") |c| t[c] |= space;
    for ("\n\r\x0C") |c| t[c] |= newline;
    break :blk t;
};

inline fn is(c: u8, comptime bits: u8) bool {
    return char[c] & bits != 0;
}

const Class = enum(u8) {
    delim,
    simple,
    whitespace,
    name,
    digit,
    quote,
    hash,
    plus,
    minus,
    dot,
    slash,
    less,
    at,
    backslash,
};

const simple_tag: [256]Tag = blk: {
    var t: [256]Tag = @splat(.eof);
    t['('] = .left_parenthesis;
    t[')'] = .right_parenthesis;
    t[','] = .comma;
    t[':'] = .colon;
    t[';'] = .semicolon;
    t['['] = .left_square_bracket;
    t[']'] = .right_square_bracket;
    t['{'] = .left_curly_bracket;
    t['}'] = .right_curly_bracket;
    break :blk t;
};

const class: [256]Class = blk: {
    @setEvalBranchQuota(10_000);
    var t: [256]Class = @splat(.delim);
    for (0..256) |c| {
        if (simple_tag[c] != .eof) t[c] = .simple;
        if (is(c, name_start)) t[c] = .name;
        if (is(c, digit)) t[c] = .digit;
        if (is(c, space)) t[c] = .whitespace;
    }
    t['"'] = .quote;
    t['\''] = .quote;
    t['#'] = .hash;
    t['+'] = .plus;
    t['-'] = .minus;
    t['.'] = .dot;
    t['/'] = .slash;
    t['<'] = .less;
    t['@'] = .at;
    t['\\'] = .backslash;
    break :blk t;
};

// the bytes that end a run of plain string content
const string_stop: [256]bool = blk: {
    var t: [256]bool = @splat(false);
    for ("\"'\\\n\r\x0C") |c| t[c] = true;
    break :blk t;
};

pub const Lexer = struct {
    src: []const u8,
    pos: u32,

    pub fn init(src: []const u8) Lexer {
        std.debug.assert(src.len < std.math.maxInt(u32));
        return .{ .src = src, .pos = bomLen(src) };
    }

    inline fn at(l: *const Lexer, i: u32) u8 {
        return if (i < l.src.len) l.src[i] else 0;
    }

    /// Scans the token at `pos`, which is before the end, and returns its tag.
    pub inline fn next(l: *Lexer) Tag {
        const c = l.src[l.pos];
        switch (class[c]) {
            .simple => {
                l.pos += 1;
                return simple_tag[c];
            },
            .whitespace => {
                l.pos = l.whitespaceEnd(l.pos + 1);
                return .whitespace;
            },
            .name => return l.identLike(),
            .digit => return l.numeric(),
            .delim => {
                l.pos += 1;
                return .delim;
            },
            else => return l.nextSlow(c),
        }
    }

    fn nextSlow(l: *Lexer, c: u8) Tag {
        const i = l.pos;
        switch (class[c]) {
            .quote => return l.string(c),
            .hash => {
                if (is(l.at(i + 1), name) or validEscape(l.at(i + 1), l.at(i + 2))) {
                    l.pos = l.nameEnd(i + 1);
                    return .hash;
                }
            },
            .plus, .dot => if (numberStart(c, l.at(i + 1), l.at(i + 2))) return l.numeric(),
            .minus => {
                if (numberStart(c, l.at(i + 1), l.at(i + 2))) return l.numeric();
                if (l.at(i + 1) == '-' and l.at(i + 2) == '>') {
                    l.pos += 3;
                    return .cdc;
                }
                if (identStart(c, l.at(i + 1), l.at(i + 2))) return l.identLike();
            },
            .slash => if (l.at(i + 1) == '*') {
                const close = std.mem.findPos(u8, l.src, i + 2, "*/");
                l.pos = if (close) |offset| @intCast(offset + 2) else @intCast(l.src.len);
                return .comment;
            },
            .less => if (l.at(i + 1) == '!' and l.at(i + 2) == '-' and l.at(i + 3) == '-') {
                l.pos += 4;
                return .cdo;
            },
            .at => if (identStart(l.at(i + 1), l.at(i + 2), l.at(i + 3))) {
                l.pos = l.nameEnd(i + 1);
                return .at_keyword;
            },
            .backslash => if (validEscape(c, l.at(i + 1))) return l.identLike(),
            else => unreachable,
        }
        l.pos += 1;
        return .delim;
    }

    fn identLike(l: *Lexer) Tag {
        const start = l.pos;
        l.pos = l.nameEnd(start);
        if (l.at(l.pos) != '(') return .ident;
        if (l.pos - start == 3 and std.ascii.eqlIgnoreCase(l.src[start..l.pos], "url")) {
            const value = l.whitespaceEnd(l.pos + 1);
            const first = l.at(value);
            if (first == '"' or first == '\'') {
                l.pos = start + 4;
                return .function;
            }
            l.pos = value;
            return l.url();
        }
        l.pos += 1;
        return .function;
    }

    fn numeric(l: *Lexer) Tag {
        l.pos = l.numberEnd(l.pos);
        const c = l.at(l.pos);
        if (identStart(c, l.at(l.pos + 1), l.at(l.pos + 2))) {
            l.pos = l.nameEnd(l.pos);
            return .dimension;
        }
        if (c == '%') {
            l.pos += 1;
            return .percentage;
        }
        return .number;
    }

    fn string(l: *Lexer, quote: u8) Tag {
        const src = l.src;
        var i = l.pos + 1;
        while (i < src.len) : (i += 1) {
            const c = src[i];
            if (!string_stop[c]) continue;
            if (c == quote) {
                l.pos = i + 1;
                return .string;
            }
            if (is(c, newline)) {
                l.pos = i + newlineLen(src, i);
                return .bad_string;
            }
            if (c == '\\') {
                if (i == src.len - 1) break;
                const after = src[i + 1];
                if (is(after, newline)) {
                    i += newlineLen(src, i + 1);
                } else if (validEscape(c, after)) {
                    i = l.escapeEnd(i) - 1;
                }
            }
        }
        l.pos = @intCast(src.len);
        return .string;
    }

    // `pos` is past `url(` and the whitespace after it
    fn url(l: *Lexer) Tag {
        const src = l.src;
        var i = l.pos;
        while (i < src.len) : (i += 1) {
            const c = src[i];
            if (c == ')') {
                l.pos = i + 1;
                return .url;
            }
            if (is(c, space)) {
                i = l.whitespaceEnd(i);
                if (i >= src.len) {
                    l.pos = i;
                    return .url;
                }
                if (src[i] == ')') {
                    l.pos = i + 1;
                    return .url;
                }
                return l.badUrl(i);
            }
            if (c == '"' or c == '\'' or c == '(' or is(c, non_printable)) return l.badUrl(i);
            if (c == '\\') {
                if (!validEscape(c, l.at(i + 1))) return l.badUrl(i);
                i = l.escapeEnd(i) - 1;
            }
        }
        l.pos = i;
        return .url;
    }

    // css-tree steps one byte past each escape here, and past the end after an escape that ends the source
    fn badUrl(l: *Lexer, from: u32) Tag {
        var i = from;
        while (i < l.src.len) : (i += 1) {
            const c = l.src[i];
            if (c == ')') {
                i += 1;
                break;
            }
            if (validEscape(c, l.at(i + 1))) i = l.escapeEnd(i);
        }
        l.pos = @min(i, @as(u32, @intCast(l.src.len)));
        return .bad_url;
    }

    pub fn nameEnd(l: *const Lexer, from: u32) u32 {
        const src = l.src;
        var i = from;
        while (i < src.len) {
            const c = src[i];
            if (is(c, name)) {
                i += 1;
            } else if (c == '\\' and validEscape(c, l.at(i + 1))) {
                i = l.escapeEnd(i);
            } else break;
        }
        return i;
    }

    /// `from` is the backslash.
    fn escapeEnd(l: *const Lexer, from: u32) u32 {
        var i = from + 2;
        if (is(l.at(i - 1), hex)) {
            const max = @min(l.src.len, i + 5);
            while (i < max and is(l.src[i], hex)) i += 1;
            if (is(l.at(i), space)) i += newlineLen(l.src, i);
        }
        return i;
    }

    pub fn numberEnd(l: *const Lexer, from: u32) u32 {
        var i = from;
        var c = l.at(i);
        if (c == '+' or c == '-') {
            i += 1;
            c = l.at(i);
        }
        if (is(c, digit)) {
            i = l.digitsEnd(i + 1);
            c = l.at(i);
        }
        if (c == '.' and is(l.at(i + 1), digit)) {
            i = l.digitsEnd(i + 2);
        }
        if (l.at(i) | 0x20 == 'e') {
            var sign: u32 = 0;
            c = l.at(i + 1);
            if (c == '-' or c == '+') {
                sign = 1;
                c = l.at(i + 2);
            }
            if (is(c, digit)) i = l.digitsEnd(i + 1 + sign + 1);
        }
        return i;
    }

    fn digitsEnd(l: *const Lexer, from: u32) u32 {
        var i = from;
        while (i < l.src.len and is(l.src[i], digit)) i += 1;
        return i;
    }

    fn whitespaceEnd(l: *const Lexer, from: u32) u32 {
        var i = from;
        while (i < l.src.len and is(l.src[i], space)) i += 1;
        return i;
    }
};

/// U+FEFF, or U+FFFE, as css-tree skips either.
pub fn bomLen(src: []const u8) u32 {
    if (src.len >= 3 and src[0] == 0xEF and
        ((src[1] == 0xBB and src[2] == 0xBF) or (src[1] == 0xBF and src[2] == 0xBE))) return 3;
    return 0;
}

fn newlineLen(src: []const u8, i: u32) u32 {
    return if (src[i] == '\r' and i + 1 < src.len and src[i + 1] == '\n') 2 else 1;
}

pub inline fn validEscape(a: u8, b: u8) bool {
    return a == '\\' and b != 0 and !is(b, newline);
}

pub inline fn identStart(a: u8, b: u8, c: u8) bool {
    if (a == '-') return is(b, name_start) or b == '-' or validEscape(b, c);
    if (is(a, name_start)) return true;
    return validEscape(a, b);
}

inline fn numberStart(a: u8, b: u8, c: u8) bool {
    if (a == '+' or a == '-') return is(b, digit) or (b == '.' and is(c, digit));
    if (a == '.') return is(b, digit);
    return is(a, digit);
}

pub inline fn isDigit(c: u8) bool {
    return is(c, digit);
}

pub inline fn isSpace(c: u8) bool {
    return is(c, space);
}

/// Tokenizes `src` into `tokens`, and when `balance` is given, links each bracket to its partner
/// as css-tree does, one entry a token: for an opener, the index of its closer; for a closer, its
/// opener's; for any other token, the closer of the innermost block around it, or the token count.
pub fn tokenize(gpa: Allocator, tokens: *token.TokenList, balance: ?*std.ArrayList(u32), src: []const u8) Allocator.Error!void {
    var lexer: Lexer = .init(src);
    // the open block's opener, and the tag that closes it
    var open: u32 = std.math.maxInt(u32);
    var closing: Tag = .eof;
    while (lexer.pos < src.len) {
        const tag = lexer.next();
        const index: u32 = @intCast(tokens.items.len);
        const entry: token.Token = .{ .end = lexer.pos, .tag = tag };
        if (tokens.items.len < tokens.capacity) {
            tokens.appendAssumeCapacity(entry);
        } else {
            try tokens.append(gpa, entry);
        }
        const links = balance orelse continue;
        if (links.items.len < links.capacity) {
            links.appendAssumeCapacity(open);
        } else {
            try links.append(gpa, open);
        }
        if (tag == closing) {
            const outer = links.items[open];
            links.items[open] = index;
            open = outer;
            closing = if (outer == std.math.maxInt(u32)) .eof else token.closer[@backingInt(tokens.items[outer].tag)];
        } else if (tag.isBlockOpener()) {
            open = index;
            closing = token.closer[@backingInt(tag)];
        }
    }
    const links = (balance orelse return).items;
    const count: u32 = @intCast(links.len);
    for (links, 0..) |start, i| {
        if (start <= i) {
            const end = links[start];
            if (end != i) links[i] = end;
        } else if (start > count) {
            links[i] = count;
        }
    }
}

fn expectTokens(src: []const u8, expected: []const struct { Tag, []const u8 }) !void {
    var tokens: token.TokenList = .empty;
    defer tokens.deinit(std.testing.allocator);
    try tokenize(std.testing.allocator, &tokens, null, src);
    try std.testing.expectEqual(expected.len, tokens.items.len);
    var start: u32 = bomLen(src);
    for (expected, tokens.items) |want, t| {
        try std.testing.expectEqual(want[0], t.tag);
        try std.testing.expectEqualStrings(want[1], src[start..t.end]);
        start = t.end;
    }
}

test "tokenizes" {
    try expectTokens("a:hover{color:red !important}", &.{
        .{ .ident, "a" },              .{ .colon, ":" },      .{ .ident, "hover" },
        .{ .left_curly_bracket, "{" }, .{ .ident, "color" },  .{ .colon, ":" },
        .{ .ident, "red" },            .{ .whitespace, " " }, .{ .delim, "!" },
        .{ .ident, "important" },      .{ .right_curly_bracket, "}" },
    });
    try expectTokens("url( a.png ) url('b') -1.5e3px 50% .5 #x @m <!-- --> /* c */", &.{
        .{ .url, "url( a.png )" }, .{ .whitespace, " " },    .{ .function, "url(" },
        .{ .string, "'b'" },       .{ .right_parenthesis, ")" }, .{ .whitespace, " " },
        .{ .dimension, "-1.5e3px" }, .{ .whitespace, " " }, .{ .percentage, "50%" },
        .{ .whitespace, " " },     .{ .number, ".5" },       .{ .whitespace, " " },
        .{ .hash, "#x" },          .{ .whitespace, " " },    .{ .at_keyword, "@m" },
        .{ .whitespace, " " },     .{ .cdo, "<!--" },        .{ .whitespace, " " },
        .{ .cdc, "-->" },          .{ .whitespace, " " },    .{ .comment, "/* c */" },
    });
    try expectTokens("\xEF\xBB\xBF\"a\nb", &.{ .{ .bad_string, "\"a\n" }, .{ .ident, "b" } });
}

test "links brackets" {
    var tokens: token.TokenList = .empty;
    defer tokens.deinit(std.testing.allocator);
    var balance: std.ArrayList(u32) = .empty;
    defer balance.deinit(std.testing.allocator);
    try tokenize(std.testing.allocator, &tokens, &balance, "a([b c]d e){");
    try std.testing.expectEqualSlices(u32, &.{ 9, 5, 5, 5, 5, 1, 9, 9, 9, 0, 11 }, balance.items);
}
