//! Every definition syntax tree the lexers match by: the compiled grammar first, then the trees
//! read at runtime, in one index space so a match result names any node by one number.

const std = @import("std");
const syntax = @import("syntax.zig");
const data = @import("grammar_data");

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Node = syntax.Node;

comptime {
    assert(@import("builtin").cpu.arch.endian() == .little);
}

/// The compiled trees, a node in 32 bits as the generator packs it.
pub const builtin_nodes: []const u32 = &data.nodes;
pub const builtin_text: []const u8 = data.text;

/// A compiled node: tag, flags, len and data in 4, 4, 8 and 16 bits.
pub fn unpack(word: u32) Node {
    const tag: syntax.Tag = @fromBackingInt(@intCast(word & 0xF));
    assert(@backingInt(tag) <= @backingInt(syntax.Tag.range_end));
    return .{
        .tag = tag,
        .flags = @intCast(word >> 4 & 0xF),
        .len = @intCast(word >> 8 & 0xFF),
        .data = word >> 16,
    };
}

pub const Defs = struct {
    nodes: std.ArrayList(Node) = .empty,
    chars: std.ArrayList(u8) = .empty,
    /// The root of `<boolean-expr[ ]>`'s expansion, read once.
    boolean: u32 = none,

    pub const none = std.math.maxInt(u32);

    pub fn count(d: *const Defs) u32 {
        return @intCast(builtin_nodes.len + d.nodes.items.len);
    }

    pub fn node(d: *const Defs, index: u32) Node {
        assert(index < d.count());
        if (index < builtin_nodes.len) return unpack(builtin_nodes[index]);
        return d.nodes.items[index - builtin_nodes.len];
    }

    /// The name, value or bound of node `index`.
    pub fn text(d: *const Defs, index: u32) []const u8 {
        const n = d.node(index);
        assert(n.tag != .group and n.tag != .multiplier and n.tag != .boolean and n.tag != .comma);
        return if (index < builtin_nodes.len) n.text(builtin_text) else n.text(d.chars.items);
    }

    /// The node after `index` and its subtree.
    pub fn skip(d: *const Defs, index: u32) u32 {
        var at = index;
        // a chain of multipliers ends at its term, inside the tree
        while (d.node(at).tag == .multiplier or d.node(at).tag == .boolean) at += 1;
        const n = d.node(at);
        const size: u32 = switch (n.tag) {
            .group => n.data,
            .type => if (n.flags & syntax.flag.range != 0) 3 else 1,
            else => 1,
        };
        assert(at + size <= d.count());
        return at + size;
    }

    /// Reads `source` into a new tree and returns its root.
    pub fn add(
        d: *Defs,
        gpa: Allocator,
        source: []const u8,
        failure: *syntax.Failure,
    ) syntax.Error!u32 {
        assert(source.len < std.math.maxInt(u32) / 2);
        const base: u32 = @intCast(d.chars.items.len);
        const root: u32 = @intCast(d.count());
        try d.chars.appendSlice(gpa, source);
        const nodes_before = d.nodes.items.len;
        syntax.parse(gpa, d.chars.items[base..], base, &d.nodes, failure) catch |err| {
            d.chars.shrinkRetainingCapacity(base);
            d.nodes.shrinkRetainingCapacity(nodes_before);
            return err;
        };
        assert(d.nodes.items.len > nodes_before);
        return root;
    }

    /// The expansion css-tree builds for `<boolean-expr[ test ]>`, whose placeholders the graph
    /// replaces: `not <!g> | <!g> [ [ and <!g> ]* | [ or <!g> ]* ]`, then
    /// `<!term> | [ '(' <!self> ')' ] | <general-enclosed>`, both read into one tree.
    pub fn booleanExpansion(d: *Defs, gpa: Allocator) !u32 {
        if (d.boolean != none) return d.boolean;
        const names = "notandor()!boolean-group!term!selfgeneral-enclosed";
        const base: u32 = @intCast(d.chars.items.len);
        try d.chars.appendSlice(gpa, names);
        const word = struct {
            fn at(b: u32, tag: syntax.Tag, offset: u32, len: u16) Node {
                return .{ .tag = tag, .len = len, .data = b + offset };
            }
        }.at;
        const juxtapose = @backingInt(syntax.Combinator.juxtapose);
        const one = @backingInt(syntax.Combinator.one);
        const group = struct {
            fn of(combinator: u8, terms: u16, size: u32) Node {
                return .{ .tag = .group, .flags = combinator, .len = terms, .data = size };
            }
        }.of;
        const bg = word(base, .type, 10, 14);
        const nodes = [_]Node{
            // not <!g> | <!g> [ [ and <!g> ]* | [ or <!g> ]* ]
            group(one, 2, 15),
            group(juxtapose, 2, 3),
            word(base, .keyword, 0, 3),
            bg,
            group(juxtapose, 2, 11),
            bg,
            group(one, 2, 9),
            .{ .tag = .multiplier, .len = 0, .data = 0 },
            group(juxtapose, 2, 3),
            word(base, .keyword, 3, 3),
            bg,
            .{ .tag = .multiplier, .len = 0, .data = 0 },
            group(juxtapose, 2, 3),
            word(base, .keyword, 6, 2),
            bg,
            // <!term> | [ '(' <!self> ')' ] | <general-enclosed>
            group(one, 3, 7),
            word(base, .type, 24, 5),
            group(juxtapose, 3, 4),
            word(base, .token, 8, 1),
            word(base, .type, 29, 5),
            word(base, .token, 9, 1),
            word(base, .type, 34, 16),
        };
        comptime assert(names.len == 50);
        const root = d.count();
        try d.nodes.appendSlice(gpa, &nodes);
        d.boolean = root;
        assert(d.node(root + 15).tag == .group);
        return root;
    }
};

test "boolean expansion" {
    var d: Defs = .{};
    defer d.nodes.deinit(std.testing.allocator);
    defer d.chars.deinit(std.testing.allocator);
    const root = try d.booleanExpansion(std.testing.allocator);
    try std.testing.expectEqual(root + 15, d.skip(root));
    try std.testing.expectEqual(root + 22, d.skip(root + 15));
    try std.testing.expectEqualStrings("not", d.text(root + 2));
    try std.testing.expectEqualStrings("!boolean-group", d.text(root + 3));
    try std.testing.expectEqualStrings("and", d.text(root + 9));
    try std.testing.expectEqualStrings("(", d.text(root + 18));
    try std.testing.expectEqualStrings("!self", d.text(root + 19));
    try std.testing.expectEqualStrings("general-enclosed", d.text(root + 21));
}
