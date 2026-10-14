// the wasm export's parse and serialize, compiled for the host, timed per file; not shipped
// usage: yuku-css-native-bench <rounds> <flags> <file.css>... (one JSON line per file)

const std = @import("std");
const css = @import("yuku-css");

const gpa = std.heap.smp_allocator;

pub fn main(init: std.process.Init) !void {
    const arena = init.arena.allocator();
    const args = try init.minimal.args.toSlice(arena);
    if (args.len < 4) {
        std.debug.print("usage: yuku-css-native-bench <rounds> <flags> <file.css>...\n", .{});
        std.process.exit(1);
    }
    const rounds = try std.fmt.parseInt(usize, args[1], 10);
    const flags = try std.fmt.parseInt(u32, args[2], 10);
    var buf: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(init.io, &buf);
    const out = &stdout.interface;
    for (args[3..]) |path| {
        const source = try std.Io.Dir.cwd().readFileAlloc(init.io, path, arena, .limited(256 * 1024 * 1024));
        const nodes = try nodeCount(source, flags);
        const samples = try arena.alloc(u64, rounds);
        const parse_ns = try measure(init.io, samples, source, flags, parseOnly);
        const full_ns = try measure(init.io, samples, source, flags, parseBuffer);
        try out.print(
            "{{\"file\":\"{s}\",\"bytes\":{d},\"nodes\":{d},\"parse_ms\":{d:.4},\"parse_serialize_ms\":{d:.4}}}\n",
            .{ std.fs.path.basename(path), source.len, nodes, ms(parse_ns), ms(full_ns) },
        );
        try out.flush();
    }
}

fn ms(ns: u64) f64 {
    return @as(f64, @floatFromInt(ns)) / 1e6;
}

// one second warm, then the median of `samples.len` runs
fn measure(io: std.Io, samples: []u64, source: []const u8, flags: u32, comptime run: anytype) !u64 {
    const warm_until = std.Io.Timestamp.now(io, .awake).nanoseconds + std.time.ns_per_s;
    while (std.Io.Timestamp.now(io, .awake).nanoseconds < warm_until) try run(source, flags);
    for (samples) |*sample| {
        const start = std.Io.Timestamp.now(io, .awake);
        try run(source, flags);
        sample.* = @intCast(start.durationTo(std.Io.Timestamp.now(io, .awake)).nanoseconds);
    }
    std.mem.sort(u64, samples, {}, std.sort.asc(u64));
    return samples[samples.len / 2];
}

fn nodeCount(source: []const u8, flags: u32) !usize {
    var tree = try css.parse(gpa, source, css.flags.options(flags));
    defer tree.deinit();
    return tree.nodes.len;
}

fn parseOnly(source: []const u8, flags: u32) !void {
    var tree = try css.parse(gpa, source, css.flags.options(flags));
    defer tree.deinit();
    std.mem.doNotOptimizeAway(tree.nodes.len);
}

// src/wasm.zig's parseBuffer with the host allocator, buffer freed as the JS frees it
fn parseBuffer(source: []const u8, flags: u32) !void {
    var tree = try css.parse(gpa, source, css.flags.options(flags));
    defer tree.deinit();
    const tokens = flags & css.flags.tokens != 0;
    if (tokens) {
        var list: css.token.TokenList = .empty;
        try css.tokenize(tree.allocator(), &list, source);
        tree.tokens = list.items;
    }
    const utf16: css.transfer.Utf16 = .init(source);
    const out = try gpa.alloc(u8, 4 + css.transfer.bufferSize(&tree, utf16, tokens));
    defer gpa.free(out);
    _ = css.transfer.serializeInto(&tree, utf16, tokens, out[4..]);
    std.mem.doNotOptimizeAway(out.ptr);
}
