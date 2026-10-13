// the JavaScript instantiates this module with no imports

const std = @import("std");
const css = @import("root.zig");

const gpa = std.heap.wasm_allocator;

// packed by src/index.ts
const flag = struct {
    const parse_rule_prelude = 1 << 0;
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

fn parseBuffer(source: []const u8, flags: u32) ![]u8 {
    var tree = try css.parse(gpa, source, .{ .parse_rule_prelude = flags & flag.parse_rule_prelude != 0 });
    defer tree.deinit();
    const utf16: css.transfer.Utf16 = .init(source);
    const out = try prefixed(css.transfer.bufferSize(&tree, utf16));
    _ = css.transfer.serializeInto(&tree, utf16, out[4..]);
    return out;
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
