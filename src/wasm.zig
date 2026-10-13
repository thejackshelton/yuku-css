// the JavaScript instantiates this module with no imports

const std = @import("std");
const css = @import("root.zig");

const gpa = std.heap.wasm_allocator;

// packed by src/index.ts
const flag = struct {
    const parse_rule_prelude = 1 << 0;
    const positions = 1 << 1;
    const tokens = 1 << 2;
    const context = 3;
    const context_mask = 0xF;
    const parse_value = 1 << 7;
    const parse_custom_property = 1 << 8;
    const parse_atrule_prelude = 1 << 9;
    const atrule = 10;
    const atrule_mask = 0xF;
    const spec = 1 << 14;
    const source_map = 1 << 15;
};

export fn alloc(len: usize) [*]u8 {
    return (gpa.alloc(u8, len) catch @trap()).ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    gpa.free(ptr[0..len]);
}

/// The transfer buffer behind a u32 length, or 0 when out of memory.
export fn parse(ptr: [*]const u8, len: usize, flags: u32) usize {
    const out = parseBuffer(ptr[0..len], flags) catch return 0;
    return @intFromPtr(out.ptr);
}

/// The token list behind a u32 length, or 0 when out of memory.
export fn tokenize(ptr: [*]const u8, len: usize) usize {
    const out = tokenizeBuffer(ptr[0..len]) catch return 0;
    return @intFromPtr(out.ptr);
}

/// The printed text, its map and its diagnostics, behind a u32 length, or 0 when out of memory.
export fn transform(ptr: [*]const u8, len: usize, flags: u32) usize {
    const out = transformBuffer(ptr[0..len], flags) catch return 0;
    return @intFromPtr(out.ptr);
}

fn parseOptions(flags: u32) css.parser.Options {
    return .{
        .parse_rule_prelude = flags & flag.parse_rule_prelude != 0,
        .parse_value = flags & flag.parse_value != 0,
        .parse_custom_property = flags & flag.parse_custom_property != 0,
        .lines = flags & flag.positions != 0,
        .parse_atrule_prelude = flags & flag.parse_atrule_prelude != 0,
        .atrule = std.enums.fromInt(
            css.parser.Atrule,
            (flags >> flag.atrule) & flag.atrule_mask,
        ) orelse .unknown,
        .context = std.enums.fromInt(
            css.parser.Context,
            (flags >> flag.context) & flag.context_mask,
        ) orelse .stylesheet,
    };
}

fn parseBuffer(source: []const u8, flags: u32) ![]u8 {
    var tree = try css.parse(gpa, source, parseOptions(flags));
    defer tree.deinit();
    const tokens = flags & flag.tokens != 0;
    if (tokens) {
        var list: css.token.TokenList = .empty;
        try css.tokenize(tree.allocator(), &list, source);
        tree.tokens = list.items;
    }
    const utf16: css.transfer.Utf16 = .init(source);
    const out = try prefixed(css.transfer.bufferSize(&tree, utf16, tokens));
    _ = css.transfer.serializeInto(&tree, utf16, tokens, out[4..]);
    return out;
}

// after the length: code, mappings and diagnostic counts and whether the map names the source, the
// code, the mappings, then 4-byte aligned each diagnostic's UTF-16 start and end and the length of
// its message, then the messages
fn transformBuffer(source: []const u8, flags: u32) ![]u8 {
    var tree = try css.parse(gpa, source, parseOptions(flags & ~@as(u32, flag.positions)));
    defer tree.deinit();
    const header = 4 + 4 * 4;
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(gpa);
    try out.ensureTotalCapacity(gpa, header + source.len + source.len / 8 + 64);
    out.items.len = header;
    var mappings: std.ArrayList(u8) = .empty;
    defer mappings.deinit(gpa);
    const sourced = try css.codegen.generate(gpa, &tree, .{
        .mode = if (flags & flag.spec != 0) .spec else .safe,
        .source_map = flags & flag.source_map != 0,
    }, &out, &mappings);
    const code_len = out.items.len - header;
    try out.appendSlice(gpa, mappings.items);
    try out.appendNTimes(gpa, 0, (4 - out.items.len % 4) % 4);
    const diagnostics = tree.diagnostics.items;
    var cursor: css.codegen.Cursor = .init(source);
    var messages: std.ArrayList(u8) = .empty;
    defer messages.deinit(gpa);
    for (diagnostics) |diagnostic| {
        const start = messages.items.len;
        try appendMessage(gpa, &messages, &tree, diagnostic);
        const record = [_]u32{
            cursor.utf16At(diagnostic.span.start),
            cursor.utf16At(diagnostic.span.end),
            @intCast(messages.items.len - start),
        };
        try out.appendSlice(gpa, std.mem.asBytes(&record));
    }
    try out.appendSlice(gpa, messages.items);
    const fields = [_]u32{
        @intCast(out.capacity - 4),
        @intCast(code_len),
        @intCast(mappings.items.len),
        @intCast(diagnostics.len),
        @intFromBool(sourced),
    };
    @memcpy(out.items[0..header], std.mem.sliceAsBytes(&fields));
    return out.items.ptr[0..out.capacity];
}

// css-tree's wording, its `{}` filled with the argument
fn appendMessage(
    allocator: std.mem.Allocator,
    out: *std.ArrayList(u8),
    tree: *const css.ast.Tree,
    diagnostic: css.ast.Diagnostic,
) !void {
    const text = diagnostic.message.text();
    if (diagnostic.argument.start == css.ast.String.none.start) {
        return out.appendSlice(allocator, text);
    }
    const at = std.mem.find(u8, text, "{}").?;
    try out.appendSlice(allocator, text[0..at]);
    try out.appendSlice(allocator, tree.string(diagnostic.argument));
    try out.appendSlice(allocator, text[at + 2 ..]);
}

fn tokenizeBuffer(source: []const u8) ![]u8 {
    var tokens: css.token.TokenList = .empty;
    defer tokens.deinit(gpa);
    try css.tokenize(gpa, &tokens, source);
    const utf16: css.transfer.Utf16 = .init(source);
    const out = try prefixed(css.transfer.tokensBufferSize(tokens.items, utf16));
    _ = css.transfer.serializeTokens(tokens.items, source, utf16, out[4..]);
    return out;
}

// the length prefix tells the host how much to free
fn prefixed(size: usize) ![]u8 {
    const out = try gpa.alloc(u8, 4 + size);
    std.mem.writeInt(u32, out[0..4], @intCast(size), .little);
    return out;
}
