//! css-tree's `matchAsTree`: tokens run through a match graph, backtracking through `else`
//! branches, with css-tree's stash for low-priority types and its iteration budget. The stacks are
//! persistent lists of cells in arrays the matcher keeps between calls, so a match allocates only
//! while the arrays grow to the largest match seen.

const std = @import("std");
const css = @import("css");
const generic = @import("generic.zig");
const graph_ = @import("graph.zig");
const syntax = @import("syntax.zig");
const Lexer = @import("lexer.zig").Lexer;

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Tag = css.token.Tag;
const Tokens = generic.Tokens;
const none = graph_.none;

const iteration_limit = 15000;

pub const Status = enum(u32) {
    match,
    mismatch,
    iteration_limit,
    /// A definition references a name no dictionary holds; css-tree throws.
    bad_reference,
    /// The value has a `var()`, which css-tree refuses to match.
    has_var,
};

pub const Entry = enum(u8) { stub, token, open, close };

const MatchCell = struct {
    entry: Entry,
    /// The definition node, `none` for a generic type's tokens.
    syntax: u32,
    token: u32,
    prev: u32,
};

const SyntaxCell = struct {
    syntax: u32,
    /// The definition node of the innermost range, `none` when there is none.
    opts: u32,
    prev: u32,
};

const ThenCell = struct {
    state: u32,
    match: u32,
    syntax: u32,
    prev: u32,
};

const ElseCell = struct {
    state: u32,
    match: u32,
    syntax: u32,
    then: u32,
    token: u32,
    prev: u32,
};

/// A `match_once` group partway: css-tree's `MatchOnceBuffer`, or `AddMatchOnce` when `add`.
const Once = struct {
    node: u32,
    index: u32,
    mask: u32,
    add: bool,
};

// appends where there is room without a call, as the stacks reach their size in the first matches
inline fn push(comptime T: type, gpa: Allocator, list: *std.ArrayList(T), item: T) !void {
    if (list.items.len < list.capacity) {
        @branchHint(.likely);
        list.appendAssumeCapacity(item);
        return;
    }
    try list.append(gpa, item);
}

// a state is a graph node, or with this bit a `Once`
const dynamic: u32 = 1 << 31;
const stash_empty = none;
const stash_off = none - 1;

pub const Result = struct {
    status: Status,
    iterations: u32,
    /// The token after the furthest any branch matched to.
    longest: u32,
    /// The match list, last entry first, when matched.
    top: u32,
    /// The definition node a bad reference names.
    reference: u32 = none,
};

pub const Matcher = struct {
    gpa: Allocator,
    lexer: *Lexer = undefined,
    tokens: Tokens = undefined,
    matches: std.ArrayList(MatchCell) = .empty,
    syntaxes: std.ArrayList(SyntaxCell) = .empty,
    thens: std.ArrayList(ThenCell) = .empty,
    elses: std.ArrayList(ElseCell) = .empty,
    onces: std.ArrayList(Once) = .empty,

    // the run's registers, as css-tree's closure variables
    state: u32 = 0,
    match_top: u32 = 0,
    syntax_top: u32 = none,
    then_top: u32 = none,
    else_top: u32 = none,
    stash: u32 = stash_empty,
    token: u32 = 0,
    longest: u32 = 0,

    pub fn deinit(m: *Matcher) void {
        m.matches.deinit(m.gpa);
        m.syntaxes.deinit(m.gpa);
        m.thens.deinit(m.gpa);
        m.elses.deinit(m.gpa);
        m.onces.deinit(m.gpa);
        m.* = undefined;
    }

    pub fn cell(m: *const Matcher, index: u32) MatchCell {
        assert(index < m.matches.items.len);
        return m.matches.items[index];
    }

    fn tokenTag(m: *const Matcher) ?Tag {
        return if (m.token < m.tokens.len()) m.tokens.tag(m.token) else null;
    }

    fn tokenText(m: *const Matcher, index: u32) []const u8 {
        return m.tokens.text(index);
    }

    fn moveToNextToken(m: *Matcher) void {
        assert(m.token == none or m.token < m.tokens.len());
        m.token +%= 1;
        while (m.token < m.tokens.len()) : (m.token += 1) {
            const tag = m.tokens.tag(m.token);
            if (tag != .whitespace and tag != .comment) break;
        }
        assert(m.token <= m.tokens.len());
    }

    fn pushMatch(m: *Matcher, c: MatchCell) !void {
        assert(c.entry != .stub);
        assert(c.prev < m.matches.items.len);
        m.match_top = @intCast(m.matches.items.len);
        try push(MatchCell, m.gpa, &m.matches, c);
    }

    fn pushThen(m: *Matcher, state: u32) !void {
        assert(state != graph_.match);
        assert(m.then_top == none or m.then_top < m.thens.items.len);
        const index: u32 = @intCast(m.thens.items.len);
        try push(ThenCell, m.gpa, &m.thens, .{
            .state = state,
            .match = m.match_top,
            .syntax = m.syntax_top,
            .prev = m.then_top,
        });
        m.then_top = index;
    }

    fn snapshot(m: *Matcher, state: u32, prev: u32) !u32 {
        assert(prev == none or prev < m.elses.items.len);
        assert(m.token <= m.tokens.len());
        const index: u32 = @intCast(m.elses.items.len);
        try push(ElseCell, m.gpa, &m.elses, .{
            .state = state,
            .match = m.match_top,
            .syntax = m.syntax_top,
            .then = m.then_top,
            .token = m.token,
            .prev = prev,
        });
        return index;
    }

    fn pushElse(m: *Matcher, state: u32) !void {
        m.else_top = try m.snapshot(state, m.else_top);
    }

    fn addTokenToMatch(m: *Matcher, syntax_node: u32) !void {
        assert(syntax_node == none or syntax_node < m.lexer.defs.count());
        assert(m.token < m.tokens.len());
        try m.pushMatch(
            .{ .entry = .token, .syntax = syntax_node, .token = m.token, .prev = m.match_top },
        );
        m.moveToNextToken();
        m.stash = stash_empty;
        if (m.token > m.longest) m.longest = m.token;
    }

    fn openSyntax(m: *Matcher, syntax_node: u32) !void {
        assert(syntax_node < m.lexer.defs.count());
        assert(m.match_top < m.matches.items.len);
        const def = m.lexer.defs.node(syntax_node);
        var opts: u32 = if (m.syntax_top != none) m.syntaxes.items[m.syntax_top].opts else none;
        if (def.tag == .type and def.flags & syntax.flag.range != 0) opts = syntax_node + 1;
        const index: u32 = @intCast(m.syntaxes.items.len);
        const cell_: SyntaxCell = .{ .syntax = syntax_node, .opts = opts, .prev = m.syntax_top };
        try push(SyntaxCell, m.gpa, &m.syntaxes, cell_);
        m.syntax_top = index;
        const token = m.cell(m.match_top).token;
        try m.pushMatch(
            .{ .entry = .open, .syntax = syntax_node, .token = token, .prev = m.match_top },
        );
    }

    fn closeSyntax(m: *Matcher) !void {
        assert(m.match_top < m.matches.items.len);
        assert(m.syntax_top != none);
        const top = m.cell(m.match_top);
        if (top.entry == .open) {
            m.match_top = top.prev;
        } else {
            const syntax_node = m.syntaxes.items[m.syntax_top].syntax;
            try m.pushMatch(
                .{
                    .entry = .close,
                    .syntax = syntax_node,
                    .token = top.token,
                    .prev = m.match_top,
                },
            );
        }
        m.syntax_top = m.syntaxes.items[m.syntax_top].prev;
    }

    fn isCommaContextStart(m: *const Matcher, token: u32) bool {
        assert(token == none or token < m.tokens.len());
        assert(m.tokens.len() <= m.tokens.source.len);
        if (token == none) return true;
        return switch (m.tokens.tag(token)) {
            .comma, .function, .left_parenthesis, .left_square_bracket, .left_curly_bracket => true,
            // `?` keeps unicode ranges like U+30?? apart from a comma
            .delim => !std.mem.eql(u8, m.tokenText(token), "?"),
            else => false,
        };
    }

    fn isCommaContextEnd(m: *const Matcher, token: u32) bool {
        assert(token <= m.tokens.len());
        assert(m.tokens.len() <= m.tokens.source.len);
        if (token >= m.tokens.len()) return true;
        return switch (m.tokens.tag(token)) {
            .right_parenthesis, .right_square_bracket, .right_curly_bracket => true,
            .delim => std.mem.eql(u8, m.tokenText(token), "/"),
            else => false,
        };
    }

    // a keyword's name without IE's `\0` and `\9` hacks
    fn withoutHack(value: []const u8) []const u8 {
        assert(value.len <= std.math.maxInt(u32));
        var i: usize = 0;
        while (std.mem.indexOfScalarPos(u8, value, i, '\\')) |at| : (i = at + 1) {
            const next = if (at + 1 < value.len) value[at + 1] else 0;
            if (next == '0' or next == '9') return value[0..at];
        }
        assert(i <= value.len);
        return value;
    }

    // css-tree's `areStringsEqualCaseInsensitive`: only the tested string is lowercased
    fn equalTested(tested: []const u8, reference: []const u8) bool {
        assert(reference.len <= std.math.maxInt(u32));
        assert(tested.len <= std.math.maxInt(u32));
        if (tested.len != reference.len) return false;
        for (tested, reference) |t, r| {
            const lower = if (t >= 'A' and t <= 'Z') t | 0x20 else t;
            if (lower != r) return false;
        }
        return true;
    }

    // the same, against a reference built from pieces and lowercased, as css-tree lowercases
    // keyword and function names when it builds the graph
    fn equalKey(tested: []const u8, key: [3][]const u8) bool {
        assert(key[0].len <= 1 and key[2].len <= 1);
        assert(key[1].len > 0);
        const len = key[0].len + key[1].len + key[2].len;
        if (tested.len != len) return false;
        for (tested, 0..) |t, i| {
            const lower = if (t >= 'A' and t <= 'Z') t | 0x20 else t;
            if (lower != std.ascii.toLower(graph_.Builder.keyByte(key, i))) return false;
        }
        return true;
    }

    fn range(m: *const Matcher) ?generic.Range {
        assert(m.syntax_top == none or m.syntax_top < m.syntaxes.items.len);
        if (m.syntax_top == none) return null;
        const opts = m.syntaxes.items[m.syntax_top].opts;
        if (opts == none) return null;
        assert(m.lexer.defs.node(opts).tag == .range);
        return .{
            .min = bound(m.lexer.defs.text(opts)),
            .max = bound(m.lexer.defs.text(opts + 1)),
        };
    }

    fn bound(text: []const u8) generic.Bound {
        assert(text.len <= std.math.maxInt(u16));
        if (text.len == 0) return .infinite;
        const negative = text[0] == '-';
        var end: usize = @intFromBool(negative);
        while (end < text.len and std.ascii.isDigit(text[end])) end += 1;
        if (end < text.len) return .unit;
        assert(end > @intFromBool(negative));
        const value = generic.decimal(text[@intFromBool(negative)..end]);
        return .{ .number = if (negative) -value else value };
    }

    fn onceState(m: *Matcher, once: Once) !u32 {
        assert(once.node < m.lexer.graph.nodes.items.len);
        const index: u32 = @intCast(m.onces.items.len);
        assert(index < dynamic);
        try push(Once, m.gpa, &m.onces, once);
        return index | dynamic;
    }

    /// Runs `tokens` through the graph at `root`, which is a `match_graph`.
    pub fn run(m: *Matcher, lexer: *Lexer, tokens: Tokens, root: u32) !Result {
        assert(root < lexer.graph.nodes.items.len);
        assert(lexer.graph.node(root).kind == .match_graph);
        m.lexer = lexer;
        m.tokens = tokens;
        m.matches.clearRetainingCapacity();
        m.syntaxes.clearRetainingCapacity();
        m.thens.clearRetainingCapacity();
        m.elses.clearRetainingCapacity();
        m.onces.clearRetainingCapacity();
        try m.matches.append(
            m.gpa,
            .{ .entry = .stub, .syntax = none, .token = none, .prev = none },
        );
        m.state = root;
        m.match_top = 0;
        m.syntax_top = none;
        m.then_top = none;
        m.else_top = none;
        m.stash = stash_empty;
        m.token = none;
        m.longest = 0;
        m.moveToNextToken();

        var status: ?Status = null;
        var iterations: u32 = 0;
        var reference: u32 = none;
        while (status == null) {
            iterations += 1;
            if (iterations >= iteration_limit) break;
            if (m.state & dynamic != 0) {
                try m.stepOnce();
                continue;
            }
            const node = m.lexer.graph.node(m.state);
            switch (node.kind) {
                .match => {
                    if (m.then_top == none) {
                        if (m.token < m.tokens.len()) {
                            // one IE hack token may be left over
                            const text = m.tokenText(m.token);
                            const hack = std.mem.eql(
                                u8,
                                text,
                                "\\0",
                            ) or std.mem.eql(u8, text, "\\9");
                            if (m.token != m.tokens.len() - 1 or !hack) {
                                m.state = graph_.mismatch;
                                continue;
                            }
                        }
                        status = .match;
                        continue;
                    }
                    const then = m.thens.items[m.then_top];
                    m.state = then.state;
                    if (m.state == graph_.disallow_empty) {
                        if (then.match == m.match_top) {
                            m.state = graph_.mismatch;
                            continue;
                        }
                        m.state = graph_.match;
                    }
                    while (then.syntax != m.syntax_top) try m.closeSyntax();
                    m.then_top = then.prev;
                },
                .mismatch => {
                    if (m.stash != stash_empty and m.stash != stash_off) {
                        if (m.else_top == none or m.token > m.elses.items[m.else_top].token) {
                            m.else_top = m.stash;
                            m.stash = stash_off;
                        }
                    } else if (m.else_top == none) {
                        status = .mismatch;
                        continue;
                    }
                    const back = m.elses.items[m.else_top];
                    m.state = back.state;
                    m.then_top = back.then;
                    m.syntax_top = back.syntax;
                    m.match_top = back.match;
                    m.token = back.token;
                    m.else_top = back.prev;
                },
                .match_graph => m.state = node.a,
                .@"if" => {
                    // the else branch first: it records the then stack before the push
                    if (node.c != graph_.mismatch) try m.pushElse(node.c);
                    if (node.b != graph_.match) try m.pushThen(node.b);
                    m.state = node.a;
                },
                .match_once => m.state = try m.onceState(
                    .{ .node = m.state, .index = 0, .mask = 0, .add = false },
                ),
                .@"enum" => m.state = m.enumTerm(node),
                .generic => {
                    const g: generic.Generic = @fromBackingInt(@intCast(node.small));
                    const count = generic.match(g, &m.tokens, m.token, m.range(), &m.lexer.units);
                    if (count == 0 or m.token >= m.tokens.len()) {
                        m.state = graph_.mismatch;
                        continue;
                    }
                    const last = m.token + count;
                    while (m.token < last) try m.addTokenToMatch(none);
                    m.state = graph_.match;
                },
                .type, .property => {
                    if (node.a == none) {
                        reference = node.b;
                        status = .bad_reference;
                        continue;
                    }
                    if (node.kind == .type and m.stash != stash_off and m.token < m.tokens.len()) {
                        const name = m.lexer.defs.text(node.b);
                        const tag = m.tokens.tag(m.token);
                        // a <custom-ident> claims a keyword only when nothing else can, and a 0
                        // reads as a <number> before a <length>
                        const low = (tag == .ident and std.mem.eql(u8, name, "custom-ident")) or
                            (std.mem.eql(
                                u8,
                                name,
                                "length",
                            ) and std.mem.eql(u8, m.tokenText(m.token), "0"));
                        if (low) {
                            if (m.stash == stash_empty) m.stash = try m.snapshot(
                                m.state,
                                m.else_top,
                            );
                            m.state = graph_.mismatch;
                            continue;
                        }
                    }
                    try m.openSyntax(node.b);
                    m.state = try m.lexer.graphOf(node.a, true);
                },
                .keyword => {
                    if (m.token < m.tokens.len()) {
                        const name = m.lexer.defs.text(node.b);
                        if (equalKey(withoutHack(m.tokenText(m.token)), .{ "", name, "" })) {
                            try m.addTokenToMatch(node.b);
                            m.state = graph_.match;
                            continue;
                        }
                    }
                    m.state = graph_.mismatch;
                },
                .at_keyword, .function => {
                    if (m.token < m.tokens.len()) {
                        const name = m.lexer.defs.text(node.b);
                        const key: [3][]const u8 = if (node.kind == .at_keyword) .{
                            "@",
                            name,
                            "",
                        } else .{ "", name, "(" };
                        if (equalKey(m.tokenText(m.token), key)) {
                            try m.addTokenToMatch(node.b);
                            m.state = graph_.match;
                            continue;
                        }
                    }
                    m.state = graph_.mismatch;
                },
                .token => {
                    if (m.token < m.tokens.len()) {
                        var value = m.lexer.defs.text(node.b);
                        if (node.flags == 1) value = value[1 .. value.len - 1];
                        if (std.mem.eql(u8, m.tokenText(m.token), value)) {
                            try m.addTokenToMatch(node.b);
                            m.state = graph_.match;
                            continue;
                        }
                    }
                    m.state = graph_.mismatch;
                },
                .comma => {
                    const previous = m.cell(m.match_top).token;
                    if (m.tokenTag() == .comma) {
                        if (m.isCommaContextStart(previous)) {
                            m.state = graph_.mismatch;
                        } else {
                            try m.addTokenToMatch(node.b);
                            const end = m.isCommaContextEnd(m.token);
                            m.state = if (end) graph_.mismatch else graph_.match;
                        }
                    } else {
                        const start = m.isCommaContextStart(previous);
                        const pass = start or m.isCommaContextEnd(m.token);
                        m.state = if (pass) graph_.match else graph_.mismatch;
                    }
                },
                .string => {
                    const value = m.lexer.graph.string(node);
                    var last = m.token;
                    var len: usize = 0;
                    while (last < m.tokens.len() and len < value.len) : (last += 1) {
                        len += m.tokenText(last).len;
                    }
                    const start = if (m.token < m.tokens.len()) m.tokens.start(m.token) else 0;
                    const inside = m.token < m.tokens.len();
                    const tested = if (inside) m.tokens.source[start..][0..len] else "";
                    if (equalTested(tested, value)) {
                        while (m.token < last) try m.addTokenToMatch(node.b);
                        m.state = graph_.match;
                    } else m.state = graph_.mismatch;
                },
                .disallow_empty => unreachable,
            }
        }
        var top = m.match_top;
        const done = status orelse .iteration_limit;
        if (done == .match) {
            var closes: u32 = 0;
            while (m.syntax_top != none) : (closes += 1) {
                assert(closes < m.syntaxes.items.len);
                try m.closeSyntax();
            }
            top = m.match_top;
        } else top = none;
        return .{
            .status = done,
            .iterations = iterations,
            .longest = m.longest,
            .top = top,
            .reference = reference,
        };
    }

    fn enumTerm(m: *const Matcher, node: graph_.Node) u32 {
        assert(node.kind == .@"enum");
        assert(node.small < 32);
        if (m.token >= m.tokens.len()) return graph_.mismatch;
        const name = withoutHack(m.tokenText(m.token));
        const key: [3][]const u8 = .{ "", name, "" };
        const size = @as(u32, 1) << @intCast(node.small);
        var slot = graph_.Builder.hashKey(key) & (size - 1);
        const slots = m.lexer.graph.lists.items[node.a..][0..size];
        var probes: u32 = 0;
        while (slots[slot] != 0 and probes < size) : (probes += 1) {
            const term = m.lexer.graph.node(slots[slot]);
            if (equalKey(name, graph_.Builder.enumKey(m.lexer.defs, term))) return slots[slot];
            slot = (slot + 1) & (size - 1);
        }
        return graph_.mismatch;
    }

    fn stepOnce(m: *Matcher) !void {
        assert(m.state & dynamic != 0);
        const once = m.onces.items[m.state & ~dynamic];
        if (once.add) {
            m.state = try m.onceState(
                .{ .node = once.node, .index = 0, .mask = once.mask, .add = false },
            );
            return;
        }
        const group = m.lexer.graph.node(once.node);
        const terms = m.lexer.graph.lists.items[group.a..][0..group.small];
        assert(terms.len < 32);
        if (once.index == terms.len) {
            m.state = if (once.mask == 0 or group.flags == 1) graph_.mismatch else graph_.match;
            return;
        }
        if (once.mask == (@as(u32, 1) << @intCast(terms.len)) - 1) {
            m.state = graph_.match;
            return;
        }
        var index = once.index;
        while (index < terms.len) : (index += 1) {
            const bit = @as(u32, 1) << @intCast(index);
            if (once.mask & bit != 0) continue;
            // the else branch resumes this buffer at the next term
            try m.pushElse(
                try m.onceState(
                    .{ .node = once.node, .index = index + 1, .mask = once.mask, .add = false },
                ),
            );
            try m.pushThen(
                try m.onceState(
                    .{ .node = once.node, .index = 0, .mask = once.mask | bit, .add = true },
                ),
            );
            m.state = terms[index];
            return;
        }
        m.state = try m.onceState(
            .{ .node = once.node, .index = index, .mask = once.mask, .add = false },
        );
    }
};
