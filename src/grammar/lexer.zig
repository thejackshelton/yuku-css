//! css-tree's `Lexer`: dictionaries of types, properties and at-rules, each definition's match
//! graph built on first use. The default lexer reads the compiled grammar; a custom one, as
//! `createLexer` makes, holds what it was given, over the compiled grammar when it forks it.

const std = @import("std");
const syntax = @import("syntax.zig");
const generic = @import("generic.zig");
const graph_ = @import("graph.zig");
const defs_ = @import("defs.zig");
const data = @import("grammar_data");

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Defs = defs_.Defs;
const Graph = graph_.Graph;

pub const none = std.math.maxInt(u32);

pub const Kind = enum(u8) { type, property, prelude, descriptor, anonymous };

pub const Descriptor = struct {
    kind: Kind,
    /// The definition's tree, `none` for a generic type.
    root: u32 = none,
    generic: ?generic.Generic = null,
    graph: u32 = none,
    /// A property's `matchRef`, `none` when it has none, `unbuilt` until asked.
    reference: u32 = unbuilt,

    pub const unbuilt = none - 1;
};

/// A compiled dictionary: names as `start << 8 | length` in the text, sorted, with their roots.
const Table = struct {
    names: []const u32,
    roots: []const u16,

    fn name(t: Table, i: u32) []const u8 {
        assert(i < t.names.len);
        const word = t.names[i];
        return data.text[word >> 8 ..][0 .. word & 0xFF];
    }

    fn root(t: Table, i: u32) u32 {
        assert(i < t.roots.len);
        return if (t.roots[i] == 0xFFFF) none else t.roots[i];
    }

    fn find(t: Table, key: []const u8) ?u32 {
        assert(t.names.len == t.roots.len);
        var low: u32 = 0;
        var high: u32 = @intCast(t.names.len);
        // a binary search halves the range each turn
        while (low < high) {
            const mid = low + (high - low) / 2;
            switch (std.mem.order(u8, t.name(mid), key)) {
                .eq => return mid,
                .lt => low = mid + 1,
                .gt => high = mid,
            }
        }
        assert(low == high);
        return null;
    }

    fn slice(t: Table, start: u32, len: u32) Table {
        assert(start + len <= t.names.len);
        return .{ .names = t.names[start..][0..len], .roots = t.roots[start..][0..len] };
    }
};

const Builtin = struct {
    const types: Table = .{ .names = &data.type_names, .roots = &data.type_roots };
    const properties: Table = .{ .names = &data.property_names, .roots = &data.property_roots };
    const descriptors: Table = .{
        .names = &data.descriptor_names,
        .roots = &data.descriptor_roots,
    };
    const atrules: Table = .{ .names = &data.atrule_names, .roots = &data.atrule_preludes };

    const Descriptors = struct { start: u32, table: Table };

    // an at-rule's descriptors, a slice of `descriptors`
    fn descriptorsOf(atrule: u32) Descriptors {
        assert(data.descriptor_names.len == data.descriptor_roots.len);
        assert(atrule < data.atrule_descriptors.len);
        const word = data.atrule_descriptors[atrule];
        return .{ .start = word >> 8, .table = descriptors.slice(word >> 8, word & 0xFF) };
    }

    const types_base: u32 = generic.count;
    const properties_base: u32 = types_base + data.type_names.len;
    const preludes_base: u32 = properties_base + data.property_names.len;
    const descriptors_base: u32 = preludes_base + data.atrule_names.len;
    const count: u32 = descriptors_base + data.descriptor_names.len;
};

const Atrule = struct {
    prelude: u32 = none,
    descriptors: std.StringHashMapUnmanaged(u32) = .empty,
};

/// What `findAtrule` answers when the at-rule exists but takes no prelude.
pub const no_prelude = none - 1;

pub const Lexer = struct {
    gpa: Allocator,
    defs: *Defs,
    /// Whether the compiled grammar backs the dictionaries.
    builtin: bool,
    /// Whether the generic types are defined, taking over any definition of their names.
    generic: bool,
    units: generic.Units = .{},
    /// The graph of the CSS-wide keywords.
    css_wide: u32 = none,
    descriptors: std.ArrayList(Descriptor) = .empty,
    types: std.StringHashMapUnmanaged(u32) = .empty,
    properties: std.StringHashMapUnmanaged(u32) = .empty,
    atrules: std.StringHashMapUnmanaged(Atrule) = .empty,
    graph: Graph,
    /// The names and units a custom lexer was given.
    owned: std.heap.ArenaAllocator,

    pub fn init(gpa: Allocator, defs: *Defs, builtin: bool, generic_types: bool) !Lexer {
        assert(defs.count() >= defs_.builtin_nodes.len);
        var l: Lexer = .{
            .gpa = gpa,
            .defs = defs,
            .builtin = builtin,
            .generic = generic_types,
            .graph = try .init(gpa),
            .owned = .init(gpa),
        };
        errdefer l.deinit();
        const reserved: u32 = if (builtin) Builtin.count else generic.count;
        try l.descriptors.ensureTotalCapacity(gpa, reserved);
        for (0..generic.count) |g| {
            const type_: generic.Generic = @fromBackingInt(@intCast(g));
            l.descriptors.appendAssumeCapacity(.{ .kind = .type, .generic = type_ });
        }
        if (builtin) {
            const tables = [_]struct { Table, Kind }{
                .{ Builtin.types, .type },
                .{ Builtin.properties, .property },
                .{ Builtin.atrules, .prelude },
                .{ Builtin.descriptors, .descriptor },
            };
            for (tables) |entry| {
                const table, const kind = entry;
                for (0..table.names.len) |i| {
                    const root = table.root(@intCast(i));
                    l.descriptors.appendAssumeCapacity(.{ .kind = kind, .root = root });
                }
            }
        }
        assert(l.descriptors.items.len == reserved);
        try l.setCssWide("initial |  inherit |  unset |  revert |  revert-layer");
        return l;
    }

    pub fn deinit(l: *Lexer) void {
        l.descriptors.deinit(l.gpa);
        l.types.deinit(l.gpa);
        l.properties.deinit(l.gpa);
        var it = l.atrules.valueIterator();
        while (it.next()) |atrule| atrule.descriptors.deinit(l.gpa);
        l.atrules.deinit(l.gpa);
        l.graph.deinit(l.gpa);
        l.owned.deinit();
        l.* = undefined;
    }

    pub fn setCssWide(l: *Lexer, source: []const u8) !void {
        assert(source.len > 0);
        var failure: syntax.Failure = undefined;
        const root = try l.defs.add(l.gpa, source, &failure);
        var b = l.builder();
        l.css_wide = try b.descriptorGraph(root, none);
        assert(l.graph.node(l.css_wide).kind == .match_graph);
    }

    pub fn setUnits(l: *Lexer, group: usize, units: []const []const u8) !void {
        assert(group < generic.unit_groups.len);
        const arena = l.owned.allocator();
        const copy = try arena.alloc([]const u8, units.len);
        for (copy, units) |*to, from| to.* = try arena.dupe(u8, from);
        l.units.groups[group] = copy;
        assert(l.units.groups[group].len == units.len);
    }

    fn builder(l: *Lexer) graph_.Builder {
        assert(l.graph.nodes.items.len >= 3);
        assert(l.descriptors.items.len >= generic.count);
        return .{
            .gpa = l.gpa,
            .graph = &l.graph,
            .defs = l.defs,
            .resolver = .{ .context = l, .findType = resolveType, .findProperty = resolveProperty },
        };
    }

    fn resolveType(context: *anyopaque, name: []const u8) u32 {
        const l: *Lexer = @ptrCast(@alignCast(context));
        return l.findType(name);
    }

    fn resolveProperty(context: *anyopaque, name: []const u8) u32 {
        const l: *Lexer = @ptrCast(@alignCast(context));
        return l.findProperty(name);
    }

    pub fn findType(l: *const Lexer, name: []const u8) u32 {
        assert(name.len <= std.math.maxInt(u16));
        assert(l.descriptors.items.len >= generic.count);
        if (l.generic) if (generic.find(name)) |g| return @backingInt(g);
        if (l.types.get(name)) |id| return id;
        if (!l.builtin) return none;
        const i = Builtin.types.find(name) orelse return none;
        return Builtin.types_base + i;
    }

    pub fn findProperty(l: *const Lexer, name: []const u8) u32 {
        assert(name.len <= std.math.maxInt(u16));
        assert(!l.builtin or l.descriptors.items.len >= Builtin.count);
        if (l.properties.get(name)) |id| return id;
        if (!l.builtin) return none;
        const i = Builtin.properties.find(name) orelse return none;
        return Builtin.properties_base + i;
    }

    /// The at-rule's prelude descriptor, `no_prelude` when it takes none, `none` when unknown.
    pub fn findAtrule(l: *const Lexer, name: []const u8) u32 {
        assert(name.len <= std.math.maxInt(u16));
        assert(!l.builtin or l.descriptors.items.len >= Builtin.count);
        if (l.atrules.get(name)) |known| {
            return if (known.prelude == none) no_prelude else known.prelude;
        }
        if (!l.builtin) return none;
        const i = Builtin.atrules.find(name) orelse return none;
        return if (Builtin.atrules.root(i) == none) no_prelude else Builtin.preludes_base + i;
    }

    pub const DescriptorLookup = enum(u32) {
        unknown_atrule = none,
        no_descriptors = none - 1,
        unknown = none - 2,
        _,
    };

    pub fn findDescriptor(
        l: *const Lexer,
        atrule_name: []const u8,
        name: []const u8,
    ) DescriptorLookup {
        assert(atrule_name.len <= std.math.maxInt(u16));
        assert(!l.builtin or l.descriptors.items.len >= Builtin.count);
        if (l.atrules.getPtr(atrule_name)) |atrule| {
            if (atrule.descriptors.count() == 0) return .no_descriptors;
            const id = atrule.descriptors.get(name) orelse return .unknown;
            return @fromBackingInt(@intCast(id));
        }
        if (!l.builtin) return .unknown_atrule;
        const i = Builtin.atrules.find(atrule_name) orelse return .unknown_atrule;
        const list = Builtin.descriptorsOf(i);
        if (list.table.names.len == 0) return .no_descriptors;
        const j = list.table.find(name) orelse return .unknown;
        return @fromBackingInt(@intCast(Builtin.descriptors_base + list.start + j));
    }

    /// Defines a type, property, prelude or descriptor from definition syntax, replacing any
    /// definition of the name, and returns its descriptor.
    pub fn define(
        l: *Lexer,
        kind: Kind,
        name: []const u8,
        atrule_name: []const u8,
        source: []const u8,
        failure: *syntax.Failure,
    ) !u32 {
        assert(kind != .anonymous or name.len == 0);
        const root = try l.defs.add(l.gpa, source, failure);
        const id: u32 = @intCast(l.descriptors.items.len);
        try l.descriptors.append(l.gpa, .{ .kind = kind, .root = root });
        const arena = l.owned.allocator();
        switch (kind) {
            .type => try l.types.put(l.gpa, try arena.dupe(u8, name), id),
            .property => try l.properties.put(l.gpa, try arena.dupe(u8, name), id),
            .prelude => (try l.declare(name)).prelude = id,
            .descriptor => {
                const atrule = try l.declare(atrule_name);
                try atrule.descriptors.put(l.gpa, try arena.dupe(u8, name), id);
            },
            .anonymous => {},
        }
        assert(l.descriptors.items[id].root == root);
        return id;
    }

    /// Declares an at-rule, with no prelude until one is defined.
    pub fn declare(l: *Lexer, name: []const u8) !*Atrule {
        assert(name.len <= std.math.maxInt(u16));
        const entry = try l.atrules.getOrPut(l.gpa, name);
        if (!entry.found_existing) {
            entry.key_ptr.* = try l.owned.allocator().dupe(u8, name);
            entry.value_ptr.* = .{};
        }
        assert(std.mem.eql(u8, entry.key_ptr.*, name));
        return entry.value_ptr;
    }

    pub fn descriptor(l: *const Lexer, id: u32) Descriptor {
        assert(id < l.descriptors.items.len);
        return l.descriptors.items[id];
    }

    /// The graph of descriptor `id`, its `matchRef` when `reference` is set and it has one.
    pub fn graphOf(l: *Lexer, id: u32, reference: bool) !u32 {
        assert(id < l.descriptors.items.len);
        var d = l.descriptors.items[id];
        if (reference and d.kind == .property) {
            if (d.reference == Descriptor.unbuilt) {
                var b = l.builder();
                d.reference = try b.propertyReference(d.root, id);
                l.descriptors.items[id].reference = d.reference;
            }
            if (d.reference != none) return d.reference;
        }
        if (d.graph == none) {
            var b = l.builder();
            if (d.generic) |g| {
                d.graph = try b.genericGraph(g, id);
            } else d.graph = try b.descriptorGraph(d.root, id);
            l.descriptors.items[id].graph = d.graph;
        }
        assert(l.graph.node(d.graph).kind == .match_graph);
        return d.graph;
    }

    /// Calls `visit(kind, name, atrule, descriptor)` for every definition the dictionaries hold:
    /// types, properties, then at-rules with their descriptors.
    pub fn each(l: *const Lexer, context: anytype, visit: anytype) !void {
        assert(l.descriptors.items.len >= generic.count);
        assert(!l.builtin or l.descriptors.items.len >= Builtin.count);
        if (l.generic) for (0..generic.count) |g| {
            try visit(context, Kind.type, generic.names[g], "", @as(u32, @intCast(g)));
        };
        if (l.builtin) for (0..Builtin.types.names.len) |index| {
            const i: u32 = @intCast(index);
            const name = Builtin.types.name(i);
            if (l.types.contains(name)) continue;
            try visit(context, Kind.type, name, "", Builtin.types_base + i);
        };
        var types = l.types.iterator();
        while (types.next()) |entry| {
            if (l.generic and generic.find(entry.key_ptr.*) != null) continue;
            try visit(context, Kind.type, entry.key_ptr.*, "", entry.value_ptr.*);
        }
        if (l.builtin) for (0..Builtin.properties.names.len) |index| {
            const i: u32 = @intCast(index);
            const name = Builtin.properties.name(i);
            if (l.properties.contains(name)) continue;
            try visit(context, Kind.property, name, "", Builtin.properties_base + i);
        };
        var properties = l.properties.iterator();
        while (properties.next()) |entry| {
            try visit(context, Kind.property, entry.key_ptr.*, "", entry.value_ptr.*);
        }
        if (l.builtin) for (0..Builtin.atrules.names.len) |index| {
            const i: u32 = @intCast(index);
            const name = Builtin.atrules.name(i);
            if (l.atrules.contains(name)) continue;
            const has_prelude = Builtin.atrules.root(i) != none;
            const prelude = if (has_prelude) Builtin.preludes_base + i else none;
            try visit(context, Kind.prelude, name, name, prelude);
            const list = Builtin.descriptorsOf(i);
            for (0..list.table.names.len) |offset| {
                const j: u32 = @intCast(offset);
                const id = Builtin.descriptors_base + list.start + j;
                try visit(context, Kind.descriptor, list.table.name(j), name, id);
            }
        };
        var atrules = l.atrules.iterator();
        while (atrules.next()) |entry| {
            const name = entry.key_ptr.*;
            try visit(context, Kind.prelude, name, name, entry.value_ptr.prelude);
            var it = entry.value_ptr.descriptors.iterator();
            while (it.next()) |d| {
                try visit(context, Kind.descriptor, d.key_ptr.*, name, d.value_ptr.*);
            }
        }
    }
};

test "builtin lookups" {
    var defs: Defs = .{};
    defer defs.nodes.deinit(std.testing.allocator);
    defer defs.chars.deinit(std.testing.allocator);
    var l = try Lexer.init(std.testing.allocator, &defs, true, true);
    defer l.deinit();
    try std.testing.expect(l.findProperty("color") != none);
    try std.testing.expect(l.findProperty("not-a-property") == none);
    const length: u32 = @backingInt(generic.Generic.length);
    try std.testing.expectEqual(length, l.findType("length"));
    try std.testing.expect(l.findAtrule("media") != none);
    try std.testing.expect(l.findDescriptor("font-face", "src") != .unknown);
}
