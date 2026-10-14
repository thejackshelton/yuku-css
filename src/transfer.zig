// AST transfer format, little endian; tools/gen_decoder.zig generates the decoder from the layouts below
//
// sections, in order
//
//   header        HEADER_SIZE bytes
//   nodes         node_count * NODE_SIZE, one PackedNode each, children before their parent
//   extras        extra_count * 4, the u32 array backing IndexRange
//   strings       string_pool_len bytes of UTF-8, zero-padded to a 4-byte boundary
//   diagnostics   diagnostic_count * DIAGNOSTIC_SIZE
//   utf16         utf16_count * 2 u32, see `Utf16`
//   comments      comment_count * 2 u32, where each comment starts and ends
//   lines         line_count u32, where each line after the first starts
//   tokens        token_count * TOKEN_SIZE, each `Token` as is, when asked for
//
// node fields
//
//   NodeIndex     1 u32 slot, 0xFFFFFFFF for null
//   IndexRange    2 u32 slots (start, len), start 0xFFFFFFFF for null
//   String        2 u32 slots (start, end), start 0xFFFFFFFF for null
//   enum          ceil(log2(n)) flag bits for n variants
//
// a String starting below source_len slices the source, else the pool at start - source_len
//
// node spans and source strings are UTF-16 code units, every other offset bytes, which the utf16
// section maps past first_non_ascii
//
// the token list, from `serializeTokens`
//
//   header        TOKENS_HEADER_SIZE bytes
//   tokens        token_count * TOKEN_SIZE, each `Token` as is
//   utf16         utf16_count * 2 u32

const std = @import("std");
const ast = @import("ast.zig");
const token = @import("token.zig");

// field order defines the wire layout
const Header = extern struct {
    node_count: u32,
    extra_count: u32,
    string_pool_len: u32,
    source_len: u32,
    diagnostic_count: u32,
    root: u32,
    // positions below this need no UTF-16 conversion
    first_non_ascii: u32,
    utf16_count: u32,
    comment_count: u32,
    line_count: u32,
    token_count: u32,
};

const PackedNode = extern struct {
    tag: u8,
    _pad: u8 = 0,
    flags: u16,
    slots: [5]u32,
    span_start: u32,
    span_end: u32,
};

const PackedDiagnostic = extern struct {
    message: u32,
    start: u32,
    end: u32,
    // a String, 0xFFFFFFFF for a message without an argument
    argument_start: u32,
    argument_end: u32,
};

const TokensHeader = extern struct {
    token_count: u32,
    source_len: u32,
    first_non_ascii: u32,
    utf16_count: u32,
};

pub const HEADER_SIZE: u32 = @sizeOf(Header);
pub const NODE_SIZE: u32 = @sizeOf(PackedNode);
pub const DIAGNOSTIC_SIZE: u32 = @sizeOf(PackedDiagnostic);
pub const TOKENS_HEADER_SIZE: u32 = @sizeOf(TokensHeader);
pub const TOKEN_SIZE: u32 = @sizeOf(token.Token);
pub const TOKEN_END_U32: u32 = @offsetOf(token.Token, "end") / 4;
pub const TOKEN_TAG_U32: u32 = @offsetOf(token.Token, "tag") / 4;

pub const HDR_NODE_COUNT_U32: u32 = @offsetOf(Header, "node_count") / 4;
pub const HDR_EXTRA_COUNT_U32: u32 = @offsetOf(Header, "extra_count") / 4;
pub const HDR_STRING_POOL_LEN_U32: u32 = @offsetOf(Header, "string_pool_len") / 4;
pub const HDR_SOURCE_LEN_U32: u32 = @offsetOf(Header, "source_len") / 4;
pub const HDR_DIAGNOSTIC_COUNT_U32: u32 = @offsetOf(Header, "diagnostic_count") / 4;
pub const HDR_ROOT_U32: u32 = @offsetOf(Header, "root") / 4;
pub const HDR_FIRST_NON_ASCII_U32: u32 = @offsetOf(Header, "first_non_ascii") / 4;
pub const HDR_UTF16_COUNT_U32: u32 = @offsetOf(Header, "utf16_count") / 4;
pub const HDR_COMMENT_COUNT_U32: u32 = @offsetOf(Header, "comment_count") / 4;
pub const HDR_LINE_COUNT_U32: u32 = @offsetOf(Header, "line_count") / 4;
pub const HDR_TOKEN_COUNT_U32: u32 = @offsetOf(Header, "token_count") / 4;

pub const TOKENS_COUNT_U32: u32 = @offsetOf(TokensHeader, "token_count") / 4;
pub const TOKENS_SOURCE_LEN_U32: u32 = @offsetOf(TokensHeader, "source_len") / 4;
pub const TOKENS_FIRST_NON_ASCII_U32: u32 = @offsetOf(TokensHeader, "first_non_ascii") / 4;
pub const TOKENS_UTF16_COUNT_U32: u32 = @offsetOf(TokensHeader, "utf16_count") / 4;

pub const NODE_FLAGS_OFFSET: u8 = @offsetOf(PackedNode, "flags");
pub const NODE_HEADER_U32S: u8 = @offsetOf(PackedNode, "slots") / 4;
pub const NODE_SPAN_START_U32: u8 = @offsetOf(PackedNode, "span_start") / 4;
pub const NODE_SPAN_END_U32: u8 = @offsetOf(PackedNode, "span_end") / 4;
pub const DIAGNOSTIC_MESSAGE_U32: u8 = @offsetOf(PackedDiagnostic, "message") / 4;
pub const DIAGNOSTIC_START_U32: u8 = @offsetOf(PackedDiagnostic, "start") / 4;
pub const DIAGNOSTIC_END_U32: u8 = @offsetOf(PackedDiagnostic, "end") / 4;
pub const DIAGNOSTIC_ARGUMENT_U32: u8 = @offsetOf(PackedDiagnostic, "argument_start") / 4;

const NODE_DATA_SLOTS: u8 = NODE_SPAN_START_U32 - NODE_HEADER_U32S;
const NODE_FLAG_BITS: u8 = @bitSizeOf(@FieldType(PackedNode, "flags"));

comptime {
    std.debug.assert(NODE_SIZE == 32);
    std.debug.assert(TOKEN_SIZE == 8 and @offsetOf(token.Token, "tag") % 4 == 0);
    @setEvalBranchQuota(10_000);
    const info = @typeInfo(ast.NodeData).@"union";
    for (info.field_names, info.field_types) |name, T| {
        if (totalU32Slots(T) > NODE_DATA_SLOTS) {
            @compileError(std.fmt.comptimePrint("node '{s}' needs more than {d} u32 slots", .{ name, NODE_DATA_SLOTS }));
        }
        if (totalFlagBits(T) > NODE_FLAG_BITS) {
            @compileError(std.fmt.comptimePrint("node '{s}' needs more than {d} flag bits", .{ name, NODE_FLAG_BITS }));
        }
    }
}

// layout helpers shared with the decoder generator in tools/gen_decoder.zig

pub fn flagBitCount(comptime T: type, comptime field_idx: usize) u8 {
    const Field = @typeInfo(T).@"struct".field_types[field_idx];
    if (Field == bool) return 1;
    if (@typeInfo(Field) == .@"enum" and Field != ast.NodeIndex) return enumBitWidth(Field);
    return 0;
}

pub fn flagBitForField(comptime T: type, comptime target: usize) u8 {
    comptime {
        var bit: u8 = 0;
        for (0..target) |i| bit += flagBitCount(T, i);
        return bit;
    }
}

pub fn fieldU32Count(comptime T: type, comptime field_idx: usize) u8 {
    const Field = @typeInfo(T).@"struct".field_types[field_idx];
    if (Field == ast.NodeIndex) return 1;
    if (Field == ast.IndexRange or Field == ast.String) return 2;
    if (Field == bool or @typeInfo(Field) == .@"enum") return 0;
    @compileError("unsupported field type '" ++ @typeName(Field) ++ "' in " ++ @typeName(T));
}

pub fn u32SlotForField(comptime T: type, comptime target: usize) u8 {
    comptime {
        var slot: u8 = 0;
        for (0..target) |i| slot += fieldU32Count(T, i);
        return slot;
    }
}

pub fn enumBitWidth(comptime E: type) u8 {
    return std.math.log2_int_ceil(usize, @typeInfo(E).@"enum".field_names.len);
}

pub fn totalU32Slots(comptime T: type) u8 {
    return u32SlotForField(T, @typeInfo(T).@"struct".field_types.len);
}

pub fn totalFlagBits(comptime T: type) u8 {
    return flagBitForField(T, @typeInfo(T).@"struct".field_types.len);
}

// for each tag whose payload holds its slots in order and has no flags, how many words it fills
const copied: [@typeInfo(ast.NodeData).@"union".field_names.len]?u8 = blk: {
    @setEvalBranchQuota(10_000);
    const info = @typeInfo(ast.NodeData).@"union";
    var t: [info.field_names.len]?u8 = @splat(null);
    for (info.field_types, 0..) |T, tag| {
        const fields = @typeInfo(T).@"struct";
        var same = totalFlagBits(T) == 0 and @sizeOf(T) == totalU32Slots(T) * 4;
        for (fields.field_names, 0..) |field, i| {
            if (@offsetOf(T, field) != u32SlotForField(T, i) * 4) same = false;
        }
        if (same) t[tag] = totalU32Slots(T);
    }
    break :blk t;
};

pub fn bufferSize(tree: *const ast.Tree, utf16: Utf16, tokens: bool) usize {
    return HEADER_SIZE +
        tree.comments.len * 8 +
        tree.lines.len * 4 +
        (if (tokens) tree.tokens.len * TOKEN_SIZE else 0) +
        tree.nodes.len * NODE_SIZE +
        tree.extras.items.len * 4 +
        std.mem.alignForward(usize, tree.strings.extra.items.len, 4) +
        tree.diagnostics.items.len * DIAGNOSTIC_SIZE +
        utf16.count * 8;
}

pub fn serializeInto(tree: *const ast.Tree, utf16: Utf16, tokens: bool, buf: []u8) usize {
    std.debug.assert(buf.len >= bufferSize(tree, utf16, tokens));
    std.debug.assert(@intFromPtr(buf.ptr) % 4 == 0);
    std.debug.assert(@backingInt(tree.root) + 1 == tree.nodes.len);

    const pool_len: u32 = @intCast(tree.strings.extra.items.len);
    const header: Header = .{
        .node_count = @intCast(tree.nodes.len),
        .extra_count = @intCast(tree.extras.items.len),
        .string_pool_len = pool_len,
        .source_len = @intCast(tree.source.len),
        .diagnostic_count = @intCast(tree.diagnostics.items.len),
        .root = @backingInt(tree.root),
        .first_non_ascii = utf16.first,
        .utf16_count = utf16.count,
        .comment_count = @intCast(tree.comments.len),
        .line_count = @intCast(tree.lines.len),
        .token_count = if (tokens) @intCast(tree.tokens.len) else 0,
    };
    var pos: usize = 0;
    writeBytes(buf, &pos, std.mem.asBytes(&header));

    // the utf16 section goes in first, since the nodes are mapped with it
    const utf16_pos = pos + tree.nodes.len * NODE_SIZE + tree.extras.items.len * 4 +
        std.mem.alignForward(usize, pool_len, 4) + tree.diagnostics.items.len * DIAGNOSTIC_SIZE;
    const utf16_len = utf16.write(tree.source, buf[utf16_pos..]);
    const nodes_out: [*]PackedNode = @ptrCast(@alignCast(buf.ptr + pos));
    const data = tree.nodes.items(.data);
    const spans = tree.nodes.items(.span);
    const points: [*]const u32 = @ptrCast(@alignCast(buf.ptr + utf16_pos));
    var map: Mapping = .{
        .utf16 = .{ .points = points[0 .. utf16.count * 2], .first = utf16.first },
        .source_len = @intCast(tree.source.len),
    };
    if (utf16.count == 0) {
        for (data, spans, 0..) |*node, span, i| {
            const tag = @backingInt(std.meta.activeTag(node.*));
            if (copied[tag]) |words| {
                // the payload's words are its slots, which most nodes fill, so no switch on the tag
                const payload: *const [NODE_DATA_SLOTS]u32 = @ptrCast(node);
                var slots = payload.*;
                for (&slots, 0..) |*slot, k| {
                    if (k >= words) slot.* = 0;
                }
                nodes_out[i] = .{
                    .tag = tag,
                    .flags = 0,
                    .slots = slots,
                    .span_start = span.start,
                    .span_end = span.end,
                };
            } else {
                nodes_out[i] = packNode(node, span, false, &map);
            }
        }
    } else {
        for (data, spans, 0..) |*node, span, i| nodes_out[i] = packNode(node, span, true, &map);
    }
    pos += tree.nodes.len * NODE_SIZE;

    writeBytes(buf, &pos, std.mem.sliceAsBytes(tree.extras.items));

    writeBytes(buf, &pos, tree.strings.extra.items);
    const pad = std.mem.alignForward(u32, pool_len, 4) - pool_len;
    @memset(buf[pos..][0..pad], 0);
    pos += pad;

    const diagnostics_out: [*]PackedDiagnostic = @ptrCast(@alignCast(buf.ptr + pos));
    for (tree.diagnostics.items, 0..) |d, i| {
        diagnostics_out[i] = .{
            .message = @backingInt(d.message),
            .start = d.span.start,
            .end = d.span.end,
            .argument_start = d.argument.start,
            .argument_end = d.argument.end,
        };
    }
    pos += tree.diagnostics.items.len * DIAGNOSTIC_SIZE;

    std.debug.assert(pos == utf16_pos);
    pos += utf16_len;
    writeBytes(buf, &pos, std.mem.sliceAsBytes(tree.comments));
    writeBytes(buf, &pos, std.mem.sliceAsBytes(tree.lines));
    if (tokens) writeBytes(buf, &pos, std.mem.sliceAsBytes(tree.tokens));
    std.debug.assert(pos == bufferSize(tree, utf16, tokens));
    return pos;
}

pub fn tokensBufferSize(tokens: []const token.Token, utf16: Utf16) usize {
    return TOKENS_HEADER_SIZE + tokens.len * TOKEN_SIZE + utf16.count * 8;
}

pub fn serializeTokens(tokens: []const token.Token, source: []const u8, utf16: Utf16, buf: []u8) usize {
    std.debug.assert(buf.len >= tokensBufferSize(tokens, utf16));
    const header: TokensHeader = .{
        .token_count = @intCast(tokens.len),
        .source_len = @intCast(source.len),
        .first_non_ascii = utf16.first,
        .utf16_count = utf16.count,
    };
    var pos: usize = 0;
    writeBytes(buf, &pos, std.mem.asBytes(&header));
    writeBytes(buf, &pos, std.mem.sliceAsBytes(tokens));
    pos += utf16.write(source, buf[pos..]);
    return pos;
}

/// The non-ASCII characters of a source, past which byte offsets and UTF-16 offsets part. Each is
/// written as the byte offset after it, then how many more bytes than UTF-16 code units the source
/// has up to there; JavaScript searches them only for offsets past the first.
pub const Utf16 = struct {
    first: u32,
    count: u32,

    pub fn init(source: []const u8) Utf16 {
        const first = firstNonAscii(source, 0);
        var count: u32 = 0;
        var i = first;
        while (i < source.len) {
            i += charLen(source[i]);
            count += 1;
            i = firstNonAscii(source, i);
        }
        return .{ .first = first, .count = count };
    }

    fn write(utf16: Utf16, source: []const u8, buf: []u8) usize {
        const out: [*]u32 = @ptrCast(@alignCast(buf.ptr));
        var extra: u32 = 0;
        var i = utf16.first;
        var n: usize = 0;
        while (i < source.len) {
            const len = charLen(source[i]);
            // four bytes are a surrogate pair, two code units
            extra += len - @as(u32, if (len == 4) 2 else 1);
            i = @min(i + len, @as(u32, @intCast(source.len)));
            out[n] = i;
            out[n + 1] = extra;
            n += 2;
            i = firstNonAscii(source, i);
        }
        std.debug.assert(n == utf16.count * 2);
        return n * 4;
    }

    /// Byte offsets to UTF-16 offsets by the written breakpoints, trying the last one found first,
    /// since offsets come near in order.
    pub const Map = struct {
        points: []const u32,
        first: u32,
        j: u32 = 0,

        pub fn at(m: *Map, v: u32) u32 {
            std.debug.assert(m.points.len % 2 == 0);
            if (v <= m.first) return v;
            const count: u32 = @intCast(m.points.len / 2);
            const behind = m.j > 0 and m.points[2 * m.j - 2] > v;
            const ahead = m.j < count and m.points[2 * m.j] <= v;
            if (behind or ahead) {
                var lo: u32 = 0;
                var hi: u32 = count;
                while (lo < hi) {
                    const mid = (lo + hi) / 2;
                    if (m.points[2 * mid] <= v) lo = mid + 1 else hi = mid;
                }
                m.j = lo;
            }
            const out = if (m.j == 0) v else v - m.points[2 * m.j - 1];
            std.debug.assert(out <= v);
            return out;
        }
    };
};

// where node offsets are mapped to UTF-16, and which strings slice the source
const Mapping = struct {
    utf16: Utf16.Map,
    source_len: u32,
};

fn charLen(lead: u8) u32 {
    return if (lead < 0xE0) 2 else if (lead < 0xF0) 3 else 4;
}

inline fn writeBytes(buf: []u8, pos: *usize, bytes: []const u8) void {
    @memcpy(buf[pos.*..][0..bytes.len], bytes);
    pos.* += bytes.len;
}

fn packNode(data: *const ast.NodeData, span: ast.Span, comptime mapped: bool, m: *Mapping) PackedNode {
    var n: PackedNode = std.mem.zeroes(PackedNode);
    n.span_start = span.start;
    n.span_end = span.end;
    if (mapped) {
        n.span_start = m.utf16.at(span.start);
        n.span_end = m.utf16.at(span.end);
    }
    // by pointer, so no node copies the whole union
    switch (data.*) {
        inline else => |*payload, tag| {
            n.tag = @backingInt(tag);
            packPayload(&n, payload, mapped, m);
        },
    }
    return n;
}

fn packPayload(n: *PackedNode, payload: anytype, comptime mapped: bool, m: *Mapping) void {
    const T = @typeInfo(@TypeOf(payload)).pointer.child;
    const info = @typeInfo(T).@"struct";
    inline for (info.field_names, info.field_types, 0..) |name, Field, i| {
        const value = @field(payload, name);
        const bit = comptime flagBitForField(T, i);
        const slot = comptime u32SlotForField(T, i);
        if (Field == ast.NodeIndex) {
            n.slots[slot] = @backingInt(value);
        } else if (Field == ast.IndexRange) {
            n.slots[slot] = value.start;
            n.slots[slot + 1] = value.len;
        } else if (Field == ast.String) {
            n.slots[slot] = value.start;
            n.slots[slot + 1] = value.end;
            if (mapped and value.start < m.source_len) {
                n.slots[slot] = m.utf16.at(value.start);
                n.slots[slot + 1] = m.utf16.at(value.end);
            }
        } else if (Field == bool) {
            if (value) n.flags |= @as(u16, 1) << bit;
        } else if (@typeInfo(Field) == .@"enum") {
            n.flags |= @as(u16, @backingInt(value)) << bit;
        } else {
            @compileError("unsupported field type '" ++ @typeName(Field) ++ "' in " ++ @typeName(T));
        }
    }
}

// eight bytes at a time, which the mvp target runs without SIMD
fn firstNonAscii(source: []const u8, from: u32) u32 {
    const high: u64 = 0x8080808080808080;
    var i: usize = from;
    while (i + 8 <= source.len) : (i += 8) {
        if (std.mem.readInt(u64, source[i..][0..8], .little) & high != 0) break;
    }
    while (i < source.len and source[i] < 0x80) i += 1;
    return @intCast(i);
}

test "copies a payload as its slots" {
    // the copy reads a node's payload where the union starts
    const info = @typeInfo(ast.NodeData).@"union";
    inline for (info.field_names, 0..) |name, tag| {
        var node = @unionInit(ast.NodeData, name, undefined);
        try std.testing.expectEqual(@intFromPtr(&node), @intFromPtr(&@field(node, name)));
        try std.testing.expect(copied[tag] == null or copied[tag].? <= NODE_DATA_SLOTS);
    }
    try std.testing.expect(copied[@backingInt(ast.Tag.dimension)] == 4);
    try std.testing.expect(copied[@backingInt(ast.Tag.attribute_selector)] == null);
}

test "serializes" {
    const parse = @import("parser.zig").parse;
    const source = ".é { a: b } @media x { c {} } d { \"\\41\" } 😀{}";
    var tree = try parse(std.testing.allocator, source, .{});
    defer tree.deinit();
    const utf16: Utf16 = .init(source);
    try std.testing.expectEqual(Utf16{ .first = 1, .count = 2 }, utf16);
    const buf = try std.testing.allocator.alignedAlloc(u8, .@"4", bufferSize(&tree, utf16, false));
    defer std.testing.allocator.free(buf);
    try std.testing.expectEqual(buf.len, serializeInto(&tree, utf16, false, buf));
    const breakpoints: []const u32 = @ptrCast(@alignCast(buf[buf.len - 16 ..]));
    try std.testing.expectEqualSlices(u32, &.{ 3, 1, source.len - 2, 3 }, breakpoints);
    // `.é` is two UTF-16 units, so the rule after it spans from unit 1, not byte 1
    const first_rule: *const PackedNode = @ptrCast(@alignCast(buf[HEADER_SIZE..][0..NODE_SIZE]));
    try std.testing.expect(first_rule.span_end <= source.len - 3);
    try std.testing.expectEqual(8, firstNonAscii("abcdefghé", 0));
}
