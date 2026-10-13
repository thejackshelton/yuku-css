// the JavaScript instantiates this module with no imports

const std = @import("std");
const css = @import("root.zig");

const gpa = std.heap.wasm_allocator;

export fn alloc(len: usize) [*]u8 {
    return (gpa.alloc(u8, len) catch @trap()).ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    gpa.free(ptr[0..len]);
}

/// Returns the transfer stream, or 0 when out of memory.
export fn parse(ptr: [*]const u8, len: usize) usize {
    const out = parseBuffer(ptr[0..len]) catch return 0;
    return @intFromPtr(out.ptr);
}

/// `len` is the length the stream's header gives for its allocation.
export fn release(ptr: [*]u32, len: usize) void {
    gpa.free(ptr[0..len]);
}

// static, so the host reads it without freeing
export fn description() usize {
    return @intFromPtr(&described);
}

const described = blk: {
    const json = css.transfer.description;
    var bytes: [4 + json.len]u8 = undefined;
    std.mem.writeInt(u32, bytes[0..4], json.len, .little);
    @memcpy(bytes[4..], json);
    break :blk bytes;
};

fn parseBuffer(source: []const u8) ![]u32 {
    var tree = try css.parse(gpa, source);
    defer tree.deinit();
    return css.transfer.serialize(gpa, &tree);
}
