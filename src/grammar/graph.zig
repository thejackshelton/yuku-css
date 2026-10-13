//! css-tree's match graph: a definition compiled into `if match then ... else ...` states, built
//! the way `buildMatchGraph` builds it, node for node, so matching backtracks in the same order.

const std = @import("std");
const syntax = @import("syntax.zig");
const generic = @import("generic.zig");
const Defs = @import("defs.zig").Defs;

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;

pub const none = std.math.maxInt(u32);

pub const Kind = enum(u8) {
    match,
    mismatch,
    disallow_empty,
    @"if",
    match_once,
    @"enum",
    generic,
    /// A descriptor's graph: `a` is its root, `b` its descriptor.
    match_graph,
    type,
    property,
    keyword,
    at_keyword,
    function,
    token,
    string,
    comma,
};

/// What a `<!name>` type stands for in `<boolean-expr[ ]>`'s expansion.
pub const Placeholder = enum(u8) { none, boolean_group, term, self };

pub const Node = extern struct {
    kind: Kind,
    /// `match_once`: whether every term must match. `type`: a `Placeholder`. `token`: 1 when it
    /// is a one-character string, so its value is inside the quotes.
    flags: u8 = 0,
    /// `match_once`: the term count. `generic`: the type. `enum`: the slot count's log2.
    small: u16 = 0,
    /// `if`: the condition. `match_once`, `enum`: the first term or slot. `type`, `property`: the
    /// descriptor, `none` when the name is not defined. `string`: the value's start in `strings`.
    a: u32 = 0,
    /// `if`: the then branch. Otherwise the definition node this state matches.
    b: u32 = none,
    /// `if`: the else branch. `string`: the value's length.
    c: u32 = 0,
};

comptime {
    assert(@sizeOf(Node) == 16);
}

pub const match: u32 = 0;
pub const mismatch: u32 = 1;
pub const disallow_empty: u32 = 2;

/// Looks names up for the graph: `findType` and `findProperty` give a descriptor or `none`.
pub const Resolver = struct {
    context: *anyopaque,
    findType: *const fn (*anyopaque, []const u8) u32,
    findProperty: *const fn (*anyopaque, []const u8) u32,
};

pub const Graph = struct {
    nodes: std.ArrayList(Node) = .empty,
    /// `match_once` terms and `enum` slots.
    lists: std.ArrayList(u32) = .empty,
    strings: std.ArrayList(u8) = .empty,

    pub fn init(gpa: Allocator) !Graph {
        var g: Graph = .{};
        try g.nodes.appendSlice(gpa, &.{
            .{ .kind = .match },
            .{ .kind = .mismatch },
            .{ .kind = .disallow_empty },
        });
        assert(g.nodes.items[match].kind == .match);
        assert(g.nodes.items[disallow_empty].kind == .disallow_empty);
        return g;
    }

    pub fn deinit(g: *Graph, gpa: Allocator) void {
        g.nodes.deinit(gpa);
        g.lists.deinit(gpa);
        g.strings.deinit(gpa);
        g.* = undefined;
    }

    pub fn node(g: *const Graph, index: u32) Node {
        assert(index < g.nodes.items.len);
        return g.nodes.items[index];
    }

    /// The string a `string` state matches.
    pub fn string(g: *const Graph, n: Node) []const u8 {
        assert(n.kind == .string);
        return g.strings.items[n.a..][0..n.c];
    }
};

fn isFunctionType(name: []const u8) bool {
    return name.len > 2 and name[name.len - 2] == '(' and name[name.len - 1] == ')';
}

/// Builds graphs into `graph` from trees in `defs`.
pub const Builder = struct {
    gpa: Allocator,
    graph: *Graph,
    defs: *Defs,
    resolver: Resolver,

    fn add(b: *Builder, n: Node) !u32 {
        const index: u32 = @intCast(b.graph.nodes.items.len);
        assert(index < none);
        try b.graph.nodes.append(b.gpa, n);
        return index;
    }

    fn at(b: *Builder, index: u32) *Node {
        assert(index < b.graph.nodes.items.len);
        return &b.graph.nodes.items[index];
    }

    /// css-tree's `createCondition`, with its reductions.
    fn condition(b: *Builder, match_: u32, then_: u32, else_: u32) !u32 {
        if (then_ == match and else_ == mismatch) return match_;
        if (match_ == match and then_ == match and else_ == match) return match_;
        var m = match_;
        var t = then_;
        const inner = b.graph.node(m);
        if (inner.kind == .@"if" and inner.c == mismatch and t == match) {
            t = inner.b;
            m = inner.a;
        }
        return b.add(.{ .kind = .@"if", .a = m, .b = t, .c = else_ });
    }

    /// The graph of descriptor `descriptor`'s tree at `root`.
    pub fn descriptorGraph(b: *Builder, root: u32, descriptor: u32) !u32 {
        const inner = try b.build(root, 0);
        return b.add(.{ .kind = .match_graph, .a = inner, .b = descriptor });
    }

    /// css-tree's `matchRef`: a property whose definition is one comma-separated multiplier
    /// matches a single item where another definition references it.
    pub fn propertyReference(b: *Builder, root: u32, descriptor: u32) !u32 {
        const group = b.defs.node(root);
        assert(group.tag == .group);
        if (group.flags & syntax.flag.explicit != 0 or group.len != 1) return none;
        const term = b.defs.node(root + 1);
        if (term.tag != .multiplier or term.flags & syntax.flag.comma == 0) return none;
        var terms = [_]u32{try b.build(root + 2, 0)};
        const inner = try b.groupGraph(group.combinator(), &terms, false);
        return b.add(.{ .kind = .match_graph, .a = inner, .b = descriptor });
    }

    /// The graph of a generic type.
    pub fn genericGraph(b: *Builder, g: generic.Generic, descriptor: u32) !u32 {
        const inner = try b.add(.{ .kind = .generic, .small = @backingInt(g) });
        return b.add(.{ .kind = .match_graph, .a = inner, .b = descriptor });
    }

    const depth_max = 256;

    fn build(b: *Builder, index: u32, depth: u32) anyerror!u32 {
        if (depth > depth_max) return error.TooDeep;
        const def = b.defs.node(index);
        switch (def.tag) {
            .group => {
                var terms: std.ArrayList(u32) = .empty;
                defer terms.deinit(b.gpa);
                var term = index + 1;
                for (0..def.len) |_| {
                    try terms.append(b.gpa, try b.build(term, depth + 1));
                    term = b.defs.skip(term);
                }
                assert(term == index + def.data);
                var result = try b.groupGraph(def.combinator(), terms.items, false);
                if (def.flags & syntax.flag.disallow_empty != 0) {
                    result = try b.condition(result, disallow_empty, mismatch);
                }
                return result;
            },
            .multiplier => return b.multiplier(index, depth),
            .boolean => return b.boolean(index, depth),
            .type => {
                const name = b.defs.text(index);
                var placeholder: Placeholder = .none;
                var descriptor: u32 = none;
                if (name.len > 0 and name[0] == '!') {
                    placeholder = if (std.mem.eql(u8, name, "!term"))
                        .term
                    else if (std.mem.eql(u8, name, "!self")) .self else .boolean_group;
                } else descriptor = b.resolver.findType(b.resolver.context, name);
                return b.add(
                    .{
                        .kind = .type,
                        .flags = @backingInt(placeholder),
                        .a = descriptor,
                        .b = index,
                    },
                );
            },
            .property => {
                const descriptor = b.resolver.findProperty(b.resolver.context, b.defs.text(index));
                return b.add(.{ .kind = .property, .a = descriptor, .b = index });
            },
            .keyword => return b.add(.{ .kind = .keyword, .b = index }),
            .at_keyword => return b.add(.{ .kind = .at_keyword, .b = index }),
            .function => return b.add(.{ .kind = .function, .b = index }),
            .token => return b.add(.{ .kind = .token, .b = index }),
            .comma => return b.add(.{ .kind = .comma, .b = index }),
            .string => {
                const quoted = b.defs.text(index);
                assert(quoted.len >= 2);
                const inner = quoted[1 .. quoted.len - 1];
                // one character between the quotes is a token, as css-tree turns `'a'` into one
                const lead = if (inner.len > 0) inner[0] else 0;
                const first_len = std.unicode.utf8ByteSequenceLength(lead) catch 0;
                const one = inner.len > 0 and inner.len == first_len and
                    inner.len < 4;
                if (one) return b.add(.{ .kind = .token, .flags = 1, .b = index });
                const start: u32 = @intCast(b.graph.strings.items.len);
                var i: usize = 0;
                while (i < inner.len) : (i += 1) {
                    if (inner[i] == '\\' and i + 1 < inner.len and inner[i + 1] == '\'') i += 1;
                    try b.graph.strings.append(b.gpa, inner[i]);
                }
                const len: u32 = @intCast(b.graph.strings.items.len - start);
                return b.add(.{ .kind = .string, .a = start, .b = index, .c = len });
            },
            .range, .range_end => unreachable,
        }
    }

    fn enumCompatible(b: *const Builder, index: u32) bool {
        const n = b.graph.node(index);
        return switch (n.kind) {
            .keyword, .at_keyword, .function => true,
            .type => isFunctionType(b.defs.text(n.b)),
            else => false,
        };
    }

    /// The key an enum files a term under, as pieces: a prefix, a name, a suffix.
    pub fn enumKey(defs: *const Defs, n: Node) [3][]const u8 {
        const name = defs.text(n.b);
        return switch (n.kind) {
            .keyword => .{ "", name, "" },
            .at_keyword => .{ "@", name, "" },
            .function => .{ "", name, "(" },
            .type => .{ "", name[0 .. name.len - 1], "" },
            else => unreachable,
        };
    }

    fn sameKey(defs: *const Defs, a: Node, b: Node) bool {
        const x = enumKey(defs, a);
        const y = enumKey(defs, b);
        const lx = x[0].len + x[1].len + x[2].len;
        if (lx != y[0].len + y[1].len + y[2].len) return false;
        var i: usize = 0;
        while (i < lx) : (i += 1) {
            if (std.ascii.toLower(keyByte(x, i)) != std.ascii.toLower(keyByte(y, i))) return false;
        }
        return true;
    }

    pub fn keyByte(key: [3][]const u8, i: usize) u8 {
        if (i < key[0].len) return key[0][i];
        if (i < key[0].len + key[1].len) return key[1][i - key[0].len];
        return key[2][i - key[0].len - key[1].len];
    }

    pub fn hashKey(key: [3][]const u8) u32 {
        var h: u32 = 2166136261;
        for (key) |piece| for (piece) |c| {
            h = (h ^ std.ascii.toLower(c)) *% 16777619;
        };
        return h;
    }

    // fills enum `index`'s hash table from its terms, first come first kept
    fn finishEnum(b: *Builder, index: u32, terms: []const u32) !void {
        assert(terms.len > 0);
        var log2: u5 = 1;
        while ((@as(u32, 1) << log2) < terms.len * 2) log2 += 1;
        const size = @as(u32, 1) << log2;
        const start: u32 = @intCast(b.graph.lists.items.len);
        try b.graph.lists.appendNTimes(b.gpa, 0, size);
        for (terms) |term| {
            const key = enumKey(b.defs, b.graph.node(term));
            var slot = hashKey(key) & (size - 1);
            var probes: u32 = 0;
            while (b.graph.lists.items[start + slot] != 0) : (probes += 1) {
                assert(probes < size);
                slot = (slot + 1) & (size - 1);
            }
            b.graph.lists.items[start + slot] = term;
        }
        const n = b.at(index);
        n.a = start;
        n.small = log2;
    }

    /// css-tree's `buildGroupMatchGraph`.
    fn groupGraph(
        b: *Builder,
        combinator: syntax.Combinator,
        terms: []const u32,
        at_least_one: bool,
    ) !u32 {
        switch (combinator) {
            .juxtapose => {
                var result: u32 = match;
                var i = terms.len;
                while (i > 0) {
                    i -= 1;
                    result = try b.condition(terms[i], result, mismatch);
                }
                return result;
            },
            .one => {
                var result: u32 = mismatch;
                var map: u32 = none;
                var entries: std.ArrayList(u32) = .empty;
                defer entries.deinit(b.gpa);
                var i = terms.len;
                while (i > 0) {
                    i -= 1;
                    const term = terms[i];
                    if (b.enumCompatible(term)) {
                        if (map == none and i > 0 and b.enumCompatible(terms[i - 1])) {
                            map = try b.add(.{ .kind = .@"enum" });
                            result = try b.condition(map, match, result);
                        }
                        if (map != none) {
                            const known = for (entries.items) |entry| {
                                if (sameKey(
                                    b.defs,
                                    b.graph.node(entry),
                                    b.graph.node(term),
                                )) break true;
                            } else false;
                            if (!known) {
                                try entries.append(b.gpa, term);
                                continue;
                            }
                        }
                    }
                    if (map != none) {
                        try b.finishEnum(map, entries.items);
                        entries.clearRetainingCapacity();
                    }
                    map = none;
                    result = try b.condition(term, match, result);
                }
                if (map != none) try b.finishEnum(map, entries.items);
                return result;
            },
            .all, .any => {
                const all = combinator == .all;
                if (terms.len > 5) {
                    const start: u32 = @intCast(b.graph.lists.items.len);
                    try b.graph.lists.appendSlice(b.gpa, terms);
                    return b.add(.{
                        .kind = .match_once,
                        .flags = @intFromBool(all),
                        .small = @intCast(terms.len),
                        .a = start,
                    });
                }
                var result: u32 = if (!all and at_least_one) match else mismatch;
                var i = terms.len;
                var rest: [5]u32 = undefined;
                while (i > 0) {
                    i -= 1;
                    var then_: u32 = match;
                    if (terms.len > 1) {
                        var len: usize = 0;
                        for (terms, 0..) |other, j| {
                            if (j == i) continue;
                            rest[len] = other;
                            len += 1;
                        }
                        then_ = try b.groupGraph(combinator, rest[0..len], true);
                    }
                    result = try b.condition(terms[i], then_, result);
                }
                return result;
            },
        }
    }

    /// css-tree's `buildMultiplierMatchGraph`.
    fn multiplier(b: *Builder, index: u32, depth: u32) !u32 {
        const def = b.defs.node(index);
        const min: u32 = def.len;
        const max = def.data;
        const comma = def.flags & syntax.flag.comma != 0;
        var result: u32 = match;
        var term = try b.build(index + 1, depth + 1);
        if (max == 0) {
            term = try b.condition(term, disallow_empty, mismatch);
            // the then branch loops back, so it is filled in once the node exists
            result = try b.add(.{ .kind = .@"if", .a = term, .b = none, .c = mismatch });
            const again = try b.condition(match, match, result);
            b.at(result).b = again;
            if (comma) {
                const separator = try b.add(.{ .kind = .comma, .b = index });
                b.at(again).c = try b.condition(separator, result, mismatch);
            }
        } else {
            var i: u32 = @max(min, 1);
            while (i <= max) : (i += 1) {
                if (comma and result != match) {
                    const separator = try b.add(.{ .kind = .comma, .b = index });
                    result = try b.condition(separator, result, mismatch);
                }
                result = try b.condition(term, try b.condition(match, match, result), mismatch);
            }
        }
        if (min == 0) return b.condition(match, match, result);
        var i: u32 = 0;
        while (i + 1 < min) : (i += 1) {
            if (comma and result != match) {
                const separator = try b.add(.{ .kind = .comma, .b = index });
                result = try b.condition(separator, result, mismatch);
            }
            result = try b.condition(term, result, mismatch);
        }
        return result;
    }

    /// css-tree's `<boolean-expr[ test ]>`: its expansion, with the test and the groups put in
    /// for the placeholders.
    fn boolean(b: *Builder, index: u32, depth: u32) !u32 {
        const term = try b.build(index + 1, depth + 1);
        const root = try b.defs.booleanExpansion(b.gpa);
        const expression = try b.build(root, depth + 1);
        const group_ = try b.build(root + 15, depth + 1);
        var visited: std.AutoHashMapUnmanaged(u32, void) = .empty;
        defer visited.deinit(b.gpa);
        _ = try b.replace(
            group_,
            .{ .boolean_group = none, .term = term, .self = expression },
            &visited,
            0,
        );
        visited.clearRetainingCapacity();
        _ = try b.replace(
            expression,
            .{ .boolean_group = group_, .term = none, .self = none },
            &visited,
            0,
        );
        return expression;
    }

    const Replacements = struct { boolean_group: u32, term: u32, self: u32 };

    /// css-tree's `replaceTypeInGraph`, with its quirk: a placeholder met twice stays.
    fn replace(
        b: *Builder,
        index: u32,
        with: Replacements,
        visited: *std.AutoHashMapUnmanaged(u32, void),
        depth: u32,
    ) !u32 {
        assert(depth <= b.graph.nodes.items.len);
        if ((try visited.getOrPut(b.gpa, index)).found_existing) return index;
        const n = b.graph.node(index);
        switch (n.kind) {
            .@"if" => {
                const m = try b.replace(n.a, with, visited, depth + 1);
                b.at(index).a = m;
                const t = try b.replace(n.b, with, visited, depth + 1);
                b.at(index).b = t;
                const e = try b.replace(n.c, with, visited, depth + 1);
                b.at(index).c = e;
            },
            .type => {
                const replacement = switch (@as(Placeholder, @fromBackingInt(@intCast(n.flags)))) {
                    .none => none,
                    .boolean_group => with.boolean_group,
                    .term => with.term,
                    .self => with.self,
                };
                if (replacement != none) return replacement;
            },
            else => {},
        }
        return index;
    }
};
