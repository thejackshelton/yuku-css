// css-tree's generator/sourceMap.js over bytes: maps where each at-rule, selector and declaration
// starts, and, with no source, where the last of them ended, in UTF-16 columns

const std = @import("std");
const lexer = @import("../lexer.zig");

const Allocator = std.mem.Allocator;

const no_source = std.math.maxInt(u32);

const Mapping = struct {
    line: u32,
    column: u32,
    /// 0, the only source, or `no_source`.
    source: u32,
    original_line: u32,
    original_column: u32,

    // source-map-js's compareByGeneratedPositionsInflated, with one source
    fn order(a: Mapping, b: Mapping) std.math.Order {
        if (a.line != b.line) return std.math.order(a.line, b.line);
        if (a.column != b.column) return std.math.order(a.column, b.column);
        if (a.source != b.source) return if (a.source == no_source) .gt else .lt;
        if (a.original_line != b.original_line) {
            return std.math.order(a.original_line, b.original_line);
        }
        return std.math.order(a.original_column, b.original_column);
    }

    fn lessThan(_: void, a: Mapping, b: Mapping) bool {
        return a.order(b) == .lt;
    }
};

/// A line and a UTF-16 column, both counted from the start of their text.
pub const Point = struct { line: u32, column: u32 };

/// Byte offsets of a UTF-8 text to css-tree's lines and UTF-16 columns, read forward from the last
/// offset asked for. Lines break at `\n`, `\r\n`, `\r` and `\f`; the first line starts past a byte
/// order mark, as css-tree's do.
pub const Cursor = struct {
    text: []const u8,
    start: u32,
    byte: u32,
    utf16: u32,
    line: u32 = 1,
    line_utf16: u32,

    pub fn init(text: []const u8) Cursor {
        const start = lexer.bomLen(text);
        // a byte order mark is one code unit
        const utf16: u32 = if (start > 0) 1 else 0;
        return .{
            .text = text,
            .start = start,
            .byte = start,
            .utf16 = utf16,
            .line_utf16 = utf16,
        };
    }

    /// The UTF-16 offset of byte `offset`.
    pub fn utf16At(cursor: *Cursor, offset: u32) u32 {
        if (offset < cursor.start) return 0;
        _ = cursor.at(offset);
        return cursor.utf16;
    }

    /// The point at `offset`, which leaves its UTF-16 offset in `utf16`.
    pub fn at(cursor: *Cursor, offset: u32) Point {
        std.debug.assert(offset <= cursor.text.len);
        if (offset < cursor.byte) cursor.* = .init(cursor.text);
        const text = cursor.text;
        var i = cursor.byte;
        var utf16 = cursor.utf16;
        while (i < offset) : (i += 1) {
            const c = text[i];
            if (c < 0x80) {
                utf16 += 1;
                const breaks = c == '\n' or c == 0x0C or
                    (c == '\r' and !(i + 1 < text.len and text[i + 1] == '\n'));
                if (breaks) {
                    cursor.line += 1;
                    cursor.line_utf16 = utf16;
                }
            } else if (c >= 0xC0) {
                // four bytes are a surrogate pair, two code units
                utf16 += if (c >= 0xF0) 2 else 1;
            }
        }
        cursor.byte = i;
        cursor.utf16 = utf16;
        std.debug.assert(cursor.line_utf16 <= utf16);
        return .{ .line = cursor.line, .column = utf16 - cursor.line_utf16 };
    }
};

pub const Tracker = struct {
    source: Cursor,
    /// Where the generated text was last read to, and its line and UTF-16 column there.
    generated_byte: u32 = 0,
    generated: Point = .{ .line = 1, .column = 0 },
    original: Point = .{ .line = 0, .column = 0 },
    active: bool = false,
    active_at: Point = .{ .line = 1, .column = 0 },
    mappings: std.ArrayList(Mapping) = .empty,
    sorted: bool = true,

    pub fn init(source: []const u8) Tracker {
        return .{ .source = .init(source) };
    }

    // reads the text generated since the last call, as css-tree's `emit` counts it: lines at `\n`
    fn advance(tracker: *Tracker, code: []const u8) Point {
        std.debug.assert(tracker.generated_byte <= code.len);
        var point = tracker.generated;
        for (code[tracker.generated_byte..]) |c| {
            if (c == '\n') {
                point.line += 1;
                point.column = 0;
            } else if (c < 0x80 or c >= 0xC0) {
                point.column += if (c >= 0xF0) 2 else 1;
            }
        }
        std.debug.assert(point.line >= tracker.generated.line);
        tracker.generated_byte = @intCast(code.len);
        tracker.generated = point;
        return point;
    }

    /// A tracked node starting at byte `start` of the source, about to print past `code`.
    pub fn enter(
        tracker: *Tracker,
        gpa: Allocator,
        code: []const u8,
        start: u32,
    ) Allocator.Error!void {
        const original = tracker.source.at(start);
        std.debug.assert(original.line > 0);
        if (original.line == tracker.original.line and original.column == tracker.original.column) {
            return;
        }
        tracker.original = original;
        const at = tracker.advance(code);
        const moved = at.line != tracker.active_at.line or at.column != tracker.active_at.column;
        if (tracker.active and moved) try tracker.add(gpa, tracker.active_at, null);
        tracker.active = true;
        try tracker.add(gpa, at, original);
    }

    /// The tracked node entered last has printed up to the end of `code`.
    pub fn leave(tracker: *Tracker, code: []const u8) void {
        if (!tracker.active) return;
        std.debug.assert(tracker.mappings.items.len > 0);
        tracker.active_at = tracker.advance(code);
        std.debug.assert(tracker.generated_byte == code.len);
    }

    fn add(tracker: *Tracker, gpa: Allocator, at: Point, original: ?Point) Allocator.Error!void {
        std.debug.assert(at.line >= 1);
        std.debug.assert(original == null or original.?.line >= 1);
        const mapping: Mapping = .{
            .line = at.line,
            .column = at.column,
            .source = if (original != null) 0 else no_source,
            .original_line = if (original) |point| point.line else 0,
            .original_column = if (original) |point| point.column else 0,
        };
        const items = tracker.mappings.items;
        if (items.len > 0 and tracker.sorted) {
            const last = items[items.len - 1];
            const after = at.line > last.line or
                (at.line == last.line and at.column >= last.column);
            if (!after and last.order(mapping) == .gt) tracker.sorted = false;
        }
        try tracker.mappings.append(gpa, mapping);
    }

    /// Whether any mapping names the source, which css-tree's `sources` then lists.
    pub fn sourced(tracker: *const Tracker) bool {
        for (tracker.mappings.items) |mapping| {
            if (mapping.source != no_source) return true;
        }
        return false;
    }

    /// Appends the `mappings` field of the map to `out`, as source-map-js serializes it.
    pub fn finish(tracker: *Tracker, gpa: Allocator, out: *std.ArrayList(u8)) Allocator.Error!void {
        if (tracker.active) try tracker.add(gpa, tracker.active_at, null);
        tracker.active = false;
        const items = tracker.mappings.items;
        std.debug.assert(items.len == 0 or items[0].line >= 1);
        // a mapping out of order sits behind the few its enclosing at-rules added
        if (!tracker.sorted) std.sort.insertion(Mapping, items, {}, Mapping.lessThan);
        try out.ensureUnusedCapacity(gpa, items.len * 12 + 16);
        var line: u32 = 1;
        var column: u32 = 0;
        var original_line: u32 = 0;
        var original_column: u32 = 0;
        for (items, 0..) |mapping, i| {
            if (mapping.line != line) {
                std.debug.assert(mapping.line > line);
                try out.appendNTimes(gpa, ';', mapping.line - line);
                line = mapping.line;
                column = 0;
            } else if (i > 0) {
                if (mapping.order(items[i - 1]) == .eq) continue;
                try out.append(gpa, ',');
            }
            try vlq(gpa, out, delta(mapping.column, column));
            column = mapping.column;
            if (mapping.source == no_source) continue;
            // the source index, always the first
            try out.append(gpa, 'A');
            try vlq(gpa, out, delta(mapping.original_line - 1, original_line));
            original_line = mapping.original_line - 1;
            try vlq(gpa, out, delta(mapping.original_column, original_column));
            original_column = mapping.original_column;
        }
    }
};

inline fn delta(to: u32, from: u32) i64 {
    return @as(i64, to) - @as(i64, from);
}

const vlq_digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn vlq(gpa: Allocator, out: *std.ArrayList(u8), value: i64) Allocator.Error!void {
    std.debug.assert(value > -(1 << 32) and value < 1 << 32);
    const magnitude: u64 = @abs(value);
    var bits: u64 = (magnitude << 1) | @intFromBool(value < 0);
    var digits: [8]u8 = undefined;
    var n: u32 = 0;
    while (true) {
        const digit: u8 = @intCast(bits & 0x1F);
        bits >>= 5;
        digits[n] = vlq_digits[if (bits != 0) digit | 0x20 else digit];
        n += 1;
        if (bits == 0) break;
    }
    std.debug.assert(n <= digits.len);
    try out.appendSlice(gpa, digits[0..n]);
}

test "a cursor reads lines as css-tree breaks them and columns in UTF-16 units" {
    var cursor: Cursor = .init("a\r\nb\rc\x0Cd\n\xC3\xA9\xF0\x9F\x98\x80e");
    try std.testing.expectEqual(Point{ .line = 1, .column = 1 }, cursor.at(1));
    try std.testing.expectEqual(Point{ .line = 2, .column = 0 }, cursor.at(3));
    try std.testing.expectEqual(Point{ .line = 4, .column = 0 }, cursor.at(7));
    try std.testing.expectEqual(Point{ .line = 5, .column = 3 }, cursor.at(15));
    try std.testing.expectEqual(Point{ .line = 2, .column = 0 }, cursor.at(3));
}

test "a cursor starts the first line past a byte order mark" {
    var cursor: Cursor = .init("\xEF\xBB\xBFa{}");
    try std.testing.expectEqual(Point{ .line = 1, .column = 0 }, cursor.at(3));
    try std.testing.expectEqual(Point{ .line = 1, .column = 1 }, cursor.at(4));
}
