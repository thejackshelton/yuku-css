// css-tree's component values, the `Value` and `AtrulePrelude` scopes of lib/syntax/scope, the
// value nodes of lib/syntax/node, and the `var()` and `expression()` of lib/syntax/function

const std = @import("std");
const ast = @import("../ast.zig");
const lexer = @import("../lexer.zig");
const parser = @import("../parser.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const Error = parser.Error;
const NodeIndex = ast.NodeIndex;
const String = ast.String;

/// How `sequence` reads component values, after css-tree's scopes.
pub const Scope = enum {
    /// A declaration value: `var()` and `expression()` read their own arguments, and a `+` or `-`
    /// operator keeps one space on each side that has whitespace.
    value,
    /// An at-rule prelude: every function reads a sequence.
    atrule_prelude,
};

/// css-tree's `Value`: the component values up to the first the value scope does not read.
pub fn value(p: *Parser) ParseError!NodeIndex {
    return valueWithSpace(p, null);
}

/// A declaration's value from the current token, after css-tree's `consumeValue`: a `Value`, or a
/// `Raw` up to `!` or `;` when it does not parse. Null when `nested`, not `custom`, and that `Raw`
/// holds a `{}` block, which makes the statement a nested rule (css-syntax-3).
pub fn declarationValue(p: *Parser, custom: bool, value_token: u32, nested: bool) Error!NodeIndex {
    std.debug.assert(value_token <= p.index);
    const start = p.checkpoint();
    const node = declarationValueStrict(p, custom, value_token) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => {
            const failure = p.failure;
            p.rewind(start);
            const raw = try p.rawValue(custom, nested);
            if (raw != .null) try p.report(failure);
            return raw;
        },
    };
    std.debug.assert(node != .null);
    return node;
}

fn declarationValueStrict(p: *Parser, custom: bool, value_token: u32) ParseError!NodeIndex {
    const first = p.index;
    const node = try valueWithSpace(p, if (custom) value_token else null);
    const ends = p.eof or p.tag == .semicolon or p.isDelim('!') or p.isBalanceEdge(first);
    if (!ends) return p.fail(.unexpected_input, null);
    return node;
}

/// A `Value`, which, when empty and `space_from` is a token index, holds css-tree's lone
/// `WhiteSpace` if a whitespace token lies between `space_from` and the current token.
pub fn valueWithSpace(p: *Parser, space_from: ?u32) ParseError!NodeIndex {
    const start = p.start;
    var children = try sequence(p, .value);
    if (children.len == 0) {
        if (space_from) |from| {
            if (try whiteSpace(p, from)) |space| children = try p.tree.addExtra(&.{space});
        }
    }
    std.debug.assert(start <= p.start);
    return p.add(.{ .value = .{ .children = children } }, start, p.start);
}

// the first whitespace token from `from` through the current one
fn whiteSpace(p: *Parser, from: u32) Error!?NodeIndex {
    std.debug.assert(from <= p.index);
    var i = from;
    while (i <= p.index and i < p.count) : (i += 1) {
        if (p.tokens[i].tag != .whitespace) continue;
        const start = p.tokenStart(i);
        if (p.space.start == String.none.start) p.space = try p.pooled(" ");
        return try p.add(.{ .white_space = .{ .value = p.space } }, start, p.tokens[i].end);
    }
    return null;
}

/// css-tree's `readSequence`: component values up to the first `scope` does not read, skipping
/// whitespace and comments between them.
pub fn sequence(p: *Parser, comptime scope: Scope) ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    var space = false;
    while (!p.eof) {
        switch (p.tag) {
            .comment => {
                p.next();
                continue;
            },
            .whitespace => {
                space = true;
                p.next();
                continue;
            },
            else => {},
        }
        const before = p.index;
        const child = try component(p, scope) orelse break;
        std.debug.assert(p.index > before);
        if (scope == .value and space) {
            try padOperator(p, child, .before);
            const items = p.scratch.items;
            if (items.len > base) try padOperator(p, items[items.len - 1], .after);
        }
        space = false;
        try p.push(child);
    }
    if (scope == .value and space and p.scratch.items.len > base) {
        try padOperator(p, p.scratch.items[p.scratch.items.len - 1], .after);
    }
    return p.flush(base);
}

const Side = enum { before, after };

// css-tree's `onWhiteSpace` of the value scope, which spaces a `+` or `-` operator from whitespace
fn padOperator(p: *Parser, node: NodeIndex, comptime side: Side) Error!void {
    const data = &p.tree.nodes.items(.data)[@backingInt(node)];
    if (data.* != .operator) return;
    const text = p.tree.string(data.operator.value);
    std.debug.assert(text.len > 0 and text.len <= 2);
    const last = text[text.len - 1];
    if (last != '+' and last != '-') return;
    var buffer: [3]u8 = undefined;
    const padded = switch (side) {
        .before => std.fmt.bufPrint(&buffer, " {s}", .{text}),
        .after => std.fmt.bufPrint(&buffer, "{s} ", .{text}),
    } catch unreachable;
    data.operator.value = try p.pooled(padded);
}

/// css-tree's default `getNode`: one component value, or null where `scope` ends the sequence.
pub fn component(p: *Parser, comptime scope: Scope) ParseError!?NodeIndex {
    std.debug.assert(!p.eof);
    return switch (p.tag) {
        .hash => try hash(p),
        .comma => try p.operator(),
        .left_parenthesis => try parentheses(p, scope),
        .left_square_bracket => try brackets(p, scope),
        .string => try p.string(),
        .dimension => try dimension(p),
        .percentage => try p.percentage(),
        .number => try number(p),
        .function => if (isUrl(p.src[p.start..p.end]))
            try url(p)
        else
            try function(p, scope),
        .url => try url(p),
        .ident => if ((p.src[p.start] | 0x20) == 'u' and p.at(p.start + 1) == '+')
            try unicodeRange(p)
        else
            try p.identifier(),
        .delim => switch (p.src[p.start]) {
            '/', '*', '+', '-' => try p.operator(),
            '#' => p.fail(.hex_or_identifier_expected, p.start + 1),
            else => null,
        },
        else => null,
    };
}

fn isUrl(function_token: []const u8) bool {
    std.debug.assert(function_token.len >= 2);
    std.debug.assert(function_token[function_token.len - 1] == '(');
    return function_token.len == 4 and std.ascii.eqlIgnoreCase(function_token, "url(");
}

pub fn number(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .number);
    const start = p.start;
    const end = p.end;
    p.next();
    std.debug.assert(start < end);
    return p.add(.{ .number = .{ .value = .{ .start = start, .end = end } } }, start, end);
}

pub fn dimension(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .dimension);
    const start = p.start;
    const end = p.end;
    const split = (lexer.Lexer{ .src = p.src, .pos = start }).numberEnd(start);
    std.debug.assert(start < split and split < end);
    p.next();
    const data: ast.NodeData = .{ .dimension = .{
        .value = .{ .start = start, .end = split },
        .unit = .{ .start = split, .end = end },
    } };
    return p.add(data, start, end);
}

pub fn hash(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .hash);
    const start = p.start;
    const end = p.end;
    std.debug.assert(p.src[start] == '#');
    p.next();
    return p.add(.{ .hash = .{ .value = .{ .start = start + 1, .end = end } } }, start, end);
}

/// A `url()` token, or a `url(` function around a string.
pub fn url(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .url or p.tag == .function);
    const start = p.start;
    var decoded: String = undefined;
    if (p.tag == .url) {
        decoded = try decodeUrl(p, start, p.end);
        p.next();
    } else {
        p.next();
        p.skipSC();
        const string_start = p.start;
        const string_end = p.end;
        try p.eat(.string);
        decoded = try p.decodeString(string_start, string_end);
        p.skipSC();
        if (!p.eof) try p.eat(.right_parenthesis);
    }
    std.debug.assert(start < p.start);
    return p.add(.{ .url = .{ .value = decoded } }, start, p.start);
}

// css-tree's `url.decode`, which trims whitespace inside the parentheses
fn decodeUrl(p: *Parser, start: u32, end: u32) Error!String {
    const str = p.src[start..end];
    const len: u32 = @intCast(str.len);
    std.debug.assert(len >= 4);
    var first: u32 = 4;
    var last: u32 = if (str[len - 1] == ')') len - 2 else len - 1;
    std.debug.assert(last + 1 >= first);
    while (first < last and lexer.isSpace(str[first])) first += 1;
    while (first < last and lexer.isSpace(str[last])) last -= 1;
    return p.decodeEscapes(start, end, first, last + 1);
}

pub fn function(p: *Parser, comptime scope: Scope) ParseError!NodeIndex {
    std.debug.assert(p.tag == .function);
    if (p.depth >= parser.max_depth) return p.fail(.nesting_too_deep, null);
    p.depth += 1;
    defer p.depth -= 1;
    const start = p.start;
    const name: String = .{ .start = start, .end = p.end - 1 };
    p.next();
    const text = p.src[name.start..name.end];
    const children = if (scope == .value and std.ascii.eqlIgnoreCase(text, "var"))
        try varArguments(p)
    else if (scope == .value and std.ascii.eqlIgnoreCase(text, "expression"))
        try p.tree.addExtra(&.{try p.raw(.balance_end, false)})
    else
        try sequence(p, scope);
    if (!p.eof) try p.eat(.right_parenthesis);
    return p.add(.{ .function = .{ .name = name, .children = children } }, start, p.start);
}

// var( <ident> , <value>? ), whose fallback is `Raw` unless custom properties are parsed
fn varArguments(p: *Parser) ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    p.skipSC();
    try p.push(try p.identifier());
    p.skipSC();
    if (p.tag == .comma) {
        try p.push(try p.operator());
        const from = p.index;
        const fallback = if (p.options.parse_custom_property)
            try valueWithSpace(p, from)
        else
            try p.raw(.exclamation_mark_or_semicolon, false);
        try p.push(fallback);
    }
    std.debug.assert(p.scratch.items.len > base);
    return p.flush(base);
}

pub fn parentheses(p: *Parser, comptime scope: Scope) ParseError!NodeIndex {
    std.debug.assert(p.tag == .left_parenthesis);
    if (p.depth >= parser.max_depth) return p.fail(.nesting_too_deep, null);
    p.depth += 1;
    defer p.depth -= 1;
    const start = p.start;
    p.next();
    const children = try sequence(p, scope);
    if (!p.eof) try p.eat(.right_parenthesis);
    return p.add(.{ .parentheses = .{ .children = children } }, start, p.start);
}

pub fn brackets(p: *Parser, comptime scope: Scope) ParseError!NodeIndex {
    std.debug.assert(p.tag == .left_square_bracket);
    if (p.depth >= parser.max_depth) return p.fail(.nesting_too_deep, null);
    p.depth += 1;
    defer p.depth -= 1;
    const start = p.start;
    p.next();
    const children = try sequence(p, scope);
    if (!p.eof) try p.eat(.right_square_bracket);
    return p.add(.{ .brackets = .{ .children = children } }, start, p.start);
}

/// css-tree's `UnicodeRange`, from a `u` whose next character is `+`.
pub fn unicodeRange(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .ident and p.end - p.start == 1);
    const start = p.start;
    p.next();
    try unicodeRangeRest(p);
    std.debug.assert(start < p.start);
    const text: String = .{ .start = start, .end = p.start };
    return p.add(.{ .unicode_range = .{ .value = text } }, start, p.start);
}

// what follows the `u` of `<urange>` (css-syntax-3), as css-tree's `scanUnicodeRange` reads it
fn unicodeRangeRest(p: *Parser) ParseError!void {
    switch (p.tag) {
        .number => {
            const digits = try hexSequence(p, 1, true);
            if (p.isDelim('?')) return questionMarks(p, 6 - digits);
            if (p.tag == .dimension or p.tag == .number) {
                if (p.at(p.start) != '-') return p.fail(.range_hyphen_minus_expected, null);
                _ = try hexSequence(p, 1, false);
            }
        },
        .dimension => {
            const digits = try hexSequence(p, 1, true);
            if (digits > 0) try questionMarks(p, 6 - digits);
        },
        else => {
            if (!p.isDelim('+')) return p.fail(.plus_sign_delim_expected, null);
            p.next();
            if (p.tag == .ident) {
                const digits = try hexSequence(p, 0, true);
                if (digits > 0) try questionMarks(p, 6 - digits);
                return;
            }
            if (!p.isDelim('?')) return p.fail(.hex_digit_or_question_mark_expected, null);
            p.next();
            try questionMarks(p, 5);
        },
    }
}

// css-tree's `eatHexSequence` over the current token from `offset`: the count of hex digits, or -1
// when a `-` splits it into a range
fn hexSequence(p: *Parser, offset: u32, allow_dash: bool) ParseError!i32 {
    std.debug.assert(p.start + offset <= p.end);
    var count: i32 = 0;
    var i = p.start + offset;
    while (i < p.end) : (i += 1) {
        const c = p.src[i];
        if (c == '-' and allow_dash and count != 0) {
            _ = try hexSequence(p, i + 1 - p.start, false);
            return -1;
        }
        if (!std.ascii.isHex(c)) {
            const range = allow_dash and count != 0;
            const message: ast.Message = if (range and count < 6)
                .hyphen_minus_or_hex_digit_expected
            else if (range)
                .range_hyphen_minus_expected
            else if (count < 6)
                .hex_digit_expected
            else
                .unexpected_input;
            return p.fail(message, i);
        }
        count += 1;
        if (count > 6) return p.fail(.too_many_hex_digits, i);
    }
    std.debug.assert(count <= 6);
    p.next();
    return count;
}

fn questionMarks(p: *Parser, max: i32) ParseError!void {
    std.debug.assert(max <= 7);
    var count: i32 = 0;
    while (p.isDelim('?')) {
        count += 1;
        if (count > max) return p.fail(.too_many_question_marks, null);
        p.next();
    }
    std.debug.assert(count <= max);
}

/// css-tree's `Ratio`: a number or function, then optionally `/` and another.
pub fn ratio(p: *Parser) ParseError!NodeIndex {
    const start = p.start;
    const left = try ratioTerm(p);
    p.skipSC();
    var right: NodeIndex = .null;
    if (p.isDelim('/')) {
        p.next();
        right = try ratioTerm(p);
    }
    std.debug.assert(left != .null and start < p.start);
    return p.add(.{ .ratio = .{ .left = left, .right = right } }, start, p.start);
}

fn ratioTerm(p: *Parser) ParseError!NodeIndex {
    p.skipSC();
    return switch (p.tag) {
        .number => number(p),
        .function => function(p, .value),
        else => p.fail(.number_or_function_expected, null),
    };
}

fn expectValue(source: []const u8, want: []const ast.Tag, text: []const u8) !void {
    var tree = try parser.parse(std.testing.allocator, source, .{ .context = .value });
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const children = tree.extra(tree.data(tree.root).value.children);
    try std.testing.expectEqual(want.len, children.len);
    var out: std.ArrayList(u8) = .empty;
    defer out.deinit(std.testing.allocator);
    for (children, want) |child, tag| {
        try std.testing.expectEqual(tag, std.meta.activeTag(tree.data(child)));
        const piece = switch (tree.data(child)) {
            .operator => |o| tree.string(o.value),
            .unicode_range => |u| tree.string(u.value),
            .url => |u| tree.string(u.value),
            .dimension => |d| tree.string(d.unit),
            else => "",
        };
        try out.appendSlice(std.testing.allocator, piece);
        try out.append(std.testing.allocator, '|');
    }
    try std.testing.expectEqualStrings(text, out.items);
}

test "reads component values" {
    const operators: []const ast.Tag = &.{ .dimension, .operator, .number, .operator, .number };
    try expectValue("1px / 2 + 3", operators, "px|/|| + ||");
    const ranges: []const ast.Tag = &.{ .unicode_range, .unicode_range };
    try expectValue("u+0025-00ff U+4??", ranges, "u+0025-00ff|U+4??|");
    try expectValue("url( a\\62 ) URL('c')", &.{ .url, .url }, "ab|c|");
    const nested: []const ast.Tag = &.{ .function, .hash, .string, .percentage };
    try expectValue("f(a, (b) [c]) #d 'e' 5%", nested, "||||");
}

test "keeps var() fallbacks raw unless custom properties are parsed" {
    inline for (.{ false, true }) |custom| {
        const options: parser.Options = .{ .context = .value, .parse_custom_property = custom };
        var tree = try parser.parse(std.testing.allocator, "var(--x, a b)", options);
        defer tree.deinit();
        const value_children = tree.extra(tree.data(tree.root).value.children);
        const arguments = tree.extra(tree.data(value_children[0]).function.children);
        try std.testing.expectEqual(3, arguments.len);
        const want: ast.Tag = if (custom) .value else .raw;
        try std.testing.expectEqual(want, std.meta.activeTag(tree.data(arguments[2])));
    }
}

test "reports what does not read as a value" {
    const cases = .{
        .{ "a #", ast.Message.hex_or_identifier_expected },
        .{ "u+12345678", ast.Message.too_many_hex_digits },
        .{ "u+1???????", ast.Message.too_many_question_marks },
        .{ "url(\"a\" b)", ast.Message.right_parenthesis_expected },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{ .context = .value });
        defer tree.deinit();
        try std.testing.expectEqual(case[1], tree.diagnostics.items[0].message);
    }
}

test "bounds the nesting of values" {
    const gpa = std.testing.allocator;
    var source: std.ArrayList(u8) = .empty;
    defer source.deinit(gpa);
    for (0..300) |_| try source.appendSlice(gpa, "f([(");
    var tree = try parser.parse(gpa, source.items, .{ .context = .value });
    defer tree.deinit();
    try std.testing.expectEqual(ast.Message.nesting_too_deep, tree.diagnostics.items[0].message);
    try std.testing.expectEqual(ast.Tag.raw, std.meta.activeTag(tree.data(tree.root)));
}
