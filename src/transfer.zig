// The tree crosses to JavaScript as a pre-order stream of u32s, decoded by the shapes in `description`.
//
//   [0]       length of the stream after the header
//   [1]       length of the whole allocation, header included, to free it with
//   node      tag, start, end, then each field of its shape in order; 0xFFFFFFFF alone for null
//   nodes     count, then each node
//   string    start, end, both 0xFFFFFFFF for null
//   bool      0 or 1
//   enum      the index into the field's `values`
//   then      diagnostic count, then per diagnostic message index, start, end
//
// offsets are UTF-16 code units, so JavaScript slices the source string with them

const std = @import("std");
const ast = @import("ast.zig");

const Allocator = std.mem.Allocator;
const null_slot: u32 = std.math.maxInt(u32);

/// JSON naming each node type and its fields in wire order, plus the diagnostic messages.
pub const description: []const u8 = blk: {
    @setEvalBranchQuota(100_000);
    var json: []const u8 = "{\"nodes\":[";
    for (std.meta.fieldNames(ast.Data), std.meta.fieldTypes(ast.Data), 0..) |variant, Payload, i| {
        if (i > 0) json = json ++ ",";
        json = json ++ "{\"type\":\"" ++ caseOf(variant, true) ++ "\",\"fields\":[";
        for (std.meta.fieldNames(Payload), std.meta.fieldTypes(Payload), 0..) |name, Field, j| {
            if (j > 0) json = json ++ ",";
            json = json ++ "{\"name\":\"" ++ caseOf(name, false) ++ "\",\"kind\":\"" ++ kindOf(Field) ++ "\"";
            if (@typeInfo(Field) == .@"enum" and Field != ast.NodeIndex) {
                json = json ++ ",\"values\":[";
                for (Field.strings, 0..) |value, k| {
                    json = json ++ (if (k > 0) "," else "") ++ "\"" ++ value ++ "\"";
                }
                json = json ++ "]";
            }
            json = json ++ "}";
        }
        json = json ++ "]}";
    }
    json = json ++ "],\"messages\":[";
    for (std.meta.tags(ast.Message), 0..) |message, i| {
        json = json ++ (if (i > 0) "," else "") ++ "\"" ++ message.text() ++ "\"";
    }
    break :blk json ++ "]}";
};

fn kindOf(comptime T: type) []const u8 {
    return switch (T) {
        ast.NodeIndex => "node",
        ast.NodeList => "nodes",
        ast.Span => "string",
        ?ast.Span => "string",
        bool => "bool",
        else => if (@typeInfo(T) == .@"enum") "enum" else @compileError("no wire kind for " ++ @typeName(T)),
    };
}

fn caseOf(comptime snake: []const u8, comptime pascal: bool) []const u8 {
    var out: []const u8 = "";
    var upper = pascal;
    for (snake) |byte| {
        if (byte == '_') {
            upper = true;
        } else {
            out = out ++ &[_]u8{if (upper) std.ascii.toUpper(byte) else byte};
            upper = false;
        }
    }
    return out;
}

pub fn serialize(gpa: Allocator, tree: *const ast.Tree) Allocator.Error![]u32 {
    const offsets: Utf16Offsets = try .init(gpa, tree.source);
    defer offsets.deinit(gpa);

    // every node takes at most its own slots plus one count slot for a list
    const size = 2 + tree.nodes.len * (node_slots_max + 1) + 1 + tree.diagnostics.len * 3;
    const out = try gpa.alloc(u32, size);
    var writer: Writer = .{ .tree = tree, .offsets = offsets, .out = out, .len = 2 };
    writer.node(tree.root);
    writer.push(@intCast(tree.diagnostics.len));
    for (tree.diagnostics) |diagnostic| {
        writer.push(@backingInt(diagnostic.message));
        writer.span(diagnostic.span);
    }
    // shrinking to fit would move a large buffer into a small size class of the wasm allocator, which leaks
    out[0] = writer.len - 2;
    out[1] = @intCast(out.len);
    return out;
}

const node_slots_max = blk: {
    var max = 0;
    for (std.meta.fieldTypes(ast.Data)) |Payload| {
        var slots = 3;
        for (std.meta.fieldTypes(Payload)) |Field| slots += switch (Field) {
            ast.Span, ?ast.Span => 2,
            ast.NodeIndex => 0,
            else => 1,
        };
        max = @max(max, slots);
    }
    break :blk max;
};

const Writer = struct {
    tree: *const ast.Tree,
    offsets: Utf16Offsets,
    out: []u32,
    len: u32,

    fn push(w: *Writer, value: u32) void {
        w.out[w.len] = value;
        w.len += 1;
    }

    fn span(w: *Writer, value: ast.Span) void {
        w.push(w.offsets.at(value.start));
        w.push(w.offsets.at(value.end));
    }

    fn node(w: *Writer, index: ast.NodeIndex) void {
        if (index == .null) return w.push(null_slot);
        const current = &w.tree.nodes[@backingInt(index)];
        w.push(@backingInt(std.meta.activeTag(current.data)));
        w.span(current.span);
        switch (current.data) {
            inline else => |*payload| inline for (comptime std.meta.fieldNames(@TypeOf(payload.*))) |name| {
                w.field(@FieldType(@TypeOf(payload.*), name), @field(payload, name));
            },
        }
    }

    fn field(w: *Writer, comptime T: type, value: T) void {
        switch (T) {
            ast.NodeIndex => w.node(value),
            ast.NodeList => {
                w.push(value.len);
                for (w.tree.list(value)) |child| w.node(child);
            },
            ast.Span => w.span(value),
            ?ast.Span => if (value) |present| w.span(present) else {
                w.push(null_slot);
                w.push(null_slot);
            },
            bool => w.push(@intFromBool(value)),
            else => w.push(@backingInt(value)),
        }
    }
};

/// Maps byte offsets to UTF-16 offsets; offsets up to the first non-ASCII byte map to themselves.
const Utf16Offsets = struct {
    first: u32,
    table: []u32,

    fn init(gpa: Allocator, source: []const u8) Allocator.Error!Utf16Offsets {
        var first: u32 = 0;
        while (first < source.len and source[first] < 0x80) first += 1;
        if (first == source.len) return .{ .first = first, .table = &.{} };

        const table = try gpa.alloc(u32, source.len - first + 1);
        var units = first;
        var i: u32 = first;
        while (i < source.len) {
            const lead = source[i];
            if (lead < 0x80) {
                table[i - first] = units;
                units += 1;
                i += 1;
                continue;
            }
            const width: u32 = if (lead < 0x80) 1 else if (lead < 0xE0) 2 else if (lead < 0xF0) 3 else 4;
            const end = @min(i + width, @as(u32, @intCast(source.len)));
            @memset(table[i - first .. end - first], units);
            units += if (width == 4) 2 else 1;
            i = end;
        }
        table[source.len - first] = units;
        return .{ .first = first, .table = table };
    }

    fn deinit(offsets: Utf16Offsets, gpa: Allocator) void {
        gpa.free(offsets.table);
    }

    fn at(offsets: Utf16Offsets, offset: u32) u32 {
        if (offset <= offsets.first) return offset;
        return offsets.table[offset - offsets.first];
    }
};

test "serializes without leaking" {
    const parse = @import("parser.zig").parse;
    var tree = try parse(std.testing.allocator, ".é { a: b } @media x { c {} }");
    defer tree.deinit();
    const out = try serialize(std.testing.allocator, &tree);
    defer std.testing.allocator.free(out);
    try std.testing.expectEqual(out.len, out[1]);
    try std.testing.expect(out[0] + 2 <= out.len);
}
