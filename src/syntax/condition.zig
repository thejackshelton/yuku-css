// css-tree's Condition and the terms it reads: Feature, FeatureRange, FeatureFunction,
// GeneralEnclosed and SupportsDeclaration. The tree is css-tree's; where the condition grammars
// of mediaqueries-4 §3, css-conditional-3 §6.1 and css-contain-3 §6.1 reject the order of its
// keywords and terms, a spec error says so.

const std = @import("std");
const ast = @import("../ast.zig");
const token = @import("../token.zig");
const parser = @import("../parser.zig");
const values = @import("value.zig");
const atrule = @import("atrule.zig");

const Parser = parser.Parser;
const ParseError = parser.ParseError;
const NodeIndex = ast.NodeIndex;
const String = ast.String;
const Kind = ast.ConditionKind;

/// Which keywords may join the terms of a condition.
pub const Grammar = enum {
    /// `not` before one term, or terms joined all by `and` or all by `or`.
    full,
    /// The condition after a media type and `and`, where `or` may not join terms.
    without_or,
};

/// css-tree's `Condition`: identifiers and parenthesized or functional terms, up to the first
/// token that is neither.
pub fn condition(p: *Parser, kind: Kind, grammar: Grammar) ParseError!NodeIndex {
    const children = try terms(p, kind);
    if (grammarError(p, children, grammar)) |d| try p.specError(d.message, d.span.start, d.span.end);
    const span = p.spanOfList(children);
    return p.add(.{ .condition = .{ .kind = kind, .children = children } }, span.start, span.end);
}

fn terms(p: *Parser, kind: Kind) ParseError!ast.IndexRange {
    const base = p.scratch.items.len;
    const first = p.tokenStart();
    while (!p.eof) {
        const child = switch (p.tag) {
            .comment, .whitespace => {
                p.next();
                continue;
            },
            .ident => try p.identifier(),
            .left_parenthesis => try parenthesized(p, kind),
            .function => try functional(p, kind),
            else => break,
        };
        std.debug.assert(p.tokenStart() > first or p.tag == .eof);
        try p.push(child);
    }
    if (p.scratch.items.len == base) return p.fail(.condition_expected, null);
    return p.flush(base);
}

// a feature, a range or a supports declaration, else a nested condition, else general-enclosed,
// each as valid as the others, so none reports the errors of those tried before it
// (css-conditional-3 §6.1, mediaqueries-4 §3, css-contain-3 §6.1)
fn parenthesized(p: *Parser, kind: Kind) ParseError!NodeIndex {
    std.debug.assert(p.tag == .left_parenthesis);
    const start = p.checkpoint();
    const reported = p.tree.diagnostics.items.len;
    if (term(p, kind)) |node| return node else |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => p.rewind(start),
    }
    p.tree.diagnostics.shrinkRetainingCapacity(reported);
    if (nested(p, kind)) |node| return node else |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => p.rewind(start),
    }
    return enclosedSilently(p, kind, reported, p.failure);
}

// `selector()` or `style()`, else general-enclosed, which takes any other function as valid
// (css-conditional-3 §6.1, mediaqueries-4 §3, css-contain-3 §6.1)
fn functional(p: *Parser, kind: Kind) ParseError!NodeIndex {
    std.debug.assert(p.tag == .function);
    const start = p.checkpoint();
    const reported = p.tree.diagnostics.items.len;
    if (featureFunction(p, kind)) |node| return node else |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => p.rewind(start),
    }
    return enclosedSilently(p, kind, reported, p.failure);
}

// `<general-enclosed>` reads any balanced tokens, so its Raw reports nothing either, while the
// bound on nesting is still reported, once
fn enclosedSilently(
    p: *Parser,
    kind: Kind,
    reported: usize,
    failure: ast.Diagnostic,
) ParseError!NodeIndex {
    @branchHint(.cold);
    std.debug.assert(p.tag == .left_parenthesis or p.tag == .function);
    p.tree.diagnostics.shrinkRetainingCapacity(reported);
    const node = try generalEnclosed(p, kind);
    const diagnostics = p.tree.diagnostics.items;
    var kept = reported;
    for (diagnostics[reported..]) |d| {
        if (d.message != .nesting_too_deep) continue;
        diagnostics[kept] = d;
        kept += 1;
    }
    p.tree.diagnostics.shrinkRetainingCapacity(kept);
    if (kept == reported and failure.message == .nesting_too_deep) try p.report(failure);
    std.debug.assert(p.tree.data(node) == .general_enclosed);
    return node;
}

fn term(p: *Parser, kind: Kind) ParseError!NodeIndex {
    return switch (kind) {
        .supports => supportsDeclaration(p),
        .media, .container => featureOrRange(p, kind),
    };
}

fn nested(p: *Parser, kind: Kind) ParseError!NodeIndex {
    if (p.depth >= parser.max_depth) return p.fail(.nesting_too_deep, null);
    p.depth += 1;
    defer p.depth -= 1;
    try p.eat(.left_parenthesis);
    const children = try terms(p, kind);
    // parentheses whose condition the grammar rejects are general-enclosed
    if (grammarError(p, children, .full)) |d| return p.fail(d.message, d.span.start);
    if (!p.eof) try p.eat(.right_parenthesis);
    const span = p.spanOfList(children);
    return p.add(.{ .condition = .{ .kind = kind, .children = children } }, span.start, span.end);
}

fn featureOrRange(p: *Parser, kind: Kind) ParseError!NodeIndex {
    std.debug.assert(p.tag == .left_parenthesis);
    const name = atrule.lookupTypeNonSC(p, 1);
    const after = atrule.lookupTypeNonSC(p, 2);
    const likely = after == .colon or after == .right_parenthesis or after == .eof;
    if (name == .ident and likely) return feature(p, kind);
    return featureRange(p, kind);
}

/// css-tree's `Feature`: `(name)` or `(name: value)`.
pub fn feature(p: *Parser, kind: Kind) ParseError!NodeIndex {
    const start = p.start;
    try p.eat(.left_parenthesis);
    p.skipSC();
    const name = try p.consume(.ident);
    p.skipSC();
    var value: NodeIndex = .null;
    // the end of input closes the parentheses (css-syntax-3 §5.4.8)
    if (p.tag != .right_parenthesis and !p.eof) {
        try p.eat(.colon);
        p.skipSC();
        value = switch (p.tag) {
            .number => if (atrule.lookupNonWSType(p, 1) == .delim)
                try values.ratio(p)
            else
                try values.number(p),
            .dimension => try values.dimension(p),
            .ident => try p.identifier(),
            .function => try atrule.fallback(p, functionValue, .{}, values.ratio, .{}),
            else => return p.fail(.feature_value_expected, null),
        };
        p.skipSC();
    }
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(start < p.start);
    const data: ast.NodeData = .{ .feature = .{ .kind = kind, .name = name, .value = value } };
    return p.add(data, start, p.start);
}

// a function that is no ratio's first term
fn functionValue(p: *Parser) ParseError!NodeIndex {
    std.debug.assert(p.tag == .function);
    const node = try values.function(p, .value);
    p.skipSC();
    if (p.isDelim('/')) return p.fail(.unexpected_input, null);
    std.debug.assert(p.tree.data(node) == .function);
    return node;
}

/// css-tree's `FeatureRange`: `(left < middle)` or `(left < middle < right)`.
pub fn featureRange(p: *Parser, kind: Kind) ParseError!NodeIndex {
    const start = p.start;
    p.skipSC();
    try p.eat(.left_parenthesis);
    const left = try rangeTerm(p);
    const left_comparison = try comparison(p, p.tree.data(left) == .identifier);
    const middle = try rangeTerm(p);
    var right_comparison: ast.Comparison = .none;
    var right: NodeIndex = .null;
    const after = atrule.lookupNonWSType(p, 0);
    if (after != .right_parenthesis and after != .eof) {
        right_comparison = try comparison(p, false);
        right = try rangeTerm(p);
    }
    p.skipSC();
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(left_comparison != .none);
    const data: ast.NodeData = .{ .feature_range = .{
        .kind = kind,
        .left = left,
        .left_comparison = left_comparison,
        .middle = middle,
        .right_comparison = right_comparison,
        .right = right,
    } };
    return p.add(data, start, p.start);
}

fn rangeTerm(p: *Parser) ParseError!NodeIndex {
    p.skipSC();
    std.debug.assert(p.tag != .whitespace and p.tag != .comment);
    return switch (p.tag) {
        .number => if (delimAfterSpace(p, '/')) values.ratio(p) else values.number(p),
        .dimension => values.dimension(p),
        .ident => p.identifier(),
        .function => atrule.fallback(p, functionValue, .{}, values.ratio, .{}),
        else => p.fail(.feature_value_expected, null),
    };
}

// css-tree's `isDelim(c, lookupOffsetNonSC(1))`, which reads the current token when none follows
fn delimAfterSpace(p: *const Parser, comptime c: u8) bool {
    std.debug.assert(p.tag != .eof);
    const after = atrule.nextNonSC(p);
    if (after.tag == .eof) return p.isDelim(c);
    std.debug.assert(after.start < p.src.len);
    return after.tag == .delim and p.src[after.start] == c;
}

// css-tree reads `=` without moving past it, so a range with `=` fails at its next term
fn comparison(p: *Parser, expect_colon: bool) ParseError!ast.Comparison {
    p.skipSC();
    if (p.isDelim('<') or p.isDelim('>')) {
        const less = p.src[p.start] == '<';
        p.next();
        if (p.isDelim('=')) {
            p.next();
            return if (less) .less_or_equal else .greater_or_equal;
        }
        return if (less) .less else .greater;
    }
    if (p.isDelim('=')) return .equal;
    const message: ast.Message = if (expect_colon)
        .feature_colon_or_comparison_expected
    else
        .comparison_expected;
    return p.fail(message, null);
}

/// css-tree's `FeatureFunction`: `selector()` in a supports condition, `style()` in a container
/// query.
pub fn featureFunction(p: *Parser, kind: Kind) ParseError!NodeIndex {
    std.debug.assert(p.tag == .function);
    const start = p.start;
    const name: String = .{ .start = start, .end = p.end - 1 };
    p.next();
    const text = p.src[name.start..name.end];
    const reads: Reads = switch (kind) {
        .supports => if (std.ascii.eqlIgnoreCase(text, "selector")) .selector else .none,
        .container => if (std.ascii.eqlIgnoreCase(text, "style")) .declaration else .none,
        .media => .none,
    };
    if (reads == .none) return p.fail(.unknown_feature, null);
    p.skipSC();
    const value = try atrule.fallback(p, featureValue, .{reads}, atrule.rawBalanced, .{false});
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(start < p.start);
    const data: ast.NodeData = .{ .feature_function = .{
        .kind = kind,
        .feature = name,
        .value = value,
    } };
    return p.add(data, start, p.start);
}

const Reads = enum { none, selector, declaration };

fn featureValue(p: *Parser, reads: Reads) ParseError!NodeIndex {
    std.debug.assert(reads != .none);
    const first = p.tokenStart();
    const node = switch (reads) {
        .selector => try p.selector(false),
        .declaration => try p.declaration(false),
        .none => unreachable,
    };
    if (!p.eof and !p.isBalanceEdge(first)) return p.fail(.unexpected_input, null);
    std.debug.assert(node != .null);
    return node;
}

/// css-tree's `GeneralEnclosed`: a function or parentheses no other term reads, its contents a
/// sequence of component values, or `Raw` when they do not parse.
pub fn generalEnclosed(p: *Parser, kind: Kind) ParseError!NodeIndex {
    const start = p.start;
    var function: String = .none;
    if (p.tag == .function) {
        function = .{ .start = start, .end = p.end - 1 };
        p.next();
    } else {
        try p.eat(.left_parenthesis);
    }
    const checkpoint = p.checkpoint();
    const children = enclosed(p) catch |err| switch (err) {
        error.OutOfMemory => |e| return e,
        error.Syntax => blk: {
            const failure = p.failure;
            p.rewind(checkpoint);
            const raw = try p.raw(.balance_end, false);
            try p.report(failure);
            break :blk try atrule.single(p, raw);
        },
    };
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(start < p.start);
    const data: ast.NodeData = .{ .general_enclosed = .{
        .kind = kind,
        .function = function,
        .children = children,
    } };
    return p.add(data, start, p.start);
}

fn enclosed(p: *Parser) ParseError!ast.IndexRange {
    const first = p.tokenStart();
    const children = try values.sequence(p, .value);
    if (!p.eof and !p.isBalanceEdge(first)) return p.fail(.unexpected_input, null);
    std.debug.assert(p.tokenStart() >= first or p.tag == .eof);
    return children;
}

/// css-tree's `SupportsDeclaration`: `(property: value)`.
pub fn supportsDeclaration(p: *Parser) ParseError!NodeIndex {
    const start = p.start;
    try p.eat(.left_parenthesis);
    p.skipSC();
    const declaration = try p.declaration(false);
    if (!p.eof) try p.eat(.right_parenthesis);
    std.debug.assert(declaration != .null and start < p.start);
    const data: ast.NodeData = .{ .supports_declaration = .{ .declaration = declaration } };
    return p.add(data, start, p.start);
}

const Keyword = enum { none, @"and", @"or", not };

fn keyword(p: *const Parser, node: NodeIndex) Keyword {
    const data = p.tree.data(node);
    if (data != .identifier) return .none;
    const name = p.tree.string(data.identifier.name);
    inline for (.{ Keyword.@"and", Keyword.@"or", Keyword.not }) |word| {
        if (std.ascii.eqlIgnoreCase(name, @tagName(word))) return word;
    }
    return .none;
}

fn isTerm(p: *const Parser, node: NodeIndex) bool {
    return p.tree.data(node) != .identifier;
}

// `not <in-parens> | <in-parens> [and <in-parens>]* | <in-parens> [or <in-parens>]*`, the first
// place the terms break it
fn grammarError(p: *const Parser, children: ast.IndexRange, grammar: Grammar) ?ast.Diagnostic {
    const items = p.tree.extra(children);
    std.debug.assert(items.len > 0);
    const spans = p.tree.nodes.items(.span);
    const at = struct {
        fn span(all: []const ast.Span, node: NodeIndex) ast.Span {
            return all[@backingInt(node)];
        }
    }.span;
    const err = struct {
        fn diagnostic(message: ast.Message, start: u32, end: u32) ast.Diagnostic {
            return .{ .message = message, .span = .{ .start = start, .end = end } };
        }
    }.diagnostic;
    if (keyword(p, items[0]) == .not) {
        const end = at(spans, items[0]).end;
        if (items.len == 1) return err(.parenthesized_condition_expected, end, end);
        if (!isTerm(p, items[1])) {
            const span = at(spans, items[1]);
            return err(.parenthesized_condition_expected, span.start, span.end);
        }
        if (items.len > 2) {
            const span = at(spans, items[2]);
            return err(.not_combined, span.start, span.end);
        }
        return null;
    }
    if (!isTerm(p, items[0])) {
        const span = at(spans, items[0]);
        return err(.parenthesized_condition_expected, span.start, span.end);
    }
    var joined: Keyword = .none;
    var i: usize = 1;
    while (i < items.len) : (i += 2) {
        const word = keyword(p, items[i]);
        const span = at(spans, items[i]);
        if (word != .@"and" and word != .@"or") return err(.and_or_expected, span.start, span.end);
        if (word == .@"or" and grammar == .without_or) {
            return err(.or_after_media_type, span.start, span.end);
        }
        if (joined != .none and joined != word) return err(.and_or_mixed, span.start, span.end);
        joined = word;
        if (i + 1 == items.len) return err(.parenthesized_condition_expected, span.end, span.end);
        if (!isTerm(p, items[i + 1])) {
            const next = at(spans, items[i + 1]);
            return err(.parenthesized_condition_expected, next.start, next.end);
        }
    }
    std.debug.assert(i >= items.len);
    return null;
}

test "reads the terms of conditions" {
    const source = "@supports (a: b) and selector(.c) and (not (d: e)) and f(g) {}";
    var tree = try parser.parse(std.testing.allocator, source, .{});
    defer tree.deinit();
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const prelude = tree.data(at.prelude).atrule_prelude;
    const condition_node = tree.data(tree.extra(prelude.children)[0]).condition;
    var tags: [7]ast.Tag = undefined;
    for (tree.extra(condition_node.children), &tags) |child, *tag| {
        tag.* = std.meta.activeTag(tree.data(child));
    }
    const want = [_]ast.Tag{
        .supports_declaration, .identifier, .feature_function, .identifier,
        .condition,            .identifier, .general_enclosed,
    };
    try std.testing.expectEqualSlices(ast.Tag, &want, &tags);
}

test "reads a condition in parentheses with no error" {
    const sources = .{
        "@supports (display: grid) and (not (display: inline-grid)) {}",
        "@supports not (not (a: b)) {}",
        "@supports ((a: b) or (c: d)) and (e: f) {}",
        "@container (not (width > 1px)) {}",
        "@media (not (hover)) {}",
        "@media ((a) or (b)) {}",
    };
    inline for (sources) |source| {
        var tree = try parser.parse(std.testing.allocator, source, .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
    }
}

test "reads parentheses that hold no condition as general-enclosed with no error" {
    const source = "@media (max-width: calc(1px) and (max-height: 2px)) {}";
    var tree = try parser.parse(std.testing.allocator, source, .{});
    defer tree.deinit();
    try std.testing.expectEqual(0, tree.diagnostics.items.len);
    const sheet = tree.data(tree.root).style_sheet;
    const at = tree.data(tree.extra(sheet.children)[0]).atrule;
    const list = tree.data(tree.extra(tree.data(at.prelude).atrule_prelude.children)[0]);
    const query = tree.data(tree.extra(list.media_query_list.children)[0]).media_query;
    const children = tree.extra(tree.data(query.condition).condition.children);
    const tag = std.meta.activeTag(tree.data(children[0]));
    try std.testing.expectEqual(ast.Tag.general_enclosed, tag);
}

test "reads a function or parentheses the grammar rejects as general-enclosed with no error" {
    const cases = .{
        .{ "@media f(a) {}", "f" },
        .{ "@supports FUNC(a: b) {}", "FUNC" },
        .{ "@container f() {}", "f" },
        .{ "@media (a b) {}", "" },
        .{ "@supports (a b) {}", "" },
        .{ "@media ((a) x) {}", "" },
        .{ "@supports ((a: b) and (c: d) or (e: f)) {}", "" },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        var node = tree.extra(tree.data(at.prelude).atrule_prelude.children)[0];
        if (tree.data(node) == .media_query_list) {
            const query = tree.extra(tree.data(node).media_query_list.children)[0];
            node = tree.data(query).media_query.condition;
        }
        const children = tree.extra(tree.data(node).condition.children);
        const last = tree.data(children[children.len - 1]).general_enclosed;
        if (case[1].len == 0) {
            try std.testing.expect(last.function.start == ast.String.none.start);
        } else {
            try std.testing.expectEqualStrings(case[1], tree.string(last.function));
        }
    }
}

test "keeps the grammar errors of a condition outside parentheses" {
    var tree = try parser.parse(std.testing.allocator, "@supports (a: b) c (d: e) {}", .{});
    defer tree.deinit();
    try std.testing.expectEqual(1, tree.diagnostics.items.len);
    try std.testing.expectEqual(ast.Message.and_or_expected, tree.diagnostics.items[0].message);
}

test "reads ranges as css-tree does" {
    const cases = .{
        .{ "@media (1px < width <= 2px) {}", ast.Tag.feature_range },
        .{ "@media (width = 1px) {}", ast.Tag.general_enclosed },
        .{ "@media (foo 123) {}", ast.Tag.general_enclosed },
    };
    inline for (cases) |case| {
        var tree = try parser.parse(std.testing.allocator, case[0], .{});
        defer tree.deinit();
        try std.testing.expectEqual(0, tree.diagnostics.items.len);
        const sheet = tree.data(tree.root).style_sheet;
        const at = tree.data(tree.extra(sheet.children)[0]).atrule;
        const list = tree.data(tree.extra(tree.data(at.prelude).atrule_prelude.children)[0]);
        const query = tree.data(tree.extra(list.media_query_list.children)[0]).media_query;
        const term_node = tree.extra(tree.data(query.condition).condition.children)[0];
        try std.testing.expectEqual(case[1], std.meta.activeTag(tree.data(term_node)));
    }
}

test "bounds the nesting of conditions" {
    const gpa = std.testing.allocator;
    var source: std.ArrayList(u8) = .empty;
    defer source.deinit(gpa);
    try source.appendSlice(gpa, "@supports ");
    for (0..300) |_| try source.appendSlice(gpa, "(not ");
    var tree = try parser.parse(gpa, source.items, .{});
    defer tree.deinit();
    try std.testing.expectEqual(1, tree.diagnostics.items.len);
    try std.testing.expectEqual(ast.Message.nesting_too_deep, tree.diagnostics.items[0].message);
}

test "bounds the nesting inside general-enclosed" {
    const gpa = std.testing.allocator;
    var source: std.ArrayList(u8) = .empty;
    defer source.deinit(gpa);
    try source.appendSlice(gpa, "@media (a b ");
    for (0..300) |_| try source.appendSlice(gpa, "(");
    for (0..301) |_| try source.appendSlice(gpa, ")");
    try source.appendSlice(gpa, " {}");
    var tree = try parser.parse(gpa, source.items, .{});
    defer tree.deinit();
    try std.testing.expectEqual(1, tree.diagnostics.items.len);
    try std.testing.expectEqual(ast.Message.nesting_too_deep, tree.diagnostics.items[0].message);
}
