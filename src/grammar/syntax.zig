//! The CSS Value Definition Syntax, read as css-tree's `definitionSyntax.parse` reads it: the same
//! tree, the same errors at the same offsets.
//!
//! A tree is a preorder list of 8-byte nodes. A group stores its term count and its subtree size,
//! so terms are found by skipping, a multiplier's or boolean's term is the next node, and a type
//! with a range is followed by its `range` and `range_end` nodes. Names are spans of the text the
//! tree was read from.

const std = @import("std");
const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

pub const Tag = enum(u8) {
    group,
    multiplier,
    boolean,
    type,
    property,
    keyword,
    at_keyword,
    function,
    token,
    string,
    comma,
    /// The lower bound of a type's range, empty for `-∞`.
    range,
    /// The upper bound of a type's range, empty for `∞`.
    range_end,
};

/// css-tree's combinators, by precedence: juxtaposition binds tightest.
pub const Combinator = enum(u2) {
    juxtapose,
    all,
    any,
    one,

    pub fn text(combinator: Combinator) []const u8 {
        return switch (combinator) {
            .juxtapose => " ",
            .all => "&&",
            .any => "||",
            .one => "|",
        };
    }
};

pub const flag = struct {
    /// Group: the low two bits are the combinator.
    pub const combinator: u8 = 0b11;
    pub const explicit: u8 = 1 << 2;
    pub const disallow_empty: u8 = 1 << 3;
    /// Multiplier: `#`.
    pub const comma: u8 = 1 << 0;
    /// Type: a `range` and a `range_end` node follow.
    pub const range: u8 = 1 << 0;
};

pub const Node = extern struct {
    tag: Tag,
    flags: u8 = 0,
    /// A group's term count, a multiplier's minimum, or the length of a name or text.
    len: u16 = 0,
    /// A group's subtree size, a multiplier's maximum (0 is unbounded), or the offset of a name.
    data: u32 = 0,

    pub fn combinator(node: Node) Combinator {
        assert(node.tag == .group);
        assert(node.flags & ~@as(u8, 0b1111) == 0);
        return @fromBackingInt(@intCast(node.flags & flag.combinator));
    }

    pub fn text(node: Node, source: []const u8) []const u8 {
        assert(node.tag != .group and node.tag != .multiplier);
        assert(node.data + node.len <= source.len);
        return source[node.data..][0..node.len];
    }
};

comptime {
    assert(@sizeOf(Node) == 8);
}

/// The node after `index` and its subtree.
pub fn skip(nodes: []const Node, index: u32) u32 {
    assert(index < nodes.len);
    var at = index;
    var multipliers: u32 = 0;
    // a multiplier chain ends at its term, so the chain is no longer than the tree
    while (nodes[at].tag == .multiplier or nodes[at].tag == .boolean) : (multipliers += 1) {
        assert(multipliers < nodes.len);
        at += 1;
    }
    const node = nodes[at];
    const size: u32 = switch (node.tag) {
        .group => node.data,
        .type => if (node.flags & flag.range != 0) 3 else 1,
        else => 1,
    };
    assert(at + size <= nodes.len);
    return at + size;
}

pub const Message = enum(u8) {
    expect_apostrophe,
    expect_number,
    expect_keyword,
    unexpected_combinator,
    unexpected_input,
    expect_char,
    too_deep,
    too_large,

    pub fn text(message: Message) []const u8 {
        return switch (message) {
            .expect_apostrophe => "Expect an apostrophe",
            .expect_number => "Expect a number",
            .expect_keyword => "Expect a keyword",
            .unexpected_combinator => "Unexpected combinator",
            .unexpected_input => "Unexpected input",
            .expect_char => "Expect `{c}`",
            .too_deep => "Nesting is too deep",
            .too_large => "Number is too large",
        };
    }
};

/// Where and why a parse failed. css-tree's offset is `offset - base`, both in source bytes.
pub const Failure = struct {
    message: Message,
    /// The character `expect_char` wanted.
    char: u8 = 0,
    offset: u32,
    base: u32 = 0,
};

pub const Error = error{ OutOfMemory, Syntax };

// bounds the recursion of reading and emitting
pub const depth_max = 64;

const tab = '\t';

// css-tree's name characters, [a-zA-Z0-9-]
const name_char: [256]bool = blk: {
    var t: [256]bool = @splat(false);
    for (0..256) |c| t[c] = std.ascii.isAlphanumeric(c) or c == '-';
    break :blk t;
};

fn isSpace(c: u8) bool {
    return c == ' ' or c == tab or c == '\n' or c == '\r' or c == 0x0C;
}

const infinity = "\u{221E}";

// a term while reading: its node, its children in `kids`
const Draft = struct {
    node: Node,
    kids_start: u32 = 0,
    kids_len: u32 = 0,
};

const Item = union(enum) {
    term: u32,
    combinator: Combinator,
};

/// Reads definition syntax into a tree whose spans are offsets into `source` plus `base`.
pub const Parser = struct {
    gpa: Allocator,
    source: []const u8,
    pos: u32 = 0,
    drafts: std.ArrayList(Draft) = .empty,
    kids: std.ArrayList(u32) = .empty,
    depth: u32 = 0,
    failure: Failure = .{ .message = .unexpected_input, .offset = 0 },

    pub fn deinit(p: *Parser) void {
        p.drafts.deinit(p.gpa);
        p.kids.deinit(p.gpa);
        p.* = undefined;
    }

    fn charAt(p: *const Parser, at: u32) u8 {
        return if (at < p.source.len) p.source[at] else 0;
    }

    fn char(p: *const Parser) u8 {
        return p.charAt(p.pos);
    }

    fn fail(p: *Parser, message: Message) Error {
        @branchHint(.cold);
        p.failure = .{ .message = message, .offset = p.pos };
        return error.Syntax;
    }

    fn eat(p: *Parser, c: u8) Error!void {
        assert(c != 0);
        if (p.char() != c) {
            p.failure = .{ .message = .expect_char, .char = c, .offset = p.pos };
            return error.Syntax;
        }
        p.pos += 1;
    }

    fn wsEnd(p: *const Parser, from: u32) u32 {
        var at = from;
        while (at < p.source.len and isSpace(p.source[at])) at += 1;
        assert(at <= p.source.len);
        return at;
    }

    fn skipWs(p: *Parser) void {
        p.pos = p.wsEnd(p.pos);
    }

    fn isInfinity(p: *const Parser) bool {
        return std.mem.startsWith(u8, p.source[@min(p.pos, p.source.len)..], infinity);
    }

    // one character, as css-tree's `peek` takes one; here a whole UTF-8 sequence
    fn charLen(p: *const Parser) u32 {
        assert(p.pos < p.source.len);
        const len = std.unicode.utf8ByteSequenceLength(p.source[p.pos]) catch 1;
        return @min(len, @as(u32, @intCast(p.source.len)) - p.pos);
    }

    fn word(p: *Parser) Error!u32 {
        const start = p.pos;
        while (p.pos < p.source.len and name_char[p.source[p.pos]]) p.pos += 1;
        if (p.pos == start) return p.fail(.expect_keyword);
        if (p.pos - start > std.math.maxInt(u16)) return p.fail(.too_large);
        assert(p.pos > start);
        return start;
    }

    fn number(p: *Parser) Error!u32 {
        const start = p.pos;
        while (p.pos < p.source.len and std.ascii.isDigit(p.source[p.pos])) p.pos += 1;
        if (p.pos == start) return p.fail(.expect_number);
        assert(p.pos > start);
        return start;
    }

    fn add(p: *Parser, draft: Draft) Error!u32 {
        assert(draft.kids_start + draft.kids_len <= p.kids.items.len);
        const index: u32 = @intCast(p.drafts.items.len);
        try p.drafts.append(p.gpa, draft);
        return index;
    }

    fn addWithKids(p: *Parser, node: Node, kids: []const u32) Error!u32 {
        assert(kids.len <= std.math.maxInt(u16));
        const start: u32 = @intCast(p.kids.items.len);
        try p.kids.appendSlice(p.gpa, kids);
        return p.add(.{ .node = node, .kids_start = start, .kids_len = @intCast(kids.len) });
    }

    fn span(start: u32, end: u32) Node {
        assert(start <= end);
        assert(end - start <= std.math.maxInt(u16));
        return .{ .tag = .token, .len = @intCast(end - start), .data = start };
    }

    fn named(tag: Tag, start: u32, end: u32) Node {
        var node = span(start, end);
        node.tag = tag;
        return node;
    }

    fn rangeLimit(p: *Parser) Error!u32 {
        if (p.char() == '-' and std.mem.startsWith(u8, p.source[p.pos + 1 ..], infinity)) {
            p.pos += 1 + infinity.len;
            return p.add(.{ .node = named(.range, p.pos, p.pos) });
        }
        const start = p.pos;
        if (p.char() == '-') p.pos += 1;
        _ = try p.number();
        if (p.pos < p.source.len and name_char[p.source[p.pos]]) _ = try p.word();
        return p.add(.{ .node = named(.range, start, p.pos) });
    }

    // `[min,max]` after a type name
    fn typeRange(p: *Parser) Error![2]u32 {
        try p.eat('[');
        const min = try p.rangeLimit();
        p.skipWs();
        try p.eat(',');
        p.skipWs();
        var max: u32 = undefined;
        if (p.isInfinity()) {
            p.pos += infinity.len;
            max = try p.add(.{ .node = named(.range_end, p.pos, p.pos) });
        } else {
            const start = p.pos;
            if (p.char() == '-') p.pos += 1;
            _ = try p.number();
            if (p.pos < p.source.len and name_char[p.source[p.pos]]) _ = try p.word();
            max = try p.add(.{ .node = named(.range_end, start, p.pos) });
        }
        try p.eat(']');
        assert(min < max);
        return .{ min, max };
    }

    fn multiplierRange(p: *Parser) Error![2]u32 {
        try p.eat('{');
        p.skipWs();
        const min = try p.integer(try p.number());
        p.skipWs();
        var max = min;
        if (p.char() == ',') {
            p.pos += 1;
            p.skipWs();
            max = 0;
            if (p.char() != '}') {
                max = try p.integer(try p.number());
                p.skipWs();
            }
        }
        try p.eat('}');
        assert(p.source[p.pos - 1] == '}');
        return .{ min, max };
    }

    fn integer(p: *Parser, start: u32) Error!u32 {
        assert(start < p.pos);
        return std.fmt.parseInt(u32, p.source[start..p.pos], 10) catch {
            p.pos = start;
            return p.fail(.too_large);
        };
    }

    fn multiplier(p: *Parser) Error!?Node {
        var min: u32 = 0;
        var max: u32 = 0;
        var flags: u8 = 0;
        switch (p.char()) {
            '*' => p.pos += 1,
            '+' => {
                p.pos += 1;
                min = 1;
            },
            '?' => {
                p.pos += 1;
                max = 1;
            },
            '#' => {
                p.pos += 1;
                flags = flag.comma;
                if (p.char() == '{') {
                    min, max = try p.multiplierRange();
                } else if (p.char() == '?') {
                    p.pos += 1;
                } else {
                    min = 1;
                }
            },
            '{' => {
                min, max = try p.multiplierRange();
            },
            else => return null,
        }
        if (min > std.math.maxInt(u16)) return p.fail(.too_large);
        assert(p.pos > 0);
        return .{ .tag = .multiplier, .flags = flags, .len = @intCast(min), .data = max };
    }

    fn multiplied(p: *Parser, term: u32) Error!u32 {
        assert(term < p.drafts.items.len);
        var node = term;
        // `+#`, `{A}?` and `{A,B}?` stack, so a chain is at most three long
        var chain: u32 = 0;
        while (try p.multiplier()) |m| : (chain += 1) {
            assert(chain < 3);
            node = try p.addWithKids(m, &.{node});
            const c = p.char();
            const prev = p.source[p.pos - 1];
            if (!(c == '#' and prev == '+') and !(c == '?' and prev == '}')) break;
        }
        return node;
    }

    fn token(p: *Parser) Error!?u32 {
        if (p.pos >= p.source.len) return null;
        const start = p.pos;
        p.pos += p.charLen();
        return try p.multiplied(try p.add(.{ .node = span(start, p.pos) }));
    }

    fn typeNode(p: *Parser) Error!u32 {
        try p.eat('<');
        const start = try p.word();
        if (std.mem.eql(u8, p.source[start..p.pos], "boolean-expr")) {
            try p.eat('[');
            const terms = try p.implicitGroup(']');
            try p.eat(']');
            try p.eat('>');
            const draft = p.drafts.items[terms];
            const term = if (draft.kids_len == 1) p.kids.items[draft.kids_start] else terms;
            const node: Node = .{ .tag = .boolean };
            return p.multiplied(try p.addWithKids(node, &.{term}));
        }
        if (p.char() == '(' and p.charAt(p.pos + 1) == ')') p.pos += 2;
        const name = named(.type, start, p.pos);
        if (p.charAt(p.wsEnd(p.pos)) == '[') {
            p.skipWs();
            const range = try p.typeRange();
            try p.eat('>');
            var node = name;
            node.flags = flag.range;
            return p.multiplied(try p.addWithKids(node, &range));
        }
        try p.eat('>');
        return p.multiplied(try p.add(.{ .node = name }));
    }

    fn property(p: *Parser) Error!u32 {
        try p.eat('<');
        try p.eat('\'');
        const start = try p.word();
        const end = p.pos;
        try p.eat('\'');
        try p.eat('>');
        return p.multiplied(try p.add(.{ .node = named(.property, start, end) }));
    }

    const Peeked = union(enum) {
        term: u32,
        function: u32,
        combinator: Combinator,
        comma: u32,
        spaces,
    };

    fn peek(p: *Parser) Error!?Peeked {
        const c = p.char();
        switch (c) {
            ']' => return null,
            '[' => return .{ .term = try p.multiplied(try p.group()) },
            '<' => return .{
                .term = if (p.charAt(p.pos + 1) == '\'') try p.property() else try p.typeNode(),
            },
            '|' => {
                const double = p.charAt(p.pos + 1) == '|';
                p.pos += if (double) 2 else 1;
                return .{ .combinator = if (double) .any else .one };
            },
            '&' => {
                p.pos += 1;
                try p.eat('&');
                return .{ .combinator = .all };
            },
            ',' => {
                p.pos += 1;
                return .{ .comma = try p.add(.{ .node = .{ .tag = .comma } }) };
            },
            '\'' => {
                const start = p.pos;
                const end = std.mem.indexOfScalarPos(u8, p.source, p.pos + 1, '\'') orelse {
                    p.pos = @intCast(p.source.len);
                    return p.fail(.expect_apostrophe);
                };
                p.pos = @intCast(end + 1);
                var node = span(start, p.pos);
                node.tag = .string;
                return .{ .term = try p.multiplied(try p.add(.{ .node = node })) };
            },
            ' ', tab, '\n', '\r', 0x0C => {
                p.skipWs();
                return .spaces;
            },
            '@' => {
                if (name_char[p.charAt(p.pos + 1)]) {
                    p.pos += 1;
                    const start = try p.word();
                    return .{ .term = try p.add(.{ .node = named(.at_keyword, start, p.pos) }) };
                }
                return if (try p.token()) |t| .{ .term = t } else null;
            },
            '*', '+', '?', '#', '!' => return null,
            '{' => {
                if (std.ascii.isDigit(p.charAt(p.pos + 1))) return null;
                return if (try p.token()) |t| .{ .term = t } else null;
            },
            else => {
                if (name_char[c] and p.pos < p.source.len) {
                    const start = try p.word();
                    if (p.char() == '(') {
                        const node = named(.function, start, p.pos);
                        p.pos += 1;
                        return .{ .function = try p.add(.{ .node = node }) };
                    }
                    const node = named(.keyword, start, p.pos);
                    return .{ .term = try p.multiplied(try p.add(.{ .node = node })) };
                }
                return if (try p.token()) |t| .{ .term = t } else null;
            },
        }
    }

    fn group(p: *Parser) Error!u32 {
        try p.eat('[');
        const index = try p.implicitGroup(']');
        try p.eat(']');
        const draft = &p.drafts.items[index];
        assert(draft.node.tag == .group);
        draft.node.flags |= flag.explicit;
        if (p.char() == '!') {
            p.pos += 1;
            draft.node.flags |= flag.disallow_empty;
        }
        return index;
    }

    /// css-tree's `readImplicitGroup`: terms and combinators up to `stop`, regrouped by precedence.
    fn implicitGroup(p: *Parser, stop: u8) Error!u32 {
        if (p.depth == depth_max) return p.fail(.too_deep);
        p.depth += 1;
        defer p.depth -= 1;

        var items: std.ArrayList(Item) = .empty;
        defer items.deinit(p.gpa);
        var present: [4]bool = @splat(false);
        // the previous item, a term or a combinator, and where reading it ended
        var prev: ?Item = null;
        var prev_pos = p.pos;
        var after_function = false;

        // each turn consumes input or ends, so the source length bounds the loop
        var turns: u32 = 0;
        while (p.char() != stop or (stop == 0 and p.pos < p.source.len)) : (turns += 1) {
            assert(turns <= p.source.len + 1);
            var item: Item = undefined;
            if (after_function) {
                const inner = try p.implicitGroup(')');
                const draft = p.drafts.items[inner];
                if (draft.kids_len == 0) {
                    after_function = false;
                    continue;
                }
                item = .{ .term = inner };
                if (draft.node.combinator() == .juxtapose) {
                    const kids = p.kids.items[draft.kids_start..][0..draft.kids_len];
                    for (kids[0 .. kids.len - 1]) |kid| {
                        present[@backingInt(Combinator.juxtapose)] = true;
                        try items.append(p.gpa, .{ .combinator = .juxtapose });
                        try items.append(p.gpa, .{ .term = kid });
                    }
                    item = .{ .term = kids[kids.len - 1] };
                }
            } else {
                const peeked = try p.peek() orelse break;
                item = switch (peeked) {
                    .spaces => continue,
                    .combinator => |c| .{ .combinator = c },
                    .term, .function, .comma => |t| .{ .term = t },
                };
                if (item == .combinator) {
                    if (prev == null or prev.? == .combinator) {
                        p.pos = prev_pos;
                        return p.fail(.unexpected_combinator);
                    }
                    present[@backingInt(item.combinator)] = true;
                }
            }
            if (item == .term and prev != null and prev.? == .term) {
                present[@backingInt(Combinator.juxtapose)] = true;
                try items.append(p.gpa, .{ .combinator = .juxtapose });
            }
            try items.append(p.gpa, item);
            prev = item;
            prev_pos = p.pos;
            after_function = item == .term and p.drafts.items[item.term].node.tag == .function;
        }
        if (prev != null and prev.? == .combinator) {
            p.failure = .{ .message = .unexpected_combinator, .offset = p.pos, .base = prev_pos };
            return error.Syntax;
        }
        const combinator = try p.regroup(&items, present);
        var terms: std.ArrayList(u32) = .empty;
        defer terms.deinit(p.gpa);
        for (items.items) |item| try terms.append(p.gpa, item.term);
        const node: Node = .{ .tag = .group, .flags = @backingInt(combinator) };
        return p.addWithKids(node, terms.items);
    }

    /// css-tree's `regroupTerms`: wraps runs joined by a tighter combinator in groups, leaving
    /// only the loosest combinator present at the top, which it returns.
    fn regroup(p: *Parser, items: *std.ArrayList(Item), present: [4]bool) Error!Combinator {
        var result: Combinator = .juxtapose;
        var remaining: u32 = 0;
        for (present) |is| remaining += @intFromBool(is);
        assert(remaining <= 4);
        for (present, 0..) |is, c| {
            if (!is) continue;
            remaining -= 1;
            const combinator: Combinator = @fromBackingInt(@intCast(c));
            result = combinator;
            var i: i64 = 0;
            var start: i64 = 0;
            while (i < items.items.len) : (i += 1) {
                const item = items.items[@intCast(i)];
                if (item != .combinator) continue;
                if (item.combinator == combinator) {
                    if (start == -1) start = i - 1;
                    _ = items.orderedRemove(@intCast(i));
                    i -= 1;
                    continue;
                }
                if (start != -1 and i - start > 1) {
                    try p.wrap(items, @intCast(start), @intCast(i), combinator);
                    i = start + 1;
                }
                start = -1;
            }
            if (start != -1 and remaining > 0) {
                try p.wrap(items, @intCast(start), @intCast(i), combinator);
            }
        }
        for (items.items) |item| assert(item == .term);
        return result;
    }

    fn wrap(p: *Parser, items: *std.ArrayList(Item), start: u32, end: u32, c: Combinator) !void {
        assert(start < end);
        assert(end <= items.items.len);
        var terms: std.ArrayList(u32) = .empty;
        defer terms.deinit(p.gpa);
        for (items.items[start..end]) |item| try terms.append(p.gpa, item.term);
        const group_node: Node = .{ .tag = .group, .flags = @backingInt(c) };
        const index = try p.addWithKids(group_node, terms.items);
        try items.replaceRange(p.gpa, start, end - start, &.{.{ .term = index }});
    }

    fn emit(
        p: *const Parser,
        out: *std.ArrayList(Node),
        gpa: Allocator,
        index: u32,
        base: u32,
    ) !void {
        assert(index < p.drafts.items.len);
        assert(p.drafts.items.len <= std.math.maxInt(u32));
        const draft = p.drafts.items[index];
        var node = draft.node;
        const kids = p.kids.items[draft.kids_start..][0..draft.kids_len];
        const at = out.items.len;
        switch (node.tag) {
            .group => node.len = @intCast(kids.len),
            .multiplier, .boolean, .comma => {},
            else => node.data += base,
        }
        try out.append(gpa, node);
        // drafts only point back to earlier drafts, so the recursion ends, and reading bounded it
        for (kids) |kid| {
            assert(kid < index);
            try p.emit(out, gpa, kid, base);
        }
        if (node.tag == .group) out.items[at].data = @intCast(out.items.len - at);
    }
};

/// Parses `source` as css-tree does, appending the tree to `out` in preorder with spans shifted
/// by `base`. On `error.Syntax`, `failure` says why.
pub fn parse(
    gpa: Allocator,
    source: []const u8,
    base: u32,
    out: *std.ArrayList(Node),
    failure: *Failure,
) Error!void {
    assert(source.len < std.math.maxInt(u32) - base);
    var p: Parser = .{ .gpa = gpa, .source = source };
    defer p.deinit();
    const root = p.implicitGroup(0) catch |err| {
        if (err == error.Syntax) failure.* = p.failure;
        return err;
    };
    if (p.pos != source.len) {
        failure.* = .{ .message = .unexpected_input, .offset = p.pos };
        return error.Syntax;
    }
    var top = root;
    const draft = p.drafts.items[root];
    if (draft.kids_len == 1 and p.drafts.items[p.kids.items[draft.kids_start]].node.tag == .group) {
        top = p.kids.items[draft.kids_start];
    }
    const start = out.items.len;
    try p.emit(out, gpa, top, base);
    assert(out.items.len > start);
}

const testing = std.testing;

fn expectTree(source: []const u8, expected: []const u8) !void {
    var out: std.ArrayList(Node) = .empty;
    defer out.deinit(testing.allocator);
    var failure: Failure = undefined;
    try parse(testing.allocator, source, 0, &out, &failure);
    var buf: std.Io.Writer.Allocating = .init(testing.allocator);
    defer buf.deinit();
    for (out.items) |node| {
        try buf.writer.print("{s}", .{@tagName(node.tag)});
        if (node.tag == .group) try buf.writer.print("({s})", .{node.combinator().text()});
        if (node.tag != .group and node.tag != .multiplier and node.tag != .boolean) {
            try buf.writer.print("'{s}'", .{node.text(source)});
        }
        try buf.writer.writeAll(" ");
    }
    try testing.expectEqualStrings(expected, buf.written());
}

test "precedence" {
    try expectTree("a b | c", "group(|) group( ) keyword'a' keyword'b' keyword'c' ");
    try expectTree("a | b c", "group(|) keyword'a' group( ) keyword'b' keyword'c' ");
    try expectTree("<x [0,∞]>?", "group( ) multiplier type'x' range'0' range_end'' ");
}

test "errors" {
    var out: std.ArrayList(Node) = .empty;
    defer out.deinit(testing.allocator);
    var failure: Failure = undefined;
    try testing.expectError(error.Syntax, parse(testing.allocator, "<x>&&", 0, &out, &failure));
    try testing.expectEqual(Message.unexpected_combinator, failure.message);
    try testing.expectError(error.Syntax, parse(testing.allocator, "'x", 0, &out, &failure));
    try testing.expectEqual(Message.expect_apostrophe, failure.message);
}

/// Writes the tree at `index` as css-tree's `generate` does without options, and returns the index
/// past it.
pub fn generate(
    gpa: Allocator,
    nodes: []const Node,
    index: u32,
    source: []const u8,
    w: *std.Io.Writer,
) !u32 {
    assert(index < nodes.len);
    const node = nodes[index];
    switch (node.tag) {
        .group => {
            const combinator = node.combinator();
            var at = index + 1;
            var first: u8 = 0;
            var buf: std.Io.Writer.Allocating = .init(gpa);
            defer buf.deinit();
            for (0..node.len) |i| {
                if (i > 0) {
                    if (combinator == .juxtapose) try buf.writer.writeAll(" ") else {
                        try buf.writer.print(" {s} ", .{combinator.text()});
                    }
                }
                at = try generate(gpa, nodes, at, source, &buf.writer);
            }
            const joined = buf.written();
            if (joined.len > 0) first = joined[0];
            if (node.flags & flag.explicit != 0) {
                try w.print("{s}{s} ]", .{ if (first == ',') "[" else "[ ", joined });
            } else try w.writeAll(joined);
            if (node.flags & flag.disallow_empty != 0) try w.writeAll("!");
            assert(at == index + node.data);
            return at;
        },
        .multiplier => {
            const next = try generate(gpa, nodes, index + 1, source, w);
            const min = node.len;
            const max = node.data;
            const comma = node.flags & flag.comma != 0;
            if (min == 0 and max == 0) {
                try w.writeAll(if (comma) "#?" else "*");
            } else if (min == 0 and max == 1) {
                try w.writeAll("?");
            } else if (min == 1 and max == 0) {
                try w.writeAll(if (comma) "#" else "+");
            } else if (!(min == 1 and max == 1)) {
                if (comma) try w.writeAll("#");
                if (min == max) try w.print("{{{d}}}", .{min}) else if (max == 0) {
                    try w.print("{{{d},}}", .{min});
                } else try w.print("{{{d},{d}}}", .{ min, max });
            }
            return next;
        },
        .boolean => {
            try w.writeAll("<boolean-expr[");
            const next = try generate(gpa, nodes, index + 1, source, w);
            try w.writeAll("]>");
            return next;
        },
        .type => {
            try w.print("<{s}", .{node.text(source)});
            if (node.flags & flag.range != 0) {
                try w.writeAll(" [");
                try writeBound(nodes[index + 1].text(source), "-\u{221E}", w);
                try w.writeAll(",");
                try writeBound(nodes[index + 2].text(source), "\u{221E}", w);
                try w.writeAll("]");
            }
            try w.writeAll(">");
            return skip(nodes, index);
        },
        .property => try w.print("<'{s}'>", .{node.text(source)}),
        .keyword, .token, .string => try w.writeAll(node.text(source)),
        .at_keyword => try w.print("@{s}", .{node.text(source)}),
        .function => try w.print("{s}(", .{node.text(source)}),
        .comma => try w.writeAll(","),
        .range, .range_end => unreachable,
    }
    return index + 1;
}

// a bound as JavaScript prints `sign * Number(digits)`, with its unit
fn writeBound(bound: []const u8, infinite: []const u8, w: *std.Io.Writer) !void {
    if (bound.len == 0) return w.writeAll(infinite);
    const negative = bound[0] == '-';
    const digits_start: usize = @intFromBool(negative);
    var digits_end = digits_start;
    while (digits_end < bound.len and std.ascii.isDigit(bound[digits_end])) digits_end += 1;
    assert(digits_end > digits_start);
    const digits = std.mem.trimStart(u8, bound[digits_start..digits_end], "0");
    if (digits.len == 0) {
        try w.writeAll("0");
    } else try w.print("{s}{s}", .{ if (negative) "-" else "", digits });
    try w.writeAll(bound[digits_end..]);
}
