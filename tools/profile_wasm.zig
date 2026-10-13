// exports that stop after each phase of `parse`, for bench/profile.mjs; not shipped

const std = @import("std");
const css = @import("yuku-css");

const gpa = std.heap.wasm_allocator;

export fn alloc(len: usize) [*]u8 {
    return (gpa.alloc(u8, len) catch @trap()).ptr;
}

export fn free(ptr: [*]u8, len: usize) void {
    gpa.free(ptr[0..len]);
}

/// Tokenizes into a token list, as `tokenize` does, and returns the token count.
export fn lexOnly(ptr: [*]const u8, len: usize) u32 {
    var tokens: css.token.TokenList = .empty;
    defer tokens.deinit(gpa);
    tokens.ensureTotalCapacity(gpa, len / 2 + 64) catch return 0;
    _ = css.lexer.tokenize(gpa, &tokens, ptr[0..len]) catch return 0;
    return @intCast(tokens.items.len);
}

/// Parses, without serializing, and returns the node count.
export fn parseOnly(ptr: [*]const u8, len: usize, flags: u32) u32 {
    const options: css.parser.Options = .{ .parse_rule_prelude = flags & 1 != 0 };
    var tree = css.parse(gpa, ptr[0..len], options) catch return 0;
    defer tree.deinit();
    return @intCast(tree.nodes.len);
}

/// Scans tokens without storing them.
export fn lexScan(ptr: [*]const u8, len: usize) u32 {
    var l: css.lexer.Lexer = .init(ptr[0..len]);
    var n: u32 = 0;
    while (l.pos < len) {
        _ = l.next();
        n += 1;
    }
    return n;
}
