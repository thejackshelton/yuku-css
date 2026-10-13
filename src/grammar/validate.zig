//! Matches every declaration of a style sheet in one pass, as Yuku's `analyze` runs over the
//! tree it parsed: the sheet is parsed once, each value matched over the tokens the parser read,
//! and every result written to one buffer the host reads.

const std = @import("std");
const css = @import("css");
const generic = @import("generic.zig");
const lexer_ = @import("lexer.zig");
const match_ = @import("match.zig");

const assert = std.debug.assert;
const Allocator = std.mem.Allocator;
const Lexer = lexer_.Lexer;
const none = lexer_.none;

/// Why a declaration matched nothing before any matching, as css-tree's `matchProperty` says.
pub const Status = enum(u32) {
    // the first five are `match_.Status`
    custom_property = 5,
    unknown_property = 6,
};

/// The words of each declaration's record, after the header.
pub const Record = enum(u32) {
    property_start,
    property_end,
    value_start,
    value_end,
    status,
    iterations,
    /// Where the token after the longest match starts and ends, both `none` past the end.
    longest_start,
    longest_end,
    /// The word where its entries start, and how many: each a kind with the token index above
    /// 8 bits, a definition node, and the token's start and end.
    entries,
    entry_count,
    reference,
    wide,
};

pub const record_words = @typeInfo(Record).@"enum".field_names.len;
/// The header: the declaration count, the words of a record, and the words of the whole result.
pub const header_words = 3;

/// css-tree's `property()`: the name a property is looked up by, and with a vendor prefix its
/// basename too.
pub const PropertyName = struct {
    custom: bool,
    name: []const u8,
    basename: []const u8,
    vendor: bool,
};

/// Splits `raw`, lowercasing it into `buffer`, which must be as long.
pub fn propertyName(raw: []const u8, buffer: []u8) PropertyName {
    assert(buffer.len >= raw.len);
    var hack: usize = 0;
    if (raw.len > 0) switch (raw[0]) {
        '_', '*', '$', '#', '+', '&' => hack = 1,
        '/' => hack = if (raw.len > 1 and raw[1] == '/') 2 else 1,
        else => {},
    };
    const custom = raw.len - hack >= 2 and raw[hack] == '-' and raw[hack + 1] == '-';
    if (custom) {
        return .{ .custom = true, .name = raw[hack..], .basename = raw[hack..], .vendor = false };
    }
    const lower = std.ascii.lowerString(buffer[0..raw.len], raw);
    var vendor: usize = 0;
    if (lower.len - hack >= 3 and lower[hack] == '-' and lower[hack + 1] != '-') {
        if (std.mem.indexOfScalarPos(u8, lower, hack + 2, '-')) |dash| vendor = dash + 1 - hack;
    }
    assert(hack + vendor <= lower.len);
    return .{
        .custom = false,
        .name = lower[hack..],
        .basename = lower[hack + vendor ..],
        .vendor = vendor > 0,
    };
}

/// The property's descriptor, as `getProperty` finds it, or `none`.
pub fn findProperty(l: *const Lexer, name: PropertyName) u32 {
    assert(!name.custom);
    const exact = l.findProperty(name.name);
    if (exact != none or !name.vendor) return exact;
    assert(name.basename.len < name.name.len);
    return l.findProperty(name.basename);
}

// the tokens of the value at `span`, read from its text, their ends placed in the whole source
fn tokensOf(
    gpa: Allocator,
    source: []const u8,
    span: css.ast.Span,
    tokens: *css.token.TokenList,
) ![]const css.token.Token {
    assert(span.start <= span.end);
    assert(span.end <= source.len);
    tokens.clearRetainingCapacity();
    try css.tokenize(gpa, tokens, source[span.start..span.end]);
    for (tokens.items) |*t| t.end += span.start;
    return tokens.items;
}

/// Parses `source` and matches each declaration's value against its property, appending a record
/// per declaration and then the entries of every match to `out`.
/// What `validate` writes and works in, kept between calls so they reuse their memory.
pub const Scratch = struct {
    /// The result.
    out: std.ArrayList(u32) = .empty,
    entries: std.ArrayList(u32) = .empty,
    lowered: std.ArrayList(u8) = .empty,
    /// Each declaration's text, to the record of its first.
    seen: std.StringHashMapUnmanaged(u32) = .empty,
    /// Where non-ASCII characters end, and the bytes they have beyond their UTF-16 units so far.
    breaks: std.ArrayList([2]u32) = .empty,
    /// The tokens of the value being matched.
    tokens: css.token.TokenList = .empty,
};

pub fn validate(
    gpa: Allocator,
    l: *Lexer,
    matcher: *match_.Matcher,
    source: []const u8,
    scratch: *Scratch,
) !void {
    const out = &scratch.out;
    const entries = &scratch.entries;
    const lowered = &scratch.lowered;
    const seen = &scratch.seen;
    const breaks = &scratch.breaks;
    assert(source.len < std.math.maxInt(u32));
    seen.clearRetainingCapacity();
    var tree = try css.parse(gpa, source, .{
        .parse_rule_prelude = false,
        .parse_value = false,
        .parse_atrule_prelude = false,
    });
    defer tree.deinit();
    const tags = tree.nodes.items(.data);
    var count: u32 = 0;
    for (tags) |data| count += @intFromBool(data == .declaration);
    out.clearRetainingCapacity();
    entries.clearRetainingCapacity();
    try out.ensureTotalCapacity(gpa, header_words + count * record_words);
    out.appendSliceAssumeCapacity(&.{ count, record_words, 0 });
    for (tags) |data| {
        if (data != .declaration) continue;
        const declaration = data.declaration;
        const raw = source[declaration.property.start..declaration.property.end];
        const value = tree.span(declaration.value);
        // a declaration written as one before matches as it did, so it reuses that result
        const written_end = @max(value.end, declaration.property.end);
        const written = source[declaration.property.start..written_end];
        const known = try seen.getOrPut(gpa, written);
        if (known.found_existing) {
            const first = out.items[known.value_ptr.*..][0..record_words];
            var copy = first.*;
            const shift = value.start -% first[@backingInt(Record.value_start)];
            copy[@backingInt(Record.property_start)] = declaration.property.start;
            copy[@backingInt(Record.property_end)] = declaration.property.end;
            copy[@backingInt(Record.value_start)] = value.start;
            copy[@backingInt(Record.value_end)] = value.end;
            if (copy[@backingInt(Record.longest_start)] != none) {
                copy[@backingInt(Record.longest_start)] +%= shift;
                copy[@backingInt(Record.longest_end)] +%= shift;
            }
            out.appendSliceAssumeCapacity(&copy);
            continue;
        }
        known.value_ptr.* = @intCast(out.items.len);
        try lowered.resize(gpa, raw.len);
        const name = propertyName(raw, lowered.items);
        var record: [record_words]u32 = @splat(none);
        record[@backingInt(Record.property_start)] = declaration.property.start;
        record[@backingInt(Record.property_end)] = declaration.property.end;
        record[@backingInt(Record.value_start)] = value.start;
        record[@backingInt(Record.value_end)] = value.end;
        record[@backingInt(Record.iterations)] = 0;
        record[@backingInt(Record.entry_count)] = 0;
        record[@backingInt(Record.wide)] = 0;
        const descriptor = if (name.custom) none else findProperty(l, name);
        if (name.custom) {
            record[@backingInt(Record.status)] = @backingInt(Status.custom_property);
        } else if (descriptor == none) {
            record[@backingInt(Record.status)] = @backingInt(Status.unknown_property);
        } else {
            const view: generic.Tokens = .{
                .source = source,
                .list = try tokensOf(gpa, source, value, &scratch.tokens),
                .first = value.start,
            };
            try matchInto(l, matcher, descriptor, view, &record, entries);
        }
        out.appendSliceAssumeCapacity(&record);
    }
    // entry offsets count from the start of the buffer
    const base: u32 = @intCast(out.items.len);
    for (0..count) |i| {
        const at = header_words + i * record_words + @backingInt(Record.entries);
        if (out.items[at] != none) out.items[at] += base;
    }
    try out.appendSlice(gpa, entries.items);
    assert(out.items.len == base + entries.items.len);
    out.items[2] = @intCast(out.items.len);
    try toUtf16(gpa, source, out.items, base, count, breaks);
}

fn matchInto(
    l: *Lexer,
    matcher: *match_.Matcher,
    descriptor: u32,
    view: generic.Tokens,
    record: *[record_words]u32,
    entries: *std.ArrayList(u32),
) !void {
    assert(descriptor < l.descriptors.items.len);
    assert(view.first <= view.source.len);
    var result: match_.Result = undefined;
    var wide = false;
    for (view.list, 0..) |t, i| {
        if (t.tag != .function) continue;
        if (!std.ascii.eqlIgnoreCase(view.text(@intCast(i)), "var(")) continue;
        result = .{ .status = .has_var, .iterations = 0, .longest = 0, .top = none };
        break;
    } else {
        if (l.mayBeCssWide(&view)) {
            result = try matcher.run(l, view, l.css_wide);
            wide = result.status == .match;
        }
        if (!wide) result = try matcher.run(l, view, try l.graphOf(descriptor, false));
    }
    record[@backingInt(Record.status)] = @backingInt(result.status);
    record[@backingInt(Record.iterations)] = result.iterations;
    record[@backingInt(Record.reference)] = result.reference;
    record[@backingInt(Record.wide)] = @intFromBool(wide);
    if (result.longest < view.len()) {
        record[@backingInt(Record.longest_start)] = view.start(result.longest);
        record[@backingInt(Record.longest_end)] = view.list[result.longest].end;
    }
    if (result.status != .match) return;
    var count: u32 = 0;
    var at = result.top;
    while (matcher.cell(at).entry != .stub) : (at = matcher.cell(at).prev) count += 1;
    const start = entries.items.len;
    try entries.resize(l.gpa, start + 4 * count);
    record[@backingInt(Record.entries)] = @intCast(start);
    record[@backingInt(Record.entry_count)] = count;
    var i = count;
    at = result.top;
    while (i > 0) {
        i -= 1;
        const c = matcher.cell(at);
        const has_token = c.entry == .token;
        assert(!has_token or c.token < 1 << 24);
        entries.items[start + 4 * i ..][0..4].* = .{
            @as(u32, @backingInt(c.entry)) | (if (has_token) c.token << 8 else 0),
            c.syntax,
            if (has_token) view.start(c.token) else 0,
            if (has_token) view.list[c.token].end else 0,
        };
        at = c.prev;
    }
}

test propertyName {
    var buffer: [32]u8 = undefined;
    const vendor = propertyName("-WebKit-Box-Shadow", &buffer);
    try std.testing.expectEqualStrings("-webkit-box-shadow", vendor.name);
    try std.testing.expectEqualStrings("box-shadow", vendor.basename);
    const hack = propertyName("*Zoom", &buffer);
    try std.testing.expectEqualStrings("zoom", hack.name);
    try std.testing.expect(propertyName("--x", &buffer).custom);
}

fn charLen(byte: u8) u32 {
    return if (byte < 0xE0) 2 else if (byte < 0xF0) 3 else 4;
}

/// Turns every byte offset of the result into a UTF-16 offset, which a JavaScript string indexes
/// by: past each non-ASCII character, an offset loses the bytes it has beyond its code units.
fn toUtf16(
    gpa: Allocator,
    source: []const u8,
    words: []u32,
    entries: usize,
    count: u32,
    breaks: *std.ArrayList([2]u32),
) !void {
    assert(entries <= words.len);
    assert(header_words + count * record_words <= entries);
    breaks.clearRetainingCapacity();
    var extra: u32 = 0;
    var i: u32 = 0;
    while (i < source.len) {
        if (source[i] < 0x80) {
            i = asciiEnd(source, i + 1);
            continue;
        }
        const len = @min(charLen(source[i]), @as(u32, @intCast(source.len)) - i);
        extra += len - @as(u32, if (len == 4) 2 else 1);
        i += len;
        try breaks.append(gpa, .{ i, extra });
    }
    if (breaks.items.len == 0) return;
    const fields = [_]Record{
        .property_start, .property_end, .value_start, .value_end, .longest_start, .longest_end,
    };
    for (0..count) |d| {
        const record = words[header_words + d * record_words ..][0..record_words];
        for (fields) |field| {
            const at = &record[@backingInt(field)];
            if (at.* != none) at.* = convert(breaks.items, at.*);
        }
    }
    var at = entries;
    while (at + 4 <= words.len) : (at += 4) {
        words[at + 2] = convert(breaks.items, words[at + 2]);
        words[at + 3] = convert(breaks.items, words[at + 3]);
    }
}

// the offset less the extra bytes of every character that ends at or before it
fn convert(breaks: []const [2]u32, offset: u32) u32 {
    assert(breaks.len > 0);
    var low: usize = 0;
    var high: usize = breaks.len;
    while (low < high) {
        const mid = low + (high - low) / 2;
        if (breaks[mid][0] <= offset) low = mid + 1 else high = mid;
    }
    const extra = if (low == 0) 0 else breaks[low - 1][1];
    assert(extra <= offset);
    return offset - extra;
}

// the first non-ASCII byte from `from`, eight bytes a turn
fn asciiEnd(source: []const u8, from: u32) u32 {
    assert(from <= source.len);
    var i = from;
    while (i + 8 <= source.len) : (i += 8) {
        const word = std.mem.readInt(u64, source[i..][0..8], .little);
        if (word & 0x8080808080808080 != 0) break;
    }
    while (i < source.len and source[i] < 0x80) i += 1;
    assert(i <= source.len);
    return i;
}
